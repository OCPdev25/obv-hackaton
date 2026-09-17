import { Schema } from "effect"
import { convexId } from "./ids.js"

/** Care-event taxonomy from the product blueprint. */
export const EventCategory = Schema.Literals(["potty", "meal", "sleep", "mood", "milestone", "school"])
export type EventCategory = typeof EventCategory["Type"]

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
