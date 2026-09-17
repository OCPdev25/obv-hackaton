import { Schema } from "effect"
import { convexId } from "./ids.js"

/** Care-event taxonomy from the product blueprint. */
export const EventCategory = Schema.Literals(["potty", "meal", "sleep", "mood", "milestone", "school"])
export type EventCategory = typeof EventCategory["Type"]

/**
 * Per-event lineage (contract v0.3, art_rBKvvzIa §4): which extraction run,
 * extractor version, and contract version produced this event. `attemptId`
 * references the `extraction_attempts` document that owns the run. Defined
 * here (not in lineage.ts) so the dependency DAG stays acyclic:
 * lineage.ts builds on the extraction envelope vocabulary.
 */
export const ProducedBy = Schema.Struct({
  attemptId: convexId("extraction_attempts"),
  extractorVersion: Schema.NonEmptyString,
  schemaVersion: Schema.NonEmptyString,
})
export type ProducedBy = typeof ProducedBy["Type"]

/**
 * A structured care event decoded from a raw transcript. `timestamp` is epoch
 * millis (Convex-friendly ordering), `payload` holds quantitative values such
 * as nap minutes or meal count, and `confidence` is the extractor's 0..1 score.
 */
export const EventFields = {
  householdId: convexId("households"),
  childId: convexId("children"),
  category: EventCategory,
  timestamp: Schema.Number,
  payload: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  producedBy: Schema.optionalKey(ProducedBy),
} satisfies Schema.Struct.Fields

export const EventSchema = Schema.Struct(EventFields)
export type Event = typeof EventSchema["Type"]

/** Event table view plus Convex system fields. */
export const EventDocumentFields = {
  ...EventFields,
  _id: convexId("events"),
  _creationTime: Schema.Number,
} satisfies Schema.Struct.Fields
export const EventDocument = Schema.Struct(EventDocumentFields)
export type EventDocument = typeof EventDocument["Type"]
