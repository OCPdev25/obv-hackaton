import { Schema } from 'effect'
import { CaptureId, ChildId, CaregiverId, EntryId } from './ids.js'

/**
 * Canonical domain schemas. TS types are inferred from these executable
 * schemas — never restated by hand. Based on the shared "Effect v4 Schema
 * Contract (v0.1)" (art_I2TCG08V) with two documented extensions:
 *
 * 1. `Entry.captureId` — stable client-generated idempotency key (required by
 *    the capture→persist→timeline contract).
 * 2. `Entry.childId` — timeline scoping (required by the child timeline).
 * Both are narrowings/additions of the same shapes; the contract's other
 * fields are kept verbatim (categories, DateFromMillis timestamps, confidence
 * in [0,1], optional quantity, optionalKey note).
 */

/** Exactly six categories. */
export const EventCategory = Schema.Literals(['potty', 'meal', 'sleep', 'mood', 'milestone', 'school'])
export type EventCategory = Schema.Schema.Type<typeof EventCategory>

export const Quantity = Schema.Struct({
  value: Schema.Finite,
  unit: Schema.optionalKey(Schema.String),
})
export type Quantity = Schema.Schema.Type<typeof Quantity>

/** Extraction target. `_tag` is required on the wire. */
export const Event = Schema.TaggedStruct('Event', {
  category: EventCategory,
  /** Unix-ms number on the wire (Convex `v.number()`); `Date` in domain code. */
  occurredAt: Schema.DateFromMillis,
  quantity: Schema.optional(Quantity),
  /** 1 = caregiver-confirmed; lower = raw extraction guess. */
  confidence: Schema.Finite.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  /** Attribution: caregiver who dictated/confirmed. */
  authorId: CaregiverId,
  note: Schema.optionalKey(Schema.NonEmptyString),
})
export type Event = Schema.Schema.Type<typeof Event>

/** Capture record. `status: 'draft'` holds the raw transcript unchanged before extraction/publish. */
export const Entry = Schema.TaggedStruct('Entry', {
  captureId: CaptureId,
  childId: ChildId,
  /** Raw dictated/typed text — always preserved unchanged. */
  transcript: Schema.NonEmptyString,
  authorId: CaregiverId,
  createdAt: Schema.DateFromMillis,
  status: Schema.Literals(['draft', 'published']),
  /** May be empty — extraction failure never blocks capture. */
  events: Schema.Array(Event),
})
export type Entry = Schema.Schema.Type<typeof Entry>

/** Read model for the child timeline (published entries, newest first). */
export const TimelineItem = Schema.Struct({
  entryId: EntryId,
  captureId: CaptureId,
  childId: ChildId,
  transcript: Schema.NonEmptyString,
  authorId: CaregiverId,
  createdAt: Schema.DateFromMillis,
  events: Schema.Array(Event),
})
export type TimelineItem = Schema.Schema.Type<typeof TimelineItem>

export const Child = Schema.TaggedStruct('Child', {
  childId: ChildId,
  displayName: Schema.NonEmptyString,
})
export type Child = Schema.Schema.Type<typeof Child>

export const Caregiver = Schema.TaggedStruct('Caregiver', {
  caregiverId: CaregiverId,
  displayName: Schema.NonEmptyString,
})
export type Caregiver = Schema.Schema.Type<typeof Caregiver>
