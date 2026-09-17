/**
 * LOCAL MOCK of the "Shared Child Journal — Effect v4 Schema Contract (v0.1)" shapes.
 * Source of truth: artifact art_I2TCG08V ("Shared Child Journal — Effect v4 Schema Contract (v0.1)").
 *
 * ⚠️ PENDING WIRING — DO NOT TREAT AS THE REAL SCHEMA.
 * The contract LANDED in `spikes/effect-compat/src/schema.ts` on branch
 * `spike/effect-contracts-adapters`, but that branch was NOT pushed to origin at
 * the time these tests were written (verified: `git ls-remote --heads origin`
 * lists only ci/pipeline, feat/vendor-agent-skills, master, obvious/onboarding).
 *
 * Per contract rule 1 ("Mock against these shapes; when the spike merges to a
 * packages/domain, swap the import — shape-compatible") this module mocks the
 * documented shapes so the security tests are executable now. When the spike
 * lands, delete this file and import `Event`/`Entry` from the real package and
 * DECODE through the schema (`Schema.decodeUnknownSync`) — never hand-roll a
 * second domain model. The field-by-field definitions below are transcribed
 * from the contract document, not invented.
 */

/** Exactly six categories (contract: Schema.Literals). */
export const ENTRY_CATEGORIES = ['potty', 'meal', 'sleep', 'mood', 'milestone', 'school'] as const
export type Category = (typeof ENTRY_CATEGORIES)[number]

/** Publication state — Dimension 1 of the visibility model. See THREAT-MODEL.md §Two-dimension rule. */
export const ENTRY_STATUSES = ['draft', 'published'] as const
export type PublicationState = (typeof ENTRY_STATUSES)[number]

/** Contract v0.1 "Event (extraction target)". occurredAt is `Date` in domain code (unix-ms on the wire). */
export interface Event {
  readonly _tag: 'Event'
  readonly category: Category
  readonly occurredAt: Date
  readonly quantity?: { readonly value: number; readonly unit?: string }
  /** [0, 1]; 1 = caregiver-confirmed, lower = raw LLM guess. */
  readonly confidence: number
  readonly authorId: string
  readonly note?: string
}

/** Contract v0.1 "Entry (capture record)". */
export interface Entry {
  readonly _tag: 'Entry'
  /** Raw dictated text — always preserved. */
  readonly transcript: string
  readonly authorId: string
  readonly createdAt: Date
  readonly status: PublicationState
  /** May be empty — extraction failure never blocks capture. */
  readonly events: readonly Event[]
}

export class EntryShapeError extends Error {
  constructor(message: string) {
    super(`mock-entry invariant violated (real schema decode pending): ${message}`)
    this.name = 'EntryShapeError'
  }
}

/**
 * Minimal structural guard standing in for `Schema.decodeUnknownSync(Entry)`.
 * Covers only the invariants the access policy depends on (transcript/authorId
 * non-empty, status literal). NOT a reimplementation of the contract schema.
 */
export function assertEntryInvariants(entry: Entry): Entry {
  if (entry._tag !== 'Entry') throw new EntryShapeError(`_tag must be 'Entry', got ${String(entry._tag)}`)
  if (typeof entry.transcript !== 'string' || entry.transcript.length === 0)
    throw new EntryShapeError('transcript must be a non-empty string')
  if (typeof entry.authorId !== 'string' || entry.authorId.length === 0)
    throw new EntryShapeError('authorId must be a non-empty string')
  if (!ENTRY_STATUSES.includes(entry.status)) {
    throw new EntryShapeError(`status must be one of ${ENTRY_STATUSES.join('|')}, got ${String(entry.status)}`)
  }
  if (!Array.isArray(entry.events)) throw new EntryShapeError('events must be an array')
  return entry
}

export function makeEvent(event: Omit<Event, '_tag'>): Event {
  return { _tag: 'Event', ...event }
}

export function makeEntry(entry: Omit<Entry, '_tag'>): Entry {
  return assertEntryInvariants({ _tag: 'Entry', ...entry })
}
