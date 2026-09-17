import { Schema } from "effect"

/**
 * The six event categories from the product blueprint (potty, meal, sleep,
 * mood, milestone, school). This union is the single source of truth: Convex
 * functions, the RN client, and the extraction pipeline all import it.
 *
 * `occurredAt` is unix ms — relative-time normalization happens before decode.
 * `confidence` is attached by extractors (deterministic rules omit it; LLM
 * extraction attaches a 0..1 score).
 */

export const EventSchemaVersion = Schema.Literals([1])
export type EventSchemaVersion = typeof EventSchemaVersion.Type

export const EventCategory = Schema.Literals(["potty", "meal", "sleep", "mood", "milestone", "school"])
export type EventCategory = typeof EventCategory.Type

const Amount = Schema.Literals(["none", "some", "most", "all"])
const SleepKind = Schema.Literals(["nap", "night"])
const MoodKind = Schema.Literals(["happy", "sad", "upset", "calm", "energetic"])
const PottyKind = Schema.Literals(["pee", "poop", "both"])

export const JournalEvent = Schema.TaggedUnion({
  potty: {
    success: Schema.Boolean,
    kind: PottyKind,
    occurredAt: Schema.Number,
  },
  meal: {
    food: Schema.String,
    amount: Amount,
    occurredAt: Schema.Number,
  },
  sleep: {
    kind: SleepKind,
    minutes: Schema.optionalKey(Schema.Number),
    occurredAt: Schema.Number,
  },
  mood: {
    mood: MoodKind,
    occurredAt: Schema.Number,
  },
  milestone: {
    label: Schema.String,
    occurredAt: Schema.Number,
  },
  school: {
    note: Schema.String,
    occurredAt: Schema.Number,
  },
})
export type JournalEvent = typeof JournalEvent.Type

/** Every case gains `confidence?` without repeating the field six times. */
export const withConfidence = Schema.Struct({
  event: JournalEvent,
  confidence: Schema.optionalKey(Schema.Number),
})
export type ExtractedEvent = typeof withConfidence.Type
