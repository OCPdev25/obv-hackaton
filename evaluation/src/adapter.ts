/**
 * Candidate adapter interface — the ONLY integration surface between the
 * acceptance corpus and a candidate implementation.
 *
 * The cross-review harness runs this interface IDENTICALLY against every
 * candidate. Adapters must not import corpus internals; the corpus must not
 * import candidate code. Everything a candidate owes the corpus is stated in
 * the types below plus the semantic rules in evaluation/README.md.
 *
 * Wire shapes mirror the Effect v4 schema contract (art_I2TCG08V):
 * timestamps are Unix milliseconds on the wire, `_tag` literals are required,
 * and optional fields are absent — never explicitly `null`.
 * One deliberate addition: `WireEntry.captureId` carries the capture
 * identifier (resilient capture / duplicate-protection key), which the
 * Entry contract predates. Candidates map their capture identity here.
 */

export type EventCategory = 'potty' | 'meal' | 'sleep' | 'mood' | 'milestone' | 'school'
export type EntryStatus = 'draft' | 'published'

/** Contract Event, wire format (`occurredAt` = Unix ms). */
export interface WireEvent {
  readonly _tag: 'Event'
  readonly category: EventCategory
  /** Absolute instant, Unix ms — relative expressions must already be resolved. */
  readonly occurredAt: number
  readonly quantity?: { readonly value: number; readonly unit?: string }
  /** Finite, within [0, 1]. 1 = caregiver-confirmed. */
  readonly confidence: number
  readonly authorId: string
  /** Optional free text; non-empty when present. */
  readonly note?: string
}

/** Contract Entry, wire format (`createdAt` = Unix ms), plus `captureId`. */
export interface WireEntry {
  readonly _tag: 'Entry'
  readonly captureId: string
  /** Raw dictated text — must be preserved byte-for-byte, never normalized. */
  readonly transcript: string
  readonly authorId: string
  readonly createdAt: number
  readonly status: EntryStatus
  /** May be empty — extraction failure never blocks capture. */
  readonly events: readonly WireEvent[]
}

export interface CreateEntryInput {
  /** Idempotency key: duplicate submissions with the same `captureId` are replays. */
  readonly captureId: string
  readonly transcript: string
  readonly authorId: string
  /** "Now" for relative-time resolution, Unix ms. */
  readonly capturedAt: number
  /** IANA zone (e.g. "America/New_York") for relative expressions. */
  readonly timezone: string
}

export type CreateEntryResult =
  /** New entry persisted. */
  | { readonly _tag: 'Created'; readonly entry: WireEntry }
  /** `captureId` already existed — the EXISTING entry is returned, nothing new persisted. */
  | { readonly _tag: 'IdempotentReplay'; readonly entry: WireEntry }
  /** Capture refused for raw-input policy reasons (e.g. empty transcript). Never for extraction failure. */
  | { readonly _tag: 'Rejected'; readonly reason: string }

export interface CandidateAdapter {
  readonly name: string
  /**
   * Run the full capture pipeline for one dictation: preserve the raw
   * transcript, extract events, resolve relative times against
   * `capturedAt`/`timezone`, validate against the contract, and persist.
   * Must resolve only after extraction and persistence have settled.
   */
  createEntry(input: CreateEntryInput): Promise<CreateEntryResult>
  /**
   * All persisted entries (corpus scope: one child's timeline, drafts only).
   * Must reflect every entry whose `createEntry` call has resolved.
   */
  readTimeline(): Promise<readonly WireEntry[]>
  /**
   * Simulate a cold start: after this resolves, `readTimeline` must be
   * equivalent to what a fresh process would read from durable state.
   * A server-backed adapter whose reads are already cold-start-equivalent
   * may implement this as a no-op.
   */
  reload(): Promise<void>
}
