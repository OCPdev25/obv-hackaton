/**
 * ConversationController — the conversation-first home surface engine.
 *
 * One thread holds everything: user turns, capture turns (raw + reviewable
 * proposed events), publish receipts, corrections, and read-only answers.
 * Voice (simulated) and text feed the SAME capture pipeline; questions and
 * catch-up are strictly read-only.
 */
import { JournalStore, type DenyCode, type EventEdit, type ProposalRecord, type Receipt, type CorrectionRecord, type Audience, type Principal, type Answer } from "../journal/store"
import type { UnstructuredClause } from "../capture/extraction"
import { scriptedVoiceTranscriber, joinedTranscriptText } from "../capture/simulatedVoice"

export type CaptureChannel = "voice-simulated" | "text"

export type Turn =
  | { readonly id: string; readonly kind: "user"; readonly authorId: string; readonly text: string; readonly channel: CaptureChannel; readonly at: number }
  | { readonly id: string; readonly kind: "capture"; readonly entryId: string; readonly captureId: string; readonly rawTranscript: string; readonly proposals: readonly ProposalRecord[]; readonly unstructured: readonly UnstructuredClause[]; readonly at: number }
  | { readonly id: string; readonly kind: "replayed"; readonly entryId: string; readonly captureId: string; readonly at: number }
  | { readonly id: string; readonly kind: "publish-receipt"; readonly receipt: Receipt; readonly eventIds: readonly string[]; readonly at: number }
  | { readonly id: string; readonly kind: "correction"; readonly record: CorrectionRecord; readonly at: number }
  | { readonly id: string; readonly kind: "answer"; readonly question: string; readonly answer: Answer; readonly at: number }
  | { readonly id: string; readonly kind: "catchup"; readonly result: Answer; readonly at: number }
  | { readonly id: string; readonly kind: "month-view"; readonly view: Answer; readonly monthKey: string; readonly at: number }
  | { readonly id: string; readonly kind: "denied"; readonly action: string; readonly code: DenyCode; readonly detail: string; readonly at: number }
  | { readonly id: string; readonly kind: "system"; readonly text: string; readonly at: number }

const QUESTION_STARTERS = /^(how|what|when|who|did|any|is|are)\b/i

/** A read-only question routes to the answer engine, never the capture pipeline. */
export function isReadOnlyQuestion(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.endsWith("?") && QUESTION_STARTERS.test(trimmed)
}

/** Omit must distribute over the Turn union — plain Omit collapses it. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type TurnInput = DistributiveOmit<Turn, "id"> & { readonly id?: string }

export class ConversationController {
  private readonly turns: Turn[] = []
  private readonly listeners = new Set<() => void>()
  private version = 0
  private readonly voice = scriptedVoiceTranscriber()
  private turnSequence = 0

  constructor(
    private readonly store: JournalStore,
    private principal: Principal,
    private demoAuthorId: string,
    /** Demo clock — fixed for deterministic demos/tests. */
    private now: number,
  ) {}

  /** Swap the signed-in member (sign-in screen drives this). */
  switchPrincipal(next: Principal, authorId: string, atMs?: number): void {
    this.principal = next
    this.demoAuthorId = authorId
    if (atMs !== undefined) this.now = atMs
    this.push({ kind: "system", text: "Signed in. The journal thread below is scoped to what you may see — nothing more.", at: this.now })
  }

  setNow(atMs: number): void {
    this.now = atMs
  }

  // --- subscribe/notify (React external-store friendly) -----------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getVersion = (): number => this.version

  getTurns = (): readonly Turn[] => this.turns

  private push(turn: TurnInput): void {
    this.turnSequence += 1
    const withId = { ...turn, id: turn.id ?? `turn_${this.turnSequence}` } as Turn
    this.turns.push(withId)
    this.version += 1
    for (const listener of this.listeners) listener()
  }

  // --- capture: voice (simulated) and text hit the SAME pipeline ---------------

  sendText(text: string): void {
    this.send(text, "text")
  }

  /** Simulated voice path: scripted transcription → identical pipeline call. */
  sendVoiceDemo(text: string): void {
    if (!this.voice.isAvailable()) {
      this.push({ kind: "denied", action: "voice", code: "DENY_NO_HOUSEHOLD_PATH", detail: "Voice unavailable", at: this.now })
      return
    }
    const result = this.voice.transcribeScripted(text)
    this.send(joinedTranscriptText(result), "voice-simulated")
  }

  private send(text: string, channel: CaptureChannel): void {
    const atMs = this.now
    if (isReadOnlyQuestion(text)) {
      this.ask(text)
      return
    }
    this.push({ kind: "user", authorId: this.demoAuthorId, text, channel, at: atMs })

    const captureId = `cap_${atMs}_${this.turnSequence}`
    const outcome = this.store.capture(this.principal, {
      captureId,
      transcript: text,
      authorId: this.demoAuthorId,
      capturedAt: atMs,
      channel,
    })
    if (outcome.kind === "captured") {
      this.push({
        kind: "capture",
        entryId: outcome.entryId,
        captureId,
        rawTranscript: outcome.entry.rawTranscript,
        proposals: outcome.proposals,
        unstructured: [...outcome.unstructured],
        at: atMs,
      })
    } else if (outcome.kind === "replayed") {
      this.push({ kind: "replayed", entryId: outcome.entryId, captureId, at: atMs })
    } else if (outcome.kind === "rejected") {
      this.push({ kind: "system", text: `Nothing captured: ${outcome.reason}`, at: atMs })
    } else {
      this.push({ kind: "denied", action: "capture", code: outcome.code, detail: outcome.detail, at: atMs })
    }
  }

  // --- review → publish ---------------------------------------------------------

  publish(entryId: string, edits: ReadonlyMap<string, EventEdit>, audience?: Audience): void {
    const atMs = this.now
    const result = this.store.publish(this.principal, {
      entryId,
      edits,
      ...(audience === undefined ? {} : { audience }),
      at: atMs,
    })
    if (result.kind === "published") {
      this.push({ kind: "publish-receipt", receipt: result.receipt, eventIds: result.eventIds, at: atMs })
    } else if (result.kind === "denied") {
      this.push({ kind: "denied", action: "publish", code: result.code, detail: result.detail, at: atMs })
    } else {
      this.push({ kind: "system", text: `Publish failed: ${result.reason}`, at: atMs })
    }
  }

  proposalsFor(entryId: string): readonly ProposalRecord[] {
    return this.store.proposalsFor(entryId)
  }

  get childrenRoster() {
    return this.store.childrenRoster
  }

  /** Event lookup for in-thread correction forms. */
  eventFor(eventId: string) {
    return this.store.event(eventId)
  }

  // --- post-publish correction (append-only) -------------------------------------

  correct(eventId: string, changes: EventEdit, reason: string): void {
    const atMs = this.now
    const result = this.store.correct(this.principal, {
      eventId,
      changes,
      reason: reason.length > 0 ? reason : "Corrected in conversation",
      authorId: this.demoAuthorId,
      at: atMs,
    })
    if (result.kind === "corrected") {
      this.push({ kind: "correction", record: result.record, at: atMs })
    } else {
      this.push({ kind: "denied", action: "correction", code: result.code, detail: result.detail, at: atMs })
    }
  }

  /** Correction history for an event (read-only view for the UI). */
  correctionHistory(eventId: string) {
    return this.store.correctionHistory(eventId)
  }

  // --- read-only catch-up & questions ----------------------------------------------

  ask(question: string): void {
    const atMs = this.now
    this.push({ kind: "user", authorId: this.demoAuthorId, text: question, channel: "text", at: atMs })
    const answer = this.store.ask(this.principal, question, atMs)
    if (answer.kind === "denied") {
      this.push({ kind: "denied", action: "question", code: answer.code, detail: answer.detail, at: atMs })
    } else {
      this.push({ kind: "answer", question, answer, at: atMs })
    }
  }

  catchUp(): void {
    const atMs = this.now
    const result = this.store.catchUp(this.principal, atMs)
    if (result.kind === "denied") {
      this.push({ kind: "denied", action: "catch-up", code: result.code, detail: result.detail, at: atMs })
    } else {
      this.push({ kind: "catchup", result, at: atMs })
    }
  }

  monthView(monthKey = "2026-09"): void {
    const atMs = this.now
    const view = this.store.monthView(this.principal, monthKey)
    if (view.kind === "denied") {
      this.push({ kind: "denied", action: "month view", code: view.code, detail: view.detail, at: atMs })
    } else {
      this.push({ kind: "month-view", view, monthKey, at: atMs })
    }
  }

  markCaughtUp(): void {
    const atMs = this.now
    const result = this.store.markCaughtUp(this.principal, atMs)
    if (result.kind === "marked") {
      this.push({ kind: "system", text: `Marked caught up — ${result.receipt.summary}`, at: atMs })
    } else {
      this.push({ kind: "denied", action: "mark caught up", code: result.code, detail: result.detail, at: atMs })
    }
  }
}
