/**
 * Canonical domain contract — "Shared Child Journal — Effect v4 Schema Contract
 * (v0.1)" (project artifact art_I2TCG08V). Shapes mirror the spike-verified
 * `spikes/effect-compat/src/schema.ts` (effect@4.0.0-rc.115).
 *
 * This module is the single source of truth for the thin path: decode incoming
 * extraction output through these schemas; never hand-roll a second domain
 * model. This branch is a deployment-verification vehicle — the winning
 * candidate's shared domain package replaces it at integration.
 */
// effect@4.0.0-rc.115 exports the Schema members directly — namespace import.
import * as Schema from 'effect/Schema'

export const EVENT_CATEGORIES = [
  'potty',
  'meal',
  'sleep',
  'mood',
  'milestone',
  'school',
] as const

export const Quantity = Schema.Struct({
  value: Schema.Number,
  unit: Schema.optionalKey(Schema.String),
})

export const Event = Schema.TaggedStruct('Event', {
  category: Schema.Literals([...EVENT_CATEGORIES]),
  // Unix-ms number on the wire; Date in domain code.
  occurredAt: Schema.DateFromMillis,
  quantity: Schema.optional(Quantity),
  // 1 = caregiver-confirmed; lower = raw extraction guess.
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  authorId: Schema.NonEmptyString,
  // Non-empty when present; explicit null is NOT in the contract.
  note: Schema.optionalKey(Schema.NonEmptyString),
})

export const Entry = Schema.TaggedStruct('Entry', {
  transcript: Schema.NonEmptyString,
  authorId: Schema.NonEmptyString,
  // Unix-ms number on the wire; Date in domain code.
  createdAt: Schema.DateFromMillis,
  status: Schema.Literals(['draft', 'published']),
  // May be empty — extraction failure never blocks capture.
  events: Schema.Array(Event),
})

export type Quantity = Schema.Schema.Type<typeof Quantity>
export type Event = Schema.Schema.Type<typeof Event>
export type Entry = Schema.Schema.Type<typeof Entry>
