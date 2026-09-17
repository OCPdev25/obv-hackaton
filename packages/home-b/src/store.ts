/**
 * In-memory fixture store for Candidate B, mirroring the Convex adapter
 * semantics the backend thin-path functions implement:
 *
 *  - raw-before-events: a capture persists its draft Entry (raw transcript
 *    verbatim) BEFORE any extraction runs; extraction failure never blocks
 *    capture and never destroys the source.
 *  - captureId idempotency: duplicate submissions replay the existing entry —
 *    never a second entry, never new events.
 *  - extraction envelope: requests and results carry { captureId, attempt };
 *    a result applies only if it is the LATEST attempt for the capture
 *    (stale results are discarded, never merged) and applying the same
 *    (captureId, attempt) twice is a no-op.
 *  - append-only post-publish lineage: corrections never mutate a published
 *    event; the original row stays intact and each correction embeds the
 *    prior state.
 *  - fail-closed authorization: every read and write goes through
 *    ./auth.ts evaluateAccess (port of security/access/policy.ts + the
 *    audience dimension), and writes are attributed to the authenticated
 *    principal — never client-chosen.
 *  - every stored shape decodes through the canonical packages/domain schemas.
 *
 * Data never leaves the process (prototype scope — no live Convex), but the
 * shapes are the Convex document shapes (EntryDocument/EventDocument), so
 * moving to real backend functions is a storage-layer swap, not a model change.
 */
import {
  ChildDocument,
  EntryDocument,
  EventDocument,
  HouseholdDocument,
  type ChildDocument as ChildDoc,
  type EntryDocument as EntryDoc,
  type EventDocument as EventDoc,
  type ExtractionResult,
  type HouseholdDocument as HouseholdDoc,
} from "@journal/domain"
import { Schema } from "effect"
import { evaluateAccess, type Action, type AudienceIntent, type Decision, type DenyDecision, type Principal, type Resource } from "./auth.js"
import { extractProposedEvents, type CaptureContext, type DroppedClause } from "./extractionDouble.js"
import { nextIdFrom } from "./ids.js"
import { HOUSEHOLD_TIMEZONE, wallDateOf } from "./time.js"

export type CaptureChannel = "text" | "voice"

export interface Member {
  readonly caregiverId: string
  readonly name: string
  readonly role: "parent" | "caregiver"
  /** Server-maintained roster fact — never inferred from a link or share. */
  readonly householdIds: readonly string[]
  /** Last time this member opened the app (drives the "since you were away" block). */
  readonly lastSeenAt?: number
}

export interface EventCorrection {
  readonly correctionId: string
  readonly eventId: string
  readonly entryId: string
  readonly correctedBy: string
  readonly correctedAt: number
  readonly reason: string
  /** Full immutable snapshot of the event as it stood before this correction. */
  readonly priorEvent: EventDoc
  /** The corrected values (schema-validated); never written back over the original. */
  readonly correctedEvent: EventDoc
}

export interface ExtractionAttemptRecord {
  readonly captureId: string
  readonly attempt: number
  readonly triggeredBy: "original" | "reparse" | "external-result"
  readonly outcome: "succeeded" | "superseded"
  /** Snapshot of the events this attempt produced, so superseded attempts stay inspectable. */
  readonly events: readonly EventDoc[]
  readonly dropped: readonly DroppedClause[]
}

export interface SubmitCaptureInput {
  readonly captureId: string
  readonly transcript: string
  readonly channel: CaptureChannel
  readonly capturedAt: number
  readonly timezone: string
  /** Focus child chosen in the composer (clauses may name a different child). */
  readonly focusChildId: string
  readonly photoId?: string
}

export type SubmitCaptureResult =
  | { readonly _tag: "Created"; readonly entryId: string; readonly proposedEventIds: readonly string[]; readonly dropped: readonly DroppedClause[] }
  | { readonly _tag: "IdempotentReplay"; readonly entryId: string }
  | { readonly _tag: "Rejected"; readonly reason: string }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export type ProposedEventPatch = {
  readonly category?: EventDoc["category"]
  readonly childId?: string
  readonly timestamp?: number
  readonly payload?: Record<string, number>
}

export type UpdateProposedResult =
  | { readonly _tag: "Updated"; readonly event: EventDoc }
  | { readonly _tag: "Removed"; readonly eventId: string }
  | { readonly _tag: "InvalidEvent"; readonly issues: readonly string[] }
  | { readonly _tag: "NotDraft" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export type PublishResult =
  | { readonly _tag: "Published"; readonly entryId: string; readonly audience: AudienceIntent; readonly publishedEventIds: readonly string[] }
  | { readonly _tag: "NotDraft" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export type CorrectEventInput = {
  readonly eventId: string
  readonly patch: ProposedEventPatch
  readonly reason: string
}

export type CorrectEventResult =
  | { readonly _tag: "Corrected"; readonly correction: EventCorrection }
  | { readonly _tag: "InvalidEvent"; readonly issues: readonly string[] }
  | { readonly _tag: "NotPublished" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export type AudienceResult =
  | { readonly _tag: "AudienceSet"; readonly entryId: string; readonly audience: AudienceIntent }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export type RerunResult =
  | { readonly _tag: "Rerun"; readonly attempt: number; readonly proposedEventIds: readonly string[]; readonly dropped: readonly DroppedClause[] }
  | { readonly _tag: "NotDraft" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export type ApplyResultResult =
  | { readonly _tag: "Applied"; readonly entryId: string; readonly attempt: number }
  | { readonly _tag: "Superseded" }
  | { readonly _tag: "IdempotentNoop" }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export interface FeedEventView {
  readonly eventId: string
  readonly entryId: string
  readonly category: EventDoc["category"]
  readonly childId: string
  readonly childName: string
  readonly authorId: string
  readonly authorName: string
  readonly timestamp: number
  readonly payload?: Record<string, number>
  readonly confidence: number
  readonly captureId: string
  readonly channel: CaptureChannel
  readonly rawTranscript: string
  readonly audience: AudienceIntent
  readonly visibility: "draft" | "published"
  readonly photoId?: string
  /** True when at least one append-only correction exists for this event. */
  readonly hasLineage: boolean
  /** Prior payload when the latest correction changed the quantity. */
  readonly correctedFrom?: Record<string, number>
}

export interface EventDetailView {
  readonly view: FeedEventView
  readonly corrections: readonly EventCorrection[]
  readonly entryCreatedAt: number
}

export interface FeedFilter {
  readonly day?: { readonly year: number; readonly month: number; readonly day: number }
  readonly childId?: string
}

export type FeedResult =
  | { readonly _tag: "Feed"; readonly published: readonly FeedEventView[]; readonly drafts: readonly FeedEventView[] }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export type CatchUpResult =
  | { readonly _tag: "CatchUp"; readonly since: number; readonly events: readonly FeedEventView[] }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export type MonthSummary =
  | { readonly _tag: "MonthSummary"; readonly days: readonly { readonly day: number; readonly count: number }[] }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export type EventDetailResult =
  | { readonly _tag: "Detail"; readonly detail: EventDetailView }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export type RawSourceResult =
  | {
      readonly _tag: "RawSource"
      readonly transcript: string
      readonly authorId: string
      readonly createdAt: number
      readonly captureId: string
      readonly channel: CaptureChannel
      readonly visibility: "draft" | "published"
      readonly photoId?: string
    }
  | { readonly _tag: "NotFound" }
  | { readonly _tag: "Denied"; readonly decision: DenyDecision }

export interface WorldSeed {
  readonly household: HouseholdDoc
  readonly children: readonly ChildDoc[]
  readonly members: readonly Member[]
}

export interface StoreOptions {
  /** Injectable clock for correction timestamps; defaults to the Sep 2026 demo clock. */
  readonly now?: () => number
}

interface CaptureMeta {
  readonly entryId: string
  readonly channel: CaptureChannel
  readonly timezone: string
}

type EventFieldsInput = Omit<EventDoc, "_id" | "_creationTime">

/** Sep 1 2026 00:00 household-local (America/New_York, EDT = UTC-4) — the dataset boundary. */
const MONTH_START_MS = Date.UTC(2026, 8, 1, 4, 0, 0)

export class HomeBStore {
  private readonly household: HouseholdDoc
  private readonly children: ChildDoc[]
  private readonly members: Member[]
  private readonly entries: EntryDoc[] = []
  private events: EventDoc[] = []
  private readonly attempts: ExtractionAttemptRecord[] = []
  private readonly corrections: EventCorrection[] = []
  private readonly captureIndex = new Map<string, CaptureMeta>()
  private readonly entryEventsIndex = new Map<string, string[]>()
  private readonly audienceIntents = new Map<string, AudienceIntent>()
  private readonly lastSeen = new Map<string, number>()
  private seq = 0
  private readonly now: () => number

  constructor(seed: WorldSeed, options: StoreOptions = {}) {
    this.household = Schema.decodeUnknownSync(HouseholdDocument)(seed.household)
    this.children = seed.children.map((c) => Schema.decodeUnknownSync(ChildDocument)(c))
    this.members = seed.members.map((m) => ({ ...m }))
    for (const m of this.members) {
      if (m.lastSeenAt !== undefined) this.lastSeen.set(m.caregiverId, m.lastSeenAt)
    }
    this.now = options.now ?? (() => Date.now())
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /** Resolve roster facts from the store's member list — never from the wire shape. */
  private principalFor(principal: Principal): Principal {
    if (principal.kind === "anonymous") return principal
    const member = this.members.find((m) => m.caregiverId === principal.caregiverId)
    if (member === undefined) {
      return { kind: "caregiver", caregiverId: principal.caregiverId, name: principal.caregiverId, role: "caregiver", householdIds: [] }
    }
    return { kind: "caregiver", caregiverId: member.caregiverId, name: member.name, role: member.role, householdIds: member.householdIds }
  }

  private scopeFor(childId: string): { childId: string; householdId: string } {
    return { childId, householdId: this.household._id }
  }

  private authorize(principal: Principal, action: Action, resource: Resource): Decision {
    return evaluateAccess(this.principalFor(principal), action, resource)
  }

  private nextId(prefix: string): string {
    this.seq += 1
    return nextIdFrom(prefix, this.seq)
  }

  private entryById(entryId: string): EntryDoc | undefined {
    return this.entries.find((e) => e._id === entryId)
  }

  private eventById(eventId: string): EventDoc | undefined {
    return this.events.find((e) => e._id === eventId)
  }

  private childName(childId: string): string {
    return this.children.find((c) => c._id === childId)?.name ?? childId
  }

  private authorName(authorId: string): string {
    return this.members.find((m) => m.caregiverId === authorId)?.name ?? authorId
  }

  private audienceOf(entryId: string): AudienceIntent {
    return this.audienceIntents.get(entryId) ?? "household"
  }

  private latestAttempt(captureId: string): number {
    let latest = -1
    for (const record of this.attempts) {
      if (record.captureId === captureId && record.attempt > latest) latest = record.attempt
    }
    return latest
  }

  private attemptSucceeded(captureId: string, attempt: number): boolean {
    return this.attempts.some((a) => a.captureId === captureId && a.attempt === attempt && a.outcome === "succeeded")
  }

  private entryByCaptureId(captureId: string): EntryDoc | undefined {
    const meta = this.captureIndex.get(captureId)
    return meta === undefined ? undefined : this.entryById(meta.entryId)
  }

  private captureMetaForEntry(entryId: string): { captureId: string; channel: CaptureChannel } | undefined {
    for (const [captureId, meta] of this.captureIndex) {
      if (meta.entryId === entryId) return { captureId, channel: meta.channel }
    }
    return undefined
  }

  private entryForEvent(eventId: string): string | undefined {
    for (const [entryId, ids] of this.entryEventsIndex) {
      if (ids.includes(eventId)) return entryId
    }
    return undefined
  }

  private eventDoc(fields: EventFieldsInput, entry: EntryDoc, _id: string, _creationTime: number): EventDoc {
    const { payload, ...rest } = fields
    return Schema.decodeUnknownSync(EventDocument)({
      ...rest,
      // optionalKey: an absent key is valid, an explicit undefined is not.
      ...(payload !== undefined ? { payload } : {}),
      // Household scoping is always enforced from the owning entry, never trusted from the caller.
      householdId: entry.householdId,
      _id,
      _creationTime,
    })
  }

  private toView(event: EventDoc, entry: EntryDoc): FeedEventView {
    const corrections = this.corrections.filter((c) => c.eventId === event._id)
    const latest = corrections.at(-1)
    const display = latest === undefined ? event : latest.correctedEvent
    const meta = this.captureMetaForEntry(entry._id)
    const payloadChanged =
      latest !== undefined &&
      JSON.stringify(latest.priorEvent.payload ?? null) !== JSON.stringify(latest.correctedEvent.payload ?? null)
    return {
      eventId: event._id,
      entryId: entry._id,
      category: display.category,
      childId: display.childId,
      childName: this.childName(display.childId),
      authorId: entry.authorId,
      authorName: this.authorName(entry.authorId),
      timestamp: display.timestamp,
      payload: display.payload,
      confidence: display.confidence,
      captureId: meta?.captureId ?? "",
      channel: meta?.channel ?? "text",
      rawTranscript: entry.rawTranscript,
      audience: this.audienceOf(entry._id),
      visibility: entry.visibility,
      photoId: entry.photoId,
      hasLineage: corrections.length > 0,
      correctedFrom: payloadChanged && event.payload !== undefined ? { ...event.payload } : undefined,
    }
  }

  /** Visible, published event views for a principal, optionally filtered by day/child. Newest first. */
  private visiblePublishedViews(principal: Principal, filter: FeedFilter): readonly FeedEventView[] | DenyDecision {
    const firstChild = this.children[0]
    if (firstChild === undefined) {
      return { outcome: "DENY", code: "DENY_UNKNOWN_CHILD_SCOPE", detail: "no children are registered in this household" }
    }
    const timelineDecision = this.authorize(principal, { type: "read" }, { kind: "childTimeline", scope: this.scopeFor(firstChild._id) })
    if (timelineDecision.outcome === "DENY") return timelineDecision

    const views: FeedEventView[] = []
    for (const entry of this.entries) {
      if (entry.visibility !== "published") continue
      const decision = this.authorize(
        principal,
        { type: "read" },
        { kind: "entry", scope: this.scopeFor(entry.childId), entry, audience: this.audienceOf(entry._id) },
      )
      if (decision.outcome === "DENY") continue // invisible data is excluded, not an error
      for (const eventId of this.entryEventsIndex.get(entry._id) ?? []) {
        const event = this.eventById(eventId)
        if (event === undefined) continue
        const view = this.toView(event, entry)
        if (filter.childId !== undefined && view.childId !== filter.childId) continue
        if (filter.day !== undefined) {
          const wall = wallDateOf(HOUSEHOLD_TIMEZONE, view.timestamp)
          if (wall.year !== filter.day.year || wall.month !== filter.day.month || wall.day !== filter.day.day) continue
        }
        views.push(view)
      }
    }
    return views.sort((a, b) => b.timestamp - a.timestamp || b.entryId.localeCompare(a.entryId))
  }

  private childIdByName(): Record<string, string> {
    const map: Record<string, string> = {}
    for (const child of this.children) map[child.name.toLowerCase()] = child._id
    return map
  }

  /** Replace a DRAFT entry's proposed event set with a validated new set. */
  private applyProposedEvents(entry: EntryDoc, events: readonly EventFieldsInput[]): readonly string[] {
    // Draft stage only — published event sets are never replaced by a reparse.
    const prior = this.entryEventsIndex.get(entry._id) ?? []
    this.events = this.events.filter((e) => !prior.includes(e._id))
    this.entryEventsIndex.set(entry._id, [])

    const ids: string[] = []
    for (const fields of events) {
      const doc = this.eventDoc(fields, entry, this.nextId("evt"), entry.createdAt)
      this.events.push(doc)
      ids.push(doc._id)
    }
    this.entryEventsIndex.set(entry._id, ids)

    // Draft-stage lifecycle fields update in place; the raw transcript is untouched.
    this.updateEntry(entry._id, (current) => ({
      ...current,
      structuredEventIds: ids,
      extractionStatus: "structured", // an attempt completed, whatever it yielded
    }))
    return ids
  }

  private updateEntry(entryId: string, mutate: (current: EntryDoc) => EntryDoc): void {
    const index = this.entries.findIndex((e) => e._id === entryId)
    const current = this.entries[index]
    if (current === undefined) return
    this.entries[index] = Schema.decodeUnknownSync(EntryDocument)(mutate(current))
  }

  private recordAttempt(record: ExtractionAttemptRecord): void {
    this.attempts.push(record)
  }

  // ---------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------

  /**
   * Full capture pipeline for one dictation (voice and text are the SAME
   * pipeline): persist the raw draft entry first, then run the deterministic
   * double and attach the proposed events to the draft for review.
   */
  submitCapture(principal: Principal, input: SubmitCaptureInput): SubmitCaptureResult {
    // Attribution binds to the AUTHENTICATED principal, never a client-chosen authorId.
    const authorId = principal.kind === "caregiver" ? principal.caregiverId : ""
    const decision = this.authorize(
      principal,
      { type: "write", asAuthorId: authorId },
      { kind: "childTimeline", scope: this.scopeFor(input.focusChildId) },
    )
    if (decision.outcome === "DENY") return { _tag: "Denied", decision }

    // Raw-input policy refusal (the only Rejected reason — never extraction failure).
    if (input.transcript.length === 0) return { _tag: "Rejected", reason: "empty transcript" }

    // Idempotency: same captureId replays the existing entry.
    const existing = this.captureIndex.get(input.captureId)
    if (existing !== undefined) return { _tag: "IdempotentReplay", entryId: existing.entryId }

    // RAW-BEFORE-EVENTS: the draft entry (raw transcript verbatim) persists
    // before any extraction runs.
    const entryId = this.nextId("ent")
    const entry = Schema.decodeUnknownSync(EntryDocument)({
      _id: entryId,
      _creationTime: input.capturedAt,
      householdId: this.household._id,
      childId: input.focusChildId,
      authorId,
      rawTranscript: input.transcript,
      structuredEventIds: [],
      extractionStatus: "pending",
      visibility: "draft",
      ...(input.photoId !== undefined ? { photoId: input.photoId } : {}),
      createdAt: input.capturedAt,
    })
    this.entries.push(entry)
    this.entryEventsIndex.set(entryId, [])
    this.captureIndex.set(input.captureId, { entryId, channel: input.channel, timezone: input.timezone })

    const context: CaptureContext = {
      householdId: this.household._id,
      authorId,
      capturedAt: input.capturedAt,
      timezone: input.timezone,
      childIdByName: this.childIdByName(),
    }
    const outcome = extractProposedEvents(input.transcript, context)
    const proposedEventIds = this.applyProposedEvents(entry, outcome.events)
    this.recordAttempt({
      captureId: input.captureId,
      attempt: 0,
      triggeredBy: "original",
      outcome: "succeeded",
      events: proposedEventIds.map((id) => this.eventById(id)).filter((e): e is EventDoc => e !== undefined),
      dropped: outcome.dropped,
    })

    return { _tag: "Created", entryId, proposedEventIds, dropped: outcome.dropped }
  }

  /**
   * The applying layer of the extraction envelope (contract v0.2): stale-result
   * suppression + idempotent completion, testable without a second extractor.
   */
  applyExtractionResult(principal: Principal, result: ExtractionResult): ApplyResultResult {
    const entry = this.entryByCaptureId(result.captureId)
    if (entry === undefined) return { _tag: "NotFound" }

    const decision = this.authorize(
      principal,
      { type: "write", asAuthorId: principal.kind === "caregiver" ? principal.caregiverId : "" },
      { kind: "entry", scope: this.scopeFor(entry.childId), entry, audience: this.audienceOf(entry._id) },
    )
    if (decision.outcome === "DENY") return { _tag: "Denied", decision }

    const latest = this.latestAttempt(result.captureId)
    if (result.attempt < latest) {
      // Stale-result suppression: discarded, never merged. The superseded
      // attempt stays visible (marked) in the append-only history.
      this.recordAttempt({
        captureId: result.captureId,
        attempt: result.attempt,
        triggeredBy: "external-result",
        outcome: "superseded",
        events: [],
        dropped: [],
      })
      return { _tag: "Superseded" }
    }
    if (result.attempt === latest && this.attemptSucceeded(result.captureId, result.attempt)) {
      return { _tag: "IdempotentNoop" } // idempotent completion: applying the same attempt twice changes nothing
    }
    if (entry.visibility !== "draft") {
      return { _tag: "IdempotentNoop" } // a late result never replaces published events
    }

    const ids = this.applyProposedEvents(entry, result.events)
    this.recordAttempt({
      captureId: result.captureId,
      attempt: result.attempt,
      triggeredBy: "external-result",
      outcome: "succeeded",
      events: ids.map((id) => this.eventById(id)).filter((e): e is EventDoc => e !== undefined),
      dropped: [],
    })
    return { _tag: "Applied", entryId: entry._id, attempt: result.attempt }
  }

  /** Re-run extraction over the stored raw transcript (append-only attempt history). */
  rerunExtraction(principal: Principal, captureId: string): RerunResult {
    const entry = this.entryByCaptureId(captureId)
    if (entry === undefined) return { _tag: "NotFound" }
    const decision = this.authorize(
      principal,
      { type: "write", asAuthorId: principal.kind === "caregiver" ? principal.caregiverId : "" },
      { kind: "entry", scope: this.scopeFor(entry.childId), entry, audience: this.audienceOf(entry._id) },
    )
    if (decision.outcome === "DENY") return { _tag: "Denied", decision }
    if (entry.visibility !== "draft") return { _tag: "NotDraft" }

    const attempt = this.latestAttempt(captureId) + 1
    const timezone = this.captureIndex.get(captureId)?.timezone ?? HOUSEHOLD_TIMEZONE
    const context: CaptureContext = {
      householdId: this.household._id,
      authorId: entry.authorId,
      capturedAt: entry.createdAt,
      timezone,
      childIdByName: this.childIdByName(),
    }
    const outcome = extractProposedEvents(entry.rawTranscript, context)
    const ids = this.applyProposedEvents(entry, outcome.events)
    this.recordAttempt({
      captureId,
      attempt,
      triggeredBy: "reparse",
      outcome: "succeeded",
      events: ids.map((id) => this.eventById(id)).filter((e): e is EventDoc => e !== undefined),
      dropped: outcome.dropped,
    })
    return { _tag: "Rerun", attempt, proposedEventIds: ids, dropped: outcome.dropped }
  }

  /** Review-surface edit of a proposed event (pre-publish only). Validated through the canonical schema. */
  updateProposedEvent(principal: Principal, entryId: string, eventId: string, patch: ProposedEventPatch): UpdateProposedResult {
    const entry = this.entryById(entryId)
    if (entry === undefined) return { _tag: "NotFound" }
    const decision = this.authorize(
      principal,
      { type: "write", asAuthorId: principal.kind === "caregiver" ? principal.caregiverId : "" },
      { kind: "entryEvents", scope: this.scopeFor(entry.childId), entry, audience: this.audienceOf(entryId) },
    )
    if (decision.outcome === "DENY") return { _tag: "Denied", decision }
    if (entry.visibility !== "draft") return { _tag: "NotDraft" }
    const event = this.eventById(eventId)
    if (event === undefined || !(this.entryEventsIndex.get(entryId) ?? []).includes(eventId)) return { _tag: "NotFound" }

    const candidate = {
      ...event,
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.childId !== undefined ? { childId: patch.childId } : {}),
      ...(patch.timestamp !== undefined ? { timestamp: patch.timestamp } : {}),
      ...(patch.payload !== undefined ? { payload: patch.payload } : {}),
    }
    try {
      const decoded = Schema.decodeUnknownSync(EventDocument)(candidate)
      this.events = this.events.map((e) => (e._id === decoded._id ? decoded : e))
      return { _tag: "Updated", event: decoded }
    } catch (error) {
      return { _tag: "InvalidEvent", issues: [error instanceof Error ? error.message : String(error)] }
    }
  }

  /** Remove a proposed event from a draft (pre-publish only). */
  removeProposedEvent(principal: Principal, entryId: string, eventId: string): UpdateProposedResult {
    const entry = this.entryById(entryId)
    if (entry === undefined) return { _tag: "NotFound" }
    const decision = this.authorize(
      principal,
      { type: "write", asAuthorId: principal.kind === "caregiver" ? principal.caregiverId : "" },
      { kind: "entryEvents", scope: this.scopeFor(entry.childId), entry, audience: this.audienceOf(entryId) },
    )
    if (decision.outcome === "DENY") return { _tag: "Denied", decision }
    if (entry.visibility !== "draft") return { _tag: "NotDraft" }
    const ids = this.entryEventsIndex.get(entryId) ?? []
    if (!ids.includes(eventId)) return { _tag: "NotFound" }
    this.events = this.events.filter((e) => e._id !== eventId)
    this.entryEventsIndex.set(entryId, ids.filter((id) => id !== eventId))
    this.updateEntry(entryId, (current) => ({ ...current, structuredEventIds: ids.filter((id) => id !== eventId) }))
    return { _tag: "Removed", eventId }
  }

  /**
   * Review-surface audience control — the relationship-scoped grant, stored in
   * the grants layer (never on the canonical Entry document). Author or parent
   * only; every other principal is denied.
   */
  setAudience(principal: Principal, entryId: string, intent: AudienceIntent): AudienceResult {
    const entry = this.entryById(entryId)
    if (entry === undefined) return { _tag: "NotFound" }
    const resolved = this.principalFor(principal)
    const isMember = resolved.kind === "caregiver" && resolved.householdIds.includes(this.household._id)
    const isAuthorOrParent = resolved.kind === "caregiver" && (resolved.caregiverId === entry.authorId || resolved.role === "parent")
    if (!isMember || !isAuthorOrParent) {
      return {
        _tag: "Denied",
        decision: {
          outcome: "DENY",
          code: "DENY_ATTRIBUTION_MISMATCH",
          detail: `audience changes are author-or-parent only; actor=${resolved.kind === "caregiver" ? resolved.caregiverId : "anonymous"}`,
        },
      }
    }
    this.audienceIntents.set(entryId, intent)
    return { _tag: "AudienceSet", entryId, audience: intent }
  }

  /** Publish: the caregiver-confirmation act. Events become visible; the raw source is unchanged. */
  publishEntry(principal: Principal, entryId: string, audience: AudienceIntent = "household"): PublishResult {
    const entry = this.entryById(entryId)
    if (entry === undefined) return { _tag: "NotFound" }
    const decision = this.authorize(
      principal,
      { type: "write", asAuthorId: principal.kind === "caregiver" ? principal.caregiverId : "" },
      { kind: "entry", scope: this.scopeFor(entry.childId), entry, audience: this.audienceOf(entryId) },
    )
    if (decision.outcome === "DENY") return { _tag: "Denied", decision }
    if (entry.visibility !== "draft") return { _tag: "NotDraft" }

    this.updateEntry(entryId, (current) => ({ ...current, visibility: "published" }))
    // Publish CONFIRMS a previously chosen audience; the parameter is only a
    // fallback default when the review surface never set one.
    if (!this.audienceIntents.has(entryId)) {
      this.audienceIntents.set(entryId, audience)
    }

    // Publishing confirms the events: confidence -> 1 (caregiver-confirmed).
    const publishedEventIds: string[] = []
    for (const eventId of this.entryEventsIndex.get(entryId) ?? []) {
      const event = this.eventById(eventId)
      if (event === undefined) continue
      const confirmed = Schema.decodeUnknownSync(EventDocument)({ ...event, confidence: 1 })
      this.events = this.events.map((e) => (e._id === confirmed._id ? confirmed : e))
      publishedEventIds.push(eventId)
    }
    return { _tag: "Published", entryId, audience, publishedEventIds }
  }

  /** Post-publish correction: append-only lineage. The original event row is NEVER mutated. */
  correctEvent(principal: Principal, input: CorrectEventInput): CorrectEventResult {
    const event = this.eventById(input.eventId)
    const owningEntryId = event === undefined ? undefined : this.entryForEvent(input.eventId)
    if (event === undefined || owningEntryId === undefined) return { _tag: "NotFound" }
    const entry = this.entryById(owningEntryId)
    if (entry === undefined) return { _tag: "NotFound" }

    const decision = this.authorize(
      principal,
      { type: "write", asAuthorId: principal.kind === "caregiver" ? principal.caregiverId : "" },
      { kind: "entryEvents", scope: this.scopeFor(entry.childId), entry, audience: this.audienceOf(entry._id) },
    )
    if (decision.outcome === "DENY") return { _tag: "Denied", decision }
    if (entry.visibility !== "published") return { _tag: "NotPublished" }

    const correctedAt = this.now()
    const correctedCandidate = {
      ...event,
      ...(input.patch.category !== undefined ? { category: input.patch.category } : {}),
      ...(input.patch.childId !== undefined ? { childId: input.patch.childId } : {}),
      ...(input.patch.timestamp !== undefined ? { timestamp: input.patch.timestamp } : {}),
      ...(input.patch.payload !== undefined ? { payload: input.patch.payload } : {}),
      _id: this.nextId("evt"),
      _creationTime: correctedAt,
    }
    try {
      const corrected = Schema.decodeUnknownSync(EventDocument)(correctedCandidate)
      const correction: EventCorrection = {
        correctionId: this.nextId("cor"),
        eventId: event._id,
        entryId: entry._id,
        correctedBy: principal.kind === "caregiver" ? principal.caregiverId : "",
        correctedAt,
        reason: input.reason,
        priorEvent: event,
        correctedEvent: corrected,
      }
      this.corrections.push(correction)
      return { _tag: "Corrected", correction }
    } catch (error) {
      return { _tag: "InvalidEvent", issues: [error instanceof Error ? error.message : String(error)] }
    }
  }

  /** Explicit user action ("Got it" on the catch-up block) — not a lookup. */
  markSeen(principal: Principal, at: number): void {
    if (principal.kind === "caregiver") this.lastSeen.set(principal.caregiverId, at)
  }

  // ---------------------------------------------------------------------
  // Read-only lookups — these NEVER mutate state (pinned by readonly.test.ts)
  // ---------------------------------------------------------------------

  getFeed(principal: Principal, filter: FeedFilter = {}): FeedResult {
    const published = this.visiblePublishedViews(principal, filter)
    if (isDecision(published)) return { _tag: "Denied", decision: published }

    const drafts: FeedEventView[] = []
    if (principal.kind === "caregiver") {
      for (const entry of this.entries) {
        if (entry.visibility !== "draft" || entry.authorId !== principal.caregiverId) continue
        for (const eventId of this.entryEventsIndex.get(entry._id) ?? []) {
          const event = this.eventById(eventId)
          if (event === undefined) continue
          drafts.push(this.toView(event, entry))
        }
      }
      drafts.sort((a, b) => b.timestamp - a.timestamp)
    }
    return { _tag: "Feed", published, drafts }
  }

  getMonthSummary(principal: Principal, year: number, month: number): MonthSummary {
    const views = this.visiblePublishedViews(principal, {})
    if (isDecision(views)) return { _tag: "Denied", decision: views }
    const days = new Map<number, number>()
    for (const view of views) {
      const wall = wallDateOf(HOUSEHOLD_TIMEZONE, view.timestamp)
      if (wall.year === year && wall.month === month) days.set(wall.day, (days.get(wall.day) ?? 0) + 1)
    }
    return {
      _tag: "MonthSummary",
      days: [...days.entries()].sort((a, b) => a[0] - b[0]).map(([day, count]) => ({ day, count })),
    }
  }

  getCatchUp(principal: Principal): CatchUpResult {
    if (principal.kind === "anonymous") {
      return {
        _tag: "Denied",
        decision: { outcome: "DENY", code: "DENY_ANONYMOUS", detail: "unauthenticated principal cannot read the catch-up block" },
      }
    }
    const firstChild = this.children[0]
    if (firstChild === undefined) {
      return { _tag: "Denied", decision: { outcome: "DENY", code: "DENY_UNKNOWN_CHILD_SCOPE", detail: "no children registered" } }
    }
    const decision = this.authorize(principal, { type: "read" }, { kind: "childTimeline", scope: this.scopeFor(firstChild._id) })
    if (decision.outcome === "DENY") return { _tag: "Denied", decision }

    const since = this.lastSeen.get(principal.caregiverId) ?? MONTH_START_MS
    const views = this.visiblePublishedViews(principal, {})
    if (isDecision(views)) return { _tag: "Denied", decision: views }
    const events = views.filter((v) => {
      const entry = this.entryById(v.entryId)
      return entry !== undefined && entry.createdAt > since
    })
    return { _tag: "CatchUp", since, events }
  }

  getEventDetail(principal: Principal, eventId: string): EventDetailResult {
    const event = this.eventById(eventId)
    const owningEntryId = event === undefined ? undefined : this.entryForEvent(eventId)
    if (event === undefined || owningEntryId === undefined) return { _tag: "NotFound" }
    const entry = this.entryById(owningEntryId)
    if (entry === undefined) return { _tag: "NotFound" }
    const decision = this.authorize(
      principal,
      { type: "read" },
      { kind: "entryEvents", scope: this.scopeFor(entry.childId), entry, audience: this.audienceOf(entry._id) },
    )
    if (decision.outcome === "DENY") return { _tag: "Denied", decision }
    return {
      _tag: "Detail",
      detail: {
        view: this.toView(event, entry),
        corrections: this.corrections.filter((c) => c.eventId === eventId),
        entryCreatedAt: entry.createdAt,
      },
    }
  }

  getRawSource(principal: Principal, entryId: string): RawSourceResult {
    const entry = this.entryById(entryId)
    if (entry === undefined) return { _tag: "NotFound" }
    const meta = this.captureMetaForEntry(entryId)
    const decision = this.authorize(
      principal,
      { type: "read" },
      { kind: "entry", scope: this.scopeFor(entry.childId), entry, audience: this.audienceOf(entryId) },
    )
    if (decision.outcome === "DENY") return { _tag: "Denied", decision }
    return {
      _tag: "RawSource",
      // Byte-for-byte: never trimmed, normalized, or re-encoded.
      transcript: entry.rawTranscript,
      authorId: entry.authorId,
      createdAt: entry.createdAt,
      captureId: meta?.captureId ?? "",
      channel: meta?.channel ?? "text",
      visibility: entry.visibility,
      photoId: entry.photoId,
    }
  }

  /** Deterministic JSON snapshot of all state — used by the read-only lookups test. */
  serializeState(): string {
    const snapshot = {
      household: this.household,
      children: this.children,
      members: this.members,
      entries: this.entries,
      events: this.events,
      attempts: this.attempts,
      corrections: this.corrections,
      captureIndex: [...this.captureIndex.entries()],
      audienceIntents: [...this.audienceIntents.entries()],
      lastSeen: [...this.lastSeen.entries()],
      seq: this.seq,
    }
    return stableStringify(snapshot)
  }

  counts(): { entries: number; events: number; corrections: number; attempts: number } {
    return { entries: this.entries.length, events: this.events.length, corrections: this.corrections.length, attempts: this.attempts.length }
  }
}

// ---------------------------------------------------------------------------
// Module-scope helpers (no store state)
// ---------------------------------------------------------------------------

/** Type predicate: a lookup helper returns views on success, a DENY decision on denial. */
function isDecision(x: DenyDecision | readonly FeedEventView[]): x is DenyDecision {
  return !Array.isArray(x)
}

/** Recursively key-sorted JSON — deterministic snapshots for tests. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`
  }
  return JSON.stringify(value)
}
