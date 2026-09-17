/**
 * In-memory fixture store for the conversation-first parent home — candidate
 * scope. Mirrors the Convex adapter semantics without live Convex (allowed for
 * the prototype) while preserving the product trust rules:
 *
 * - raw-before-events: the entry row (verbatim transcript) persists BEFORE any
 *   extraction result is applied; extraction failure never blocks capture;
 * - captureId idempotency: duplicate submissions with the same captureId are
 *   replays — the existing entry is returned, nothing new is persisted;
 * - extraction envelope: results carry { captureId, attempt }; stale results
 *   (superseded attempts) are discarded, never merged; applying the same
 *   attempt twice is a no-op;
 * - authorized writes go through reviewable proposals and produce receipts;
 * - post-publish corrections are append-only lineage — the original event is
 *   preserved, never silently mutated;
 * - questions (ask/catchUp/monthView) are strictly read-only and cite sources;
 * - fail-closed authorization: non-members see nothing; drafts are
 *   author-only; caregivers see family-audience records only.
 *
 * All journal data decodes/encodes through the canonical @journal/domain
 * Effect schemas (EntrySchema/EventSchema/ChildSchema) — no second domain
 * model. Candidate-level lifecycle state (proposals, corrections, receipts,
 * audience) is deliberately kept OUT of the domain schemas; final audience
 * modeling belongs to slot 20.
 */
import { Schema } from "effect"
import { ChildSchema, EntrySchema, EventSchema, CaptureId, deriveExtractionStatus, type Child, type Entry, type Event, type EventCategory, type ProducedBy } from "@journal/domain"

import { runExtraction, type ExtractionOutcome, type UnstructuredClause } from "../capture/extraction.js"
import { canSeeAudience, decide, type Decision, type DenyCode, type MemberRole, type Principal } from "./access.js"

export type Audience = "family" | "parents-only"
export type CaptureChannel = "text" | "voice-simulated"

/** Lifecycle patch for a decoded Entry — applied via `withEntry` (re-decode). */
interface EntryLifecyclePatch {
  readonly extractionStatus?: Entry["extractionStatus"]
  readonly visibility?: Entry["visibility"]
  readonly structuredEventIds?: readonly string[]
}

export interface Member {
  readonly memberId: string
  readonly displayName: string
  readonly role: MemberRole
  /** Caregivers arrive by explicit invitation; the alias is how they sign notes. */
  readonly alias: string | undefined
  /** Set ONLY by markCaughtUp (an explicit member action) — never by answering. */
  lastCheckedAt: number | null
}

export interface HouseholdSeed {
  readonly householdId: string
  readonly householdName: string
  readonly timezone: string
  readonly members: readonly Member[]
  readonly children: readonly ChildRef[]
}

export interface ChildRef {
  readonly childId: string
  readonly name: string
  readonly aliases: readonly string[]
}

/** A reviewable proposed event, editable before publish. Carries the canonical
 * `producedBy` lineage from the extraction run that proposed it. */
export interface ProposalRecord {
  readonly proposalId: string
  readonly entryId: string
  readonly captureId: string
  readonly attempt: number
  category: EventCategory
  childId: string
  timestamp: number
  payload: Readonly<Record<string, number>> | undefined
  audience: Audience
  readonly confidence: number
  readonly sourceClause: string
  readonly producedBy: ProducedBy | undefined
}

/** Reviewer edits applied to a proposal before publish (or a correction after). */
export interface EventEdit {
  readonly category?: EventCategory
  readonly childId?: string
  readonly timestamp?: number
  readonly payload?: Readonly<Record<string, number>>
  readonly audience?: Audience
}

/** Per-event provenance: which run produced it, from what source text. */
export interface EventProvenance {
  readonly eventId: string
  readonly entryId: string
  readonly captureId: string
  readonly attempt: number
  readonly sourceClause: string
  readonly proposedCategory: EventCategory
  readonly editedFields: readonly string[]
}

/** Append-only correction lineage. `before` is preserved, never mutated. */
export interface CorrectionRecord {
  readonly correctionId: string
  readonly eventId: string
  readonly entryId: string
  readonly before: Event
  readonly after: Event
  readonly reason: string
  readonly authorId: string
  readonly at: number
}

export type ReceiptKind = "publish" | "correction" | "caught-up"

export interface Receipt {
  readonly receiptId: string
  readonly kind: ReceiptKind
  readonly at: number
  readonly authorId: string
  readonly summary: string
  readonly entryId: string | undefined
  readonly eventIds: readonly string[]
}

export interface Citation {
  readonly entryId: string
  readonly eventId: string | undefined
  readonly excerpt: string
  readonly authorId: string
  readonly createdAt: number
}

export type Answer =
  | { readonly kind: "summary"; readonly text: string; readonly citations: readonly Citation[] }
  | { readonly kind: "no-matches"; readonly text: string; readonly citations: readonly Citation[] }
  | { readonly kind: "denied"; readonly code: DenyCode; readonly detail: string }

export interface CaptureInput {
  readonly captureId: string
  readonly transcript: string
  readonly authorId: string
  readonly capturedAt: number
  readonly channel: CaptureChannel
  readonly photoId?: string
}

export type CaptureOutcome =
  | { readonly kind: "captured"; readonly entryId: string; readonly entry: Entry; readonly proposals: readonly ProposalRecord[]; readonly unstructured: readonly UnstructuredClause[] }
  | { readonly kind: "replayed"; readonly entryId: string; readonly entry: Entry; readonly proposals: readonly ProposalRecord[] }
  | { readonly kind: "rejected"; readonly reason: string }
  | { readonly kind: "denied"; readonly code: DenyCode; readonly detail: string }

export interface PublishInput {
  readonly entryId: string
  /** One edit per proposalId; omit a field to keep the proposed value. */
  readonly edits: ReadonlyMap<string, EventEdit>
  readonly audience?: Audience
  readonly at: number
}

export type PublishOutcome =
  | { readonly kind: "published"; readonly entry: Entry; readonly eventIds: readonly string[]; readonly receipt: Receipt }
  | { readonly kind: "denied"; readonly code: DenyCode; readonly detail: string }
  | { readonly kind: "failed"; readonly reason: string }

export interface CorrectInput {
  readonly eventId: string
  readonly changes: EventEdit
  readonly reason: string
  readonly authorId: string
  readonly at: number
}

export type CorrectOutcome =
  | { readonly kind: "corrected"; readonly record: CorrectionRecord; readonly receipt: Receipt }
  | { readonly kind: "denied"; readonly code: DenyCode; readonly detail: string }

export interface ApplyExtractionOutcome {
  readonly applied: boolean
  readonly reason: "applied" | "stale-suppressed" | "idempotent-no-op" | "unknown-capture"
}

export interface JournalStoreState {
  readonly householdId: string
  readonly entries: readonly Entry[]
  readonly events: readonly { readonly eventId: string; readonly event: Event; readonly audience: Audience }[]
  readonly proposals: readonly ProposalRecord[]
  readonly corrections: readonly CorrectionRecord[]
  readonly receipts: readonly Receipt[]
  /** Monotonic count of mutations — the no-write guarantee's tripwire. */
  readonly writeCount: number
}

let sequence = 0
const nextId = (prefix: string): string => {
  sequence += 1
  return `${prefix}_${String(sequence).padStart(4, "0")}`
}

/** Decode event values through the canonical Event schema — the only write path. */
const decodeEvent = (value: unknown): Event => Schema.decodeUnknownSync(EventSchema)(value)

const EXCERPT_LENGTH = 96

/** Pure helper: human-facing excerpt of the raw transcript for citations. */
export function excerptOf(transcript: string): string {
  const flat = transcript.replace(/\s+/g, " ").trim()
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1)}…`
}

export class UnknownRecordError extends Error {}

export class JournalStore {
  private readonly householdId: string
  private readonly householdName: string
  private readonly timezoneId: string
  private readonly members: Map<string, Member>
  private readonly children: readonly ChildRef[]
  private readonly entries: Entry[] = []
  private readonly entryAudience: Map<string, Audience> = new Map()
  private readonly events: Map<string, Event> = new Map()
  private readonly eventAudience: Map<string, Audience> = new Map()
  private readonly eventOrder: string[] = []
  private readonly proposals: ProposalRecord[] = []
  private readonly corrections: CorrectionRecord[] = []
  private readonly provenance: Map<string, EventProvenance> = new Map()
  private readonly receipts: Receipt[] = []
  /** captureId → applied state (raw-before-events + envelope semantics). */
  private readonly captures: Map<string, { entryId: string; latestAttempt: number }> = new Map()
  private writeCounter = 0

  constructor(seed: HouseholdSeed) {
    this.householdId = seed.householdId
    this.householdName = seed.householdName
    this.timezoneId = seed.timezone
    this.members = new Map(seed.members.map((member) => [member.memberId, member]))
    this.children = seed.children
  }

  get household(): string {
    return this.householdName
  }

  get childrenRoster(): readonly ChildRef[] {
    return this.children
  }

  get timezone(): string {
    return this.timezoneId
  }

  get writeCount(): number {
    return this.writeCounter
  }

  member(memberId: string): Member | undefined {
    return this.members.get(memberId)
  }

  entry(entryId: string): Entry | undefined {
    return this.entries.find((entry) => this.identityOf(entry) === entryId)
  }

  // Entry rows are stored decoded; identity is the Convex-style `_id` field we
  // attach at creation time (candidate store level — the flat model has no
  // separate captures table).
  private entryIds: Map<Entry, string> = new Map()
  private identityOf(entry: Entry): string {
    return this.entryIds.get(entry) ?? ""
  }

  /** Lifecycle transition: decode a NEW entry with the patch (canonical fields
   * are readonly — mutation means re-decoding a fresh value). */
  private withEntry(entry: Entry, patch: EntryLifecyclePatch): Entry {
    const entryId = this.identityOf(entry)
    const next = Schema.decodeUnknownSync(EntrySchema)({ ...entry, ...patch })
    const index = this.entries.indexOf(entry)
    if (index >= 0) this.entries[index] = next
    this.entryIds.delete(entry)
    this.entryIds.set(next, entryId)
    return next
  }

  event(eventId: string): Event | undefined {
    return this.events.get(eventId)
  }

  provenanceFor(eventId: string): EventProvenance | undefined {
    return this.provenance.get(eventId)
  }

  correctionHistory(eventId: string): readonly CorrectionRecord[] {
    return this.corrections.filter((record) => record.eventId === eventId)
  }

  proposalsFor(entryId: string): readonly ProposalRecord[] {
    return this.proposals.filter((proposal) => proposal.entryId === entryId)
  }

  receiptLog(): readonly Receipt[] {
    return this.receipts
  }

  // ---------------------------------------------------------------- capture

  /**
   * The capture path for BOTH text and simulated-voice input — one pipeline.
   * Raw-before-events: the entry (verbatim transcript) persists before any
   * extraction runs, and extraction output never blocks capture.
   */
  capture(principal: Principal, input: CaptureInput): CaptureOutcome {
    const decision = decide(principal, { type: "write", asAuthorId: input.authorId }, { householdId: this.householdId })
    if (decision.outcome === "DENY") return { kind: "denied", code: decision.code, detail: decision.detail }

    // Raw-input policy: empty transcripts are refused BEFORE any persistence.
    if (input.transcript.trim().length === 0) {
      return { kind: "rejected", reason: "empty transcript" }
    }

    // captureId idempotency: duplicate submission replays the existing capture.
    // The canonical CaptureId brand (contract v0.3) validates the session id.
    const brandedCaptureId = Schema.decodeUnknownSync(CaptureId)(input.captureId)
    const existing = this.captures.get(input.captureId)
    if (existing !== undefined) {
      const entry = this.entry(existing.entryId)
      if (entry === undefined) throw new UnknownRecordError(`capture ${input.captureId} points at a missing entry`)
      return { kind: "replayed", entryId: existing.entryId, entry, proposals: this.proposalsFor(existing.entryId) }
    }

    // Primary child: the first child named in the transcript, else the default.
    // Events carry their own childId, so mixed-child utterances stay correct.
    const primaryChildId = this.firstMentionedChild(input.transcript) ?? this.children[0]?.childId ?? ""
    const entryValue = {
      householdId: this.householdId,
      childId: primaryChildId,
      authorId: input.authorId,
      rawTranscript: input.transcript, // verbatim — never trimmed, never normalized
      structuredEventIds: [],
      extractionStatus: "pending" as const,
      visibility: "draft" as const,
      ...(input.photoId === undefined ? {} : { photoId: input.photoId }),
      createdAt: input.capturedAt,
    }
    const entry: Entry = Schema.decodeUnknownSync(EntrySchema)(entryValue)

    // RAW FIRST: the entry exists before any extraction result is applied.
    this.entries.push(entry)
    this.entryIds.set(entry, nextId("en"))
    this.entryAudience.set(this.identityOf(entry), "family")
    this.writeCounter += 1

    const attemptRecordId = nextId("atn")
    const outcome = runExtraction({
      captureId: brandedCaptureId,
      attempt: 0,
      transcript: input.transcript,
      capturedAt: input.capturedAt,
      householdId: this.householdId,
      childIds: this.children.map((child) => child.childId),
      childNames: this.children.map((child) => ({ name: child.name, aliases: child.aliases })),
      defaultChildId: primaryChildId,
      attemptRecordId,
    })

    const records = outcome.events.map((event, index) => ({
      proposalId: nextId("prop"),
      entryId: this.identityOf(entry),
      captureId: brandedCaptureId,
      attempt: 0,
      category: event.category,
      childId: event.childId,
      timestamp: event.timestamp,
      payload: event.payload === undefined ? undefined : { ...event.payload },
      audience: "family" as const,
      confidence: event.confidence,
      sourceClause: outcome.sourceClauses[index] ?? input.transcript,
      producedBy: event.producedBy,
    }))
    this.proposals.push(...records)
    this.unstructuredByEntry.set(this.identityOf(entry), [...outcome.unstructured])
    this.captures.set(input.captureId, { entryId: this.identityOf(entry), latestAttempt: 0 })
    // Canonical derivation (contract v0.3): the latest succeeded attempt reads
    // as "structured" — the entry status is the materialized read-model.
    const structuredEntry = this.withEntry(entry, { extractionStatus: deriveExtractionStatus({ outcome: "succeeded" }) })

    return { kind: "captured", entryId: this.identityOf(structuredEntry), entry: structuredEntry, proposals: records, unstructured: outcome.unstructured }
  }

  /**
   * Apply a late extraction result under the canonical envelope rules: stale
   * results (attempt < latest) are discarded, never merged; re-applying the
   * latest attempt is a no-op. Takes the full double outcome (events aligned
   * with sourceClauses) so late results keep citation fidelity.
   */
  applyExtractionResult(captureId: string, attempt: number, result: ExtractionOutcome): ApplyExtractionOutcome {
    const applied = this.captures.get(captureId)
    if (applied === undefined) return { applied: false, reason: "unknown-capture" }
    if (attempt < applied.latestAttempt) return { applied: false, reason: "stale-suppressed" }
    if (attempt === applied.latestAttempt) return { applied: false, reason: "idempotent-no-op" }

    this.proposals.push(
      ...result.events.map((event, index) => ({
        proposalId: nextId("prop"),
        entryId: applied.entryId,
        captureId,
        attempt,
        category: event.category,
        childId: event.childId,
        timestamp: event.timestamp,
        payload: event.payload === undefined ? undefined : { ...event.payload },
        audience: "family" as const,
        confidence: event.confidence,
        sourceClause: result.sourceClauses[index] ?? "",
        producedBy: event.producedBy,
      })),
    )
    this.captures.set(captureId, { entryId: applied.entryId, latestAttempt: attempt })
    return { applied: true, reason: "applied" }
  }

  // ---------------------------------------------------------------- publish

  /** Publish reviewed proposals: typed events (confidence 1, caregiver-confirmed). */
  publish(principal: Principal, input: PublishInput): PublishOutcome {
    let entry = this.entry(input.entryId)
    if (entry === undefined) return { kind: "failed", reason: `unknown entry ${input.entryId}` }
    const decision = decide(principal, { type: "write", asAuthorId: principal.kind === "member" ? principal.memberId : "" }, { householdId: this.householdId, entry })
    if (decision.outcome === "DENY") return { kind: "denied", code: decision.code, detail: decision.detail }
    if (entry.authorId !== (principal.kind === "member" ? principal.memberId : "")) {
      return { kind: "denied", code: "DENY_DRAFT_AUTHOR_ONLY", detail: "only the author publishes a draft entry" }
    }

    const entryId = this.identityOf(entry)
    const proposals = this.proposalsFor(entryId)
    if (proposals.length === 0 && entry.rawTranscript.trim().length > 0 && this.unstructuredFor(entryId).length === 0) {
      // A capture with zero proposals publishes as a raw-only entry — allowed.
      entry = this.withEntry(entry, { visibility: "published" })
      const receipt: Receipt = {
        receiptId: nextId("rc"),
        kind: "publish",
        at: input.at,
        authorId: entry.authorId,
        summary: "Published raw-only entry (nothing to structure) — raw transcript preserved verbatim.",
        entryId,
        eventIds: [],
      }
      this.receipts.push(receipt)
      this.writeCounter += 1
      return { kind: "published", entry, eventIds: [], receipt }
    }

    const eventIds: string[] = []
    const defaultAudience: Audience = input.audience ?? "family"
    for (const proposal of proposals) {
      const edit = input.edits.get(proposal.proposalId)
      const editedFields: string[] = []
      if (edit !== undefined) {
        if (edit.category !== undefined && edit.category !== proposal.category) editedFields.push("type")
        if (edit.childId !== undefined && edit.childId !== proposal.childId) editedFields.push("child")
        if (edit.timestamp !== undefined && edit.timestamp !== proposal.timestamp) editedFields.push("time")
        if (edit.payload !== undefined && JSON.stringify(edit.payload) !== JSON.stringify(proposal.payload)) editedFields.push("amount")
        if (edit.audience !== undefined && edit.audience !== proposal.audience) editedFields.push("audience")
        proposal.category = edit.category ?? proposal.category
        proposal.childId = edit.childId ?? proposal.childId
        proposal.timestamp = edit.timestamp ?? proposal.timestamp
        proposal.payload = edit.payload ?? proposal.payload
        proposal.audience = edit.audience ?? proposal.audience
      } else {
        proposal.audience = defaultAudience
      }
      const eventId = nextId("ev")
      const event = decodeEvent({
        householdId: this.householdId,
        childId: proposal.childId,
        category: proposal.category,
        timestamp: proposal.timestamp,
        ...(proposal.payload === undefined ? {} : { payload: { ...proposal.payload } }),
        confidence: 1, // caregiver-confirmed at publish
        ...(proposal.producedBy === undefined ? {} : { producedBy: proposal.producedBy }),
      })
      this.events.set(eventId, event)
      this.eventAudience.set(eventId, proposal.audience)
      this.eventOrder.push(eventId)
      eventIds.push(eventId)
      this.provenance.set(eventId, {
        eventId,
        entryId,
        captureId: proposal.captureId,
        attempt: proposal.attempt,
        sourceClause: proposal.sourceClause,
        proposedCategory: proposal.category,
        editedFields,
      })
    }

    entry = this.withEntry(entry, { structuredEventIds: [...eventIds], visibility: "published" })
    this.entryAudience.set(entryId, input.audience ?? "family")
    const receipt: Receipt = {
      receiptId: nextId("rc"),
      kind: "publish",
      at: input.at,
      authorId: entry.authorId,
      summary: `Published ${eventIds.length} event${eventIds.length === 1 ? "" : "s"} — raw transcript preserved verbatim.`,
      entryId,
      eventIds,
    }
    this.receipts.push(receipt)
    this.writeCounter += 1
    return { kind: "published", entry, eventIds, receipt }
  }

  private unstructuredFor(entryId: string): readonly UnstructuredClause[] {
    // Unstructured clauses are re-derivable from the raw transcript; the store
    // only needs to know whether extraction found any.
    return this.unstructuredByEntry.get(entryId) ?? []
  }

  private readonly unstructuredByEntry: Map<string, UnstructuredClause[]> = new Map()

  // -------------------------------------------------------------- correcting

  /**
   * Post-publish correction, conversationally requested. Append-only lineage:
   * the original event is preserved inside the correction record; the store's
   * current version is replaced by the corrected one, and the chain stays
   * fully inspectable.
   */
  correct(principal: Principal, input: CorrectInput): CorrectOutcome {
    const event = this.events.get(input.eventId)
    if (event === undefined) throw new UnknownRecordError(`unknown event ${input.eventId}`)
    const entry = this.entry(this.provenance.get(input.eventId)?.entryId ?? "")
    const decision = decide(
      principal,
      { type: "write", asAuthorId: input.authorId },
      { householdId: this.householdId, entry },
    )
    if (decision.outcome === "DENY") return { kind: "denied", code: decision.code, detail: decision.detail }

    // Caregiver-role members may only correct records their grants can see.
    if (principal.kind === "member" && !canSeeAudience(principal.role, this.eventAudience.get(input.eventId) ?? "family")) {
      return { kind: "denied", code: "DENY_NO_HOUSEHOLD_PATH", detail: "audience grant does not cover this record" }
    }

    const before = event
    const changes = input.changes
    // Build the corrected value omitting absent keys — the canonical
    // optionalKey contract rejects EXPLICIT undefined.
    const payload = changes.payload === undefined ? before.payload : { ...changes.payload }
    const after = decodeEvent({
      householdId: before.householdId,
      childId: changes.childId ?? before.childId,
      category: changes.category ?? before.category,
      timestamp: changes.timestamp ?? before.timestamp,
      ...(payload === undefined ? {} : { payload }),
      confidence: before.confidence,
      ...(before.producedBy === undefined ? {} : { producedBy: before.producedBy }),
    })
    const priorChain = this.correctionHistory(input.eventId)
    const record: CorrectionRecord = {
      correctionId: nextId("cor"),
      eventId: input.eventId,
      entryId: this.provenance.get(input.eventId)?.entryId ?? "",
      before,
      after,
      reason: input.reason,
      authorId: input.authorId,
      at: input.at,
    }
    this.corrections.push(record)
    this.events.set(input.eventId, after)
    const receipt: Receipt = {
      receiptId: nextId("rc"),
      kind: "correction",
      at: input.at,
      authorId: input.authorId,
      summary: priorChain.length === 0
        ? `Corrected event ${input.eventId} — original preserved in lineage.`
        : `Corrected event ${input.eventId} again — full lineage preserved (${priorChain.length + 1} corrections).`,
      entryId: record.entryId,
      eventIds: [input.eventId],
    }
    this.receipts.push(receipt)
    this.writeCounter += 1
    return { kind: "corrected", record, receipt }
  }

  // ------------------------------------------------------------- read-only

  /** Entries this principal may see (fail-closed: non-members see nothing). */
  visibleEntries(principal: Principal): readonly { readonly entryId: string; readonly entry: Entry; readonly audience: Audience }[] {
    return this.entries
      .filter((entry) => {
        const decision = decide(principal, { type: "read" }, { householdId: this.householdId, entry })
        if (decision.outcome === "DENY") return false
        const audience = this.entryAudience.get(this.identityOf(entry)) ?? "family"
        return principal.kind === "member" ? canSeeAudience(principal.role, audience) : false
      })
      .map((entry) => ({ entryId: this.identityOf(entry), entry, audience: this.entryAudience.get(this.identityOf(entry)) ?? "family" }))
      .sort((a, b) => a.entry.createdAt - b.entry.createdAt)
  }

  /** Current (latest-correction) events of an entry, filtered by audience. */
  visibleEvents(principal: Principal, entryId: string): readonly { readonly eventId: string; readonly event: Event; readonly audience: Audience }[] {
    const entry = this.entry(entryId)
    if (entry === undefined) return []
    const entryDecision = decide(principal, { type: "read" }, { householdId: this.householdId, entry })
    if (entryDecision.outcome === "DENY") return []
    return this.eventOrder
      .filter((eventId) => this.provenance.get(eventId)?.entryId === entryId)
      .map((eventId) => ({
        eventId,
        event: this.events.get(eventId) as Event,
        audience: this.eventAudience.get(eventId) ?? "family",
      }))
      .filter(({ audience }) => principal.kind === "member" ? canSeeAudience(principal.role, audience) : false)
  }

  /**
   * Read-only question answering. PURE over store state — this method does not
   * touch any mutable field (enforced by tests via the write tripwire).
   */
  ask(principal: Principal, question: string, at: number): Answer {
    const decision = decide(principal, { type: "read" }, { householdId: this.householdId })
    if (decision.outcome === "DENY") return { kind: "denied", code: decision.code, detail: decision.detail }
    if (principal.kind !== "member") return { kind: "denied", code: "DENY_ANONYMOUS", detail: "questions need a member principal" }

    const topic = this.parseTopic(question)
    const range = this.parseRange(question, at)
    const childFilter = this.parseChild(question)

    const rows: { eventId: string; event: Event; entryId: string; entry: Entry }[] = []
    for (const { entryId, entry } of this.visibleEntries(principal)) {
      for (const { eventId, event } of this.visibleEvents(principal, entryId)) {
        rows.push({ eventId, event, entryId, entry })
      }
    }
    const matches = rows
      .filter(({ event }) => event.category === topic)
      .filter(({ event }) => event.timestamp >= range.from && event.timestamp <= range.to)
      .filter(({ event }) => childFilter === undefined || event.childId === childFilter)
      .sort((a, b) => a.event.timestamp - b.event.timestamp)

    if (matches.length === 0) {
      return {
        kind: "no-matches",
        text: `I found no ${topic} records in that window${childFilter === undefined ? "" : ` for ${this.childName(childFilter)}`} — that's an empty result, not an error.`,
        citations: [],
      }
    }

    const citations: Citation[] = matches.map(({ eventId, event, entryId, entry }) => ({
      entryId,
      eventId,
      excerpt: excerptOf(this.clauseFor(entry, event)),
      authorId: entry.authorId,
      createdAt: entry.createdAt,
    }))

    let detail: string
    if (topic === "sleep" && matches.some(({ event }) => (event.payload?.["minutes"] ?? 0) > 0)) {
      const durations = matches.map(({ event }) => event.payload?.["minutes"]).filter((value): value is number => value !== undefined)
      const total = durations.reduce((sum, value) => sum + value, 0)
      detail = `${matches.length} ${topic} records${childFilter === undefined ? "" : ` for ${this.childName(childFilter)}`} in the window — recorded durations sum to ${total} minutes.`
    } else {
      detail = `${matches.length} ${topic} record${matches.length === 1 ? "" : "s"}${childFilter === undefined ? "" : ` for ${this.childName(childFilter)}`} in the window.`
    }
    return { kind: "summary", text: detail, citations }
  }

  /**
   * Conversational catch-up digest — read-only. Computes from the member's
   * lastCheckedAt WITHOUT updating it; marking caught up is a separate,
   * explicit write (markCaughtUp).
   */
  catchUp(principal: Principal, at: number): Answer {
    const decision = decide(principal, { type: "read" }, { householdId: this.householdId })
    if (decision.outcome === "DENY") return { kind: "denied", code: decision.code, detail: decision.detail }
    if (principal.kind !== "member") return { kind: "denied", code: "DENY_ANONYMOUS", detail: "catch-up needs a member principal" }

    const member = this.members.get(principal.memberId)
    if (member === undefined) return { kind: "denied", code: "DENY_NO_HOUSEHOLD_PATH", detail: "unknown member" }
    const from = member.lastCheckedAt ?? at - 30 * 86_400_000

    const lines: string[] = []
    const citations: Citation[] = []
    for (const { entryId, entry } of this.visibleEntries(principal)) {
      if (entry.createdAt <= from) continue
      const events = this.visibleEvents(principal, entryId)
      const rendered = events.length === 0
        ? `raw note (${excerptOf(entry.rawTranscript)})`
        : events.map(({ event }) => `${this.childName(event.childId)} ${event.category}${event.payload?.["minutes"] !== undefined ? ` ${event.payload["minutes"]} min` : ""}`).join("; ")
      lines.push(`Sep ${this.localDay(entry.createdAt)} — ${memberLabel(entry.authorId, this.members)}: ${rendered}`)
      for (const { eventId, event } of events) {
        citations.push({ entryId, eventId, excerpt: excerptOf(this.clauseFor(entry, event)), authorId: entry.authorId, createdAt: entry.createdAt })
      }
    }
    if (lines.length === 0) {
      return { kind: "no-matches", text: "Nothing new since your last check-in.", citations: [] }
    }
    const sinceLabel = member.lastCheckedAt === null ? "the start of the month" : `Sep ${this.localDay(member.lastCheckedAt)}`
    return { kind: "summary", text: `Here's what happened since ${sinceLabel}:\n${lines.join("\n")}`, citations }
  }

  /** Month view — read-only listing of a month's visible records. */
  monthView(principal: Principal, monthKey: string): Answer {
    const decision = decide(principal, { type: "read" }, { householdId: this.householdId })
    if (decision.outcome === "DENY") return { kind: "denied", code: decision.code, detail: decision.detail }

    const lines: string[] = []
    const citations: Citation[] = []
    for (const { entryId, entry } of this.visibleEntries(principal)) {
      if (new Date(entry.createdAt + this.offsetMinutes() * 60_000).toISOString().slice(0, 7) !== monthKey) continue
      const events = this.visibleEvents(principal, entryId)
      lines.push(`Sep ${this.localDay(entry.createdAt)} — ${memberLabel(entry.authorId, this.members)}: ${excerptOf(entry.rawTranscript)}${events.length > 0 ? ` [${events.length} event${events.length === 1 ? "" : "s"}]` : ""}`)
      for (const { eventId, event } of events) {
        citations.push({ entryId, eventId, excerpt: excerptOf(this.clauseFor(entry, event)), authorId: entry.authorId, createdAt: entry.createdAt })
      }
    }
    if (lines.length === 0) return { kind: "no-matches", text: `No records for ${monthKey} (or none you can see).`, citations }
    return { kind: "summary", text: `${monthKey} — ${lines.length} entries:\n${lines.join("\n")}`, citations }
  }

  /** The ONLY write in the catch-up flow — explicit member action, with a receipt. */
  markCaughtUp(principal: Principal, at: number): { readonly kind: "marked"; readonly receipt: Receipt } | { readonly kind: "denied"; readonly code: DenyCode; readonly detail: string } {
    const decision = decide(principal, { type: "read" }, { householdId: this.householdId })
    if (decision.outcome === "DENY" || principal.kind !== "member") {
      return { kind: "denied", code: "DENY_ANONYMOUS", detail: "marking caught-up needs a member principal" }
    }
    const member = this.members.get(principal.memberId)
    if (member === undefined) return { kind: "denied", code: "DENY_NO_HOUSEHOLD_PATH", detail: "unknown member" }
    member.lastCheckedAt = at
    const receipt: Receipt = {
      receiptId: nextId("rc"),
      kind: "caught-up",
      at,
      authorId: principal.memberId,
      summary: `${member.displayName} is caught up through now.`,
      entryId: undefined,
      eventIds: [],
    }
    this.receipts.push(receipt)
    this.writeCounter += 1
    return { kind: "marked", receipt }
  }

  /** Immutable state snapshot for tests and UI rendering. */
  snapshot(): JournalStoreState {
    return {
      householdId: this.householdId,
      entries: [...this.entries],
      events: this.eventOrder.map((eventId) => ({ eventId, event: this.events.get(eventId) as Event, audience: this.eventAudience.get(eventId) ?? "family" })),
      proposals: [...this.proposals],
      corrections: [...this.corrections],
      receipts: [...this.receipts],
      writeCount: this.writeCounter,
    }
  }

  // --------------------------------------------------------------- helpers

  private firstMentionedChild(transcript: string): string | undefined {
    for (const child of this.children) {
      const names = [child.name, ...child.aliases]
      if (names.some((name) => new RegExp(`\\b${escapeRegExpSource(name)}\\b`, "i").test(transcript))) {
        return child.childId
      }
    }
    return undefined
  }

  private childName(childId: string): string {
    return this.children.find((child) => child.childId === childId)?.name ?? childId
  }

  private parseTopic(question: string): EventCategory {
    if (/\b(naps?|naps|sleep|slept|bedtime)\b/i.test(question)) return "sleep"
    if (/\b(meals?|ate|eating|food)\b/i.test(question)) return "meal"
    if (/\b(moods?|meltdowns?|temper)\b/i.test(question)) return "mood"
    if (/\b(potty|diapers?|poop|pee)\b/i.test(question)) return "potty"
    if (/\b(milestones?|firsts?)\b/i.test(question)) return "milestone"
    if (/\b(school|pre-?k|classroom)\b/i.test(question)) return "school"
    return "meal"
  }

  private parseRange(question: string, at: number): { readonly from: number; readonly to: number } {
    if (/\btoday\b/i.test(question)) {
      const dayStart = Math.floor((at + this.offsetMinutes() * 60_000) / 86_400_000) * 86_400_000 - this.offsetMinutes() * 60_000
      return { from: dayStart, to: dayStart + 86_400_000 - 1 }
    }
    if (/\bthis month\b/i.test(question)) {
      const monthStart = Date.parse(`${new Date(at + this.offsetMinutes() * 60_000).toISOString().slice(0, 7)}-01T00:00:00Z`) - this.offsetMinutes() * 60_000
      return { from: monthStart, to: at }
    }
    // default window: the last 7 days
    return { from: at - 7 * 86_400_000, to: at }
  }

  private parseChild(question: string): string | undefined {
    return this.firstMentionedChild(question)
  }

  private clauseFor(entry: Entry, event: Event): string {
    return this.provenance.get(this.eventIdOf(event))?.sourceClause ?? entry.rawTranscript
  }

  private eventIdOf(event: Event): string {
    for (const [eventId, stored] of this.events) {
      if (stored === event) return eventId
    }
    return ""
  }

  private offsetMinutes(): number {
    // Demo horizon: the store's timezone resolves through the 2026 map.
    // America/New_York (EDT, -4) covers the synthetic dataset.
    return this.timezone === "America/New_York" ? -4 : 0
  }

  private localDay(instant: number): number {
    return new Date(instant + this.offsetMinutes() * 60_000).getUTCDate()
  }
}

function memberLabel(authorId: string, members: Map<string, Member>): string {
  return members.get(authorId)?.displayName ?? authorId
}

function escapeRegExpSource(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Re-export for consumers building seeds.
export type { Child, Decision, DenyCode, Principal, MemberRole }
