/**
 * Domain schema — the single source of truth for the capture slice.
 *
 * Effect v4 Schema (effect@4.0.0-rc.115) is the domain authority: every TS type
 * here is inferred from an executable schema, and every external input (LLM
 * extraction output, Convex wire payloads, server responses) is decoded through
 * these schemas at the boundary. Do not restate these types by hand anywhere
 * else.
 *
 * Aligned with the canonical "Shared Child Journal — Effect v4 Schema Contract
 * (v0.1)" (art_I2TCG08V), with two labeled extensions mandated by the arena
 * brief (both flagged as pending contract corrections):
 *   - Entry.captureId — stable capture identifier for idempotent publication.
 *   - Entry.childId   — child-timeline scoping for the timeline query.
 * Deviations from the contract table are documented inline.
 */
import { Schema } from "effect"

// ---------------------------------------------------------------------------
// Branded identifiers — constructed only through Schema.decode (never cast).
// ---------------------------------------------------------------------------

export const ChildId = Schema.brand("ChildId")(Schema.NonEmptyString)
export type ChildId = Schema.Schema.Type<typeof ChildId>

export const CaregiverId = Schema.brand("CaregiverId")(Schema.NonEmptyString)
export type CaregiverId = Schema.Schema.Type<typeof CaregiverId>

export const CaptureId = Schema.brand("CaptureId")(Schema.NonEmptyString)
export type CaptureId = Schema.Schema.Type<typeof CaptureId>

/** Raw dictated text. Preserved verbatim — no trimming or normalization. */
export const Transcript = Schema.NonEmptyString
export type Transcript = Schema.Schema.Type<typeof Transcript>

// ---------------------------------------------------------------------------
// Event — the extraction target (canonical contract: art_I2TCG08V).
// ---------------------------------------------------------------------------

export const Quantity = Schema.Struct({
  value: Schema.Finite,
  unit: Schema.optionalKey(Schema.String),
})
export type Quantity = Schema.Schema.Type<typeof Quantity>

export const EventCategory = Schema.Literals([
  "potty",
  "meal",
  "sleep",
  "mood",
  "milestone",
  "school",
])
export type EventCategory = Schema.Schema.Type<typeof EventCategory>

export const Event = Schema.TaggedStruct("Event", {
  category: EventCategory,
  // Unix-ms number on the wire (Convex v.number()); Date in domain code.
  occurredAt: Schema.DateFromMillis,
  // Contract table says Schema.optional(Quantity); optionalKey is the
  // absence-tolerant reading required for JSON wire round-trips (Convex omits
  // absent keys). Flagged for the contract thread.
  quantity: Schema.optionalKey(Quantity),
  // 1 = caregiver-confirmed; lower = raw LLM guess. Convex v.number() cannot
  // express the [0,1] range — this range check is why Effect Schema, not the
  // transport validator, is the domain authority.
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  authorId: CaregiverId,
  note: Schema.optionalKey(Schema.NonEmptyString),
})
export type Event = Schema.Schema.Type<typeof Event>

// ---------------------------------------------------------------------------
// Entry — the capture record (canonical contract + arena-mandated extensions).
// ---------------------------------------------------------------------------

export const EntryStatus = Schema.Literals(["draft", "published"])
export type EntryStatus = Schema.Schema.Type<typeof EntryStatus>

export const Entry = Schema.TaggedStruct("Entry", {
  // Arena brief: idempotency on a stable captureId (pending contract correction).
  captureId: CaptureId,
  // Arena brief: renders in a child timeline (pending contract correction).
  childId: ChildId,
  transcript: Transcript,
  authorId: CaregiverId,
  createdAt: Schema.DateFromMillis,
  status: EntryStatus,
  // May be empty — extraction failure never blocks capture.
  events: Schema.Array(Event),
})
export type Entry = Schema.Schema.Type<typeof Entry>

/** Wire form of Entry (occurredAt/createdAt as unix-ms numbers, absent optional keys). */
export type EntryWire = (typeof Entry)["Encoded"]

/** Flat human-readable message from a schema decode failure (display surface). */
export const decodeFailureMessage = (error: Schema.SchemaError): string => error.message

// ---------------------------------------------------------------------------
// Persistence + timeline wire schemas (decoded at client boundaries).
// ---------------------------------------------------------------------------

export const PublishOutput = Schema.Struct({
  recordId: Schema.String,
  duplicate: Schema.Boolean,
  eventCount: Schema.Number,
})
export type PublishOutput = Schema.Schema.Type<typeof PublishOutput>

export const TimelineRow = Schema.Struct({
  recordId: Schema.String,
  captureId: CaptureId,
  transcript: Schema.String,
  authorId: CaregiverId,
  authorName: Schema.String,
  status: EntryStatus,
  createdAt: Schema.DateFromMillis,
  events: Schema.Array(Event),
})
export type TimelineRow = Schema.Schema.Type<typeof TimelineRow>
