/**
 * Entry + Event contract — implements art_I2TCG08V (Effect v4 Schema Contract v0.1).
 *
 * Candidate-D amendment (v0.2, documented in docs/ARENA-CANDIDATE-D.md):
 * `Entry` gains required `captureId` + `childId` (idempotency key, timeline scope)
 * and `optionalKey` `entryId` (assigned by persistence, absent in drafts).
 * Everything else follows the published contract exactly.
 */
import { Schema } from "effect"

import { CaptureId, ChildId, CaregiverId, EntryId } from "./ids.js"

export const EventCategory = Schema.Literals([
  "potty",
  "meal",
  "sleep",
  "mood",
  "milestone",
  "school",
])
export type EventCategory = Schema.Schema.Type<typeof EventCategory>

export const Quantity = Schema.Struct({
  value: Schema.Number,
  unit: Schema.optionalKey(Schema.String),
})
export type Quantity = Schema.Schema.Type<typeof Quantity>

export const Event = Schema.TaggedStruct("Event", {
  category: EventCategory,
  occurredAt: Schema.DateFromMillis,
  quantity: Schema.optional(Quantity),
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  authorId: CaregiverId,
  note: Schema.optionalKey(Schema.NonEmptyString),
})
export type Event = Schema.Schema.Type<typeof Event>

export const EntryStatus = Schema.Literals(["draft", "published"])
export type EntryStatus = Schema.Schema.Type<typeof EntryStatus>

export const Entry = Schema.TaggedStruct("Entry", {
  captureId: CaptureId,
  childId: ChildId,
  transcript: Schema.NonEmptyString,
  authorId: CaregiverId,
  createdAt: Schema.DateFromMillis,
  status: EntryStatus,
  events: Schema.Array(Event),
  entryId: Schema.optionalKey(EntryId),
})
export type Entry = Schema.Schema.Type<typeof Entry>

/**
 * Boundary entry points. Raw/external data enters as `unknown` and is decoded
 * through these — never through a hand-rolled second model.
 */
export const decodeEntryResult = Schema.decodeUnknownResult(Entry)
export const decodeEntrySync = Schema.decodeUnknownSync(Entry)
export const encodeEntry = Schema.encodeSync(Entry)

export const decodeEventResult = Schema.decodeUnknownResult(Event)
export const decodeEventSync = Schema.decodeUnknownSync(Event)
export const encodeEvent = Schema.encodeSync(Event)
