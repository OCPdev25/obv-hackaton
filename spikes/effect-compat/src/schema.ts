/**
 * Canonical Effect v4 schema for the Shared Child Journal — Entry + Event.
 *
 * This is the single sanctioned representation for the contract spike: the TS
 * types below are INFERRED from the executable schema (no hand-written domain
 * types), so schema and types cannot drift.
 *
 * Verified against effect@4.0.0-rc.115 (see spikes/effect-compat/FINDINGS.md):
 * - literal unions: `Schema.Literals([...])`
 * - bounded numbers: `Schema.Finite.check(Schema.isBetween({ minimum, maximum }))`
 * - timestamps: `Schema.DateFromMillis` — Date in domain code, unix-ms number on the wire
 * - optional fields: `Schema.optional` (absent key or undefined) vs
 *   `Schema.optionalKey` (absent key only — present values must validate)
 * - type extraction: `Schema.Schema.Type<typeof S>` (readonly fields)
 */
import * as Schema from 'effect/Schema'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** The six canonical care-event categories for the MVP. */
export const EventCategory = Schema.Literals(['potty', 'meal', 'sleep', 'mood', 'milestone', 'school'])

/** Extraction confidence in [0, 1]. 1 = caregiver-confirmed, lower = raw LLM guess. */
export const Confidence = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

/**
 * Timestamps travel as unix epoch milliseconds (the Convex-native form) and
 * surface as `Date` in domain code via the DateFromMillis codec.
 */
export const Timestamp = Schema.DateFromMillis

/** Author attribution: the caregiver account that dictated or confirmed the record. */
export const AuthorId = Schema.NonEmptyString

/** Quantitative payload attached to an event where it makes sense (240 ml, 2 sleeps, mood 4/5). */
export const Quantity = Schema.Struct({
  value: Schema.Finite,
  unit: Schema.optionalKey(Schema.String),
})

/**
 * Optional fields on the wire. Contract decision: absent means absent — the
 * schema uses `optional` (accepts a missing key or explicit undefined) for
 * quantity, and `optionalKey` for note (missing key only; an explicit
 * `undefined` value is rejected). Explicit `null` is not part of the contract.
 */
export const Event = Schema.TaggedStruct('Event', {
  category: EventCategory,
  occurredAt: Timestamp,
  quantity: Schema.optional(Quantity),
  confidence: Confidence,
  authorId: AuthorId,
  note: Schema.optionalKey(Schema.NonEmptyString),
})

/**
 * Publication state: PER-ENTRY. 'draft' = private capture, 'published' =
 * shared update. This is one of two independent visibility dimensions —
 * the other (audience: WHO may see a published entry) is resolved from
 * household and relationship grants and is deliberately NOT modeled on the
 * entry. Do not merge the two dimensions into one enum.
 */
export const EntryVisibility = Schema.Literals(['draft', 'published'])

/**
 * A capture record: the raw dictated transcript (always preserved — extraction
 * failures never block capture) plus the events extracted from it.
 */
export const Entry = Schema.TaggedStruct('Entry', {
  transcript: Schema.NonEmptyString,
  authorId: AuthorId,
  createdAt: Timestamp,
  visibility: EntryVisibility,
  /** May be empty: a dictated note with no extractable events is still a valid entry. */
  events: Schema.Array(Event),
})

// ---------------------------------------------------------------------------
// Inferred types — all downstream code consumes these, never hand-rolled shapes
// ---------------------------------------------------------------------------

export type EventCategory = Schema.Schema.Type<typeof EventCategory>
export type Confidence = Schema.Schema.Type<typeof Confidence>
export type Timestamp = Schema.Schema.Type<typeof Timestamp>
export type AuthorId = Schema.Schema.Type<typeof AuthorId>
export type Quantity = Schema.Schema.Type<typeof Quantity>
export type Event = Schema.Schema.Type<typeof Event>
export type EntryVisibility = Schema.Schema.Type<typeof EntryVisibility>
export type Entry = Schema.Schema.Type<typeof Entry>
