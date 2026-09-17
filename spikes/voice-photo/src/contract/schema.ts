import * as Schema from 'effect/Schema'

/**
 * SPIKE-LOCAL MOCK of the published Effect v4 schema contract (art_I2TCG08V,
 * landed in `spikes/effect-compat/src/schema.ts` on branch
 * `spike/effect-contracts-adapters`, effect@4.0.0-rc.115).
 *
 * Rule from the contract ("Rules for lanes" #1): mock against these shapes and
 * swap this import for `packages/domain` when the spike merges. This file is
 * the ONLY place in the spike that restates the contract — every consumer
 * imports from here and all types are inferred from the executable schema.
 *
 * Verified against the installed pin this session (node_modules/effect/dist/Schema.d.ts):
 * TaggedStruct, Literals, NonEmptyString, DateFromMillis, optionalKey, optional,
 * Finite.check(isBetween(...)) — the exact combinator for `confidence` appears
 * in the pin's own documentation example.
 */

export const EventCategory = Schema.Literals([
  'potty',
  'meal',
  'sleep',
  'mood',
  'milestone',
  'school',
])
export type EventCategory = Schema.Schema.Type<typeof EventCategory>

export const Quantity = Schema.Struct({
  value: Schema.Finite,
  unit: Schema.optionalKey(Schema.String),
})
export type Quantity = Schema.Schema.Type<typeof Quantity>

export const Event = Schema.TaggedStruct('Event', {
  category: EventCategory,
  occurredAt: Schema.DateFromMillis,
  quantity: Schema.optional(Quantity),
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  authorId: Schema.NonEmptyString,
  note: Schema.optionalKey(Schema.NonEmptyString),
})
export type Event = Schema.Schema.Type<typeof Event>

export const EntryStatus = Schema.Literals(['draft', 'published'])
export type EntryStatus = Schema.Schema.Type<typeof EntryStatus>

export const Entry = Schema.TaggedStruct('Entry', {
  transcript: Schema.NonEmptyString,
  authorId: Schema.NonEmptyString,
  createdAt: Schema.DateFromMillis,
  status: EntryStatus,
  events: Schema.Array(Event),
})
export type Entry = Schema.Schema.Type<typeof Entry>

/** Wire form: what crosses the network / lands in Convex (dates as unix-ms numbers). */
export type EventWire = typeof Event['Encoded']
export type EntryWire = typeof Entry['Encoded']

/** Contract entry point: wire -> domain (throws on invalid input). */
export const decodeEntry = Schema.decodeUnknownSync(Entry)
export const decodeEvent = Schema.decodeUnknownSync(Event)

/** Contract entry point: domain -> wire (Date -> unix ms, strips undefined optionals). */
export const encodeEntry = Schema.encodeSync(Entry)
export const encodeEvent = Schema.encodeSync(Event)
