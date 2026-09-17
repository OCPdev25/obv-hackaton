import { Schema } from "effect"
import { convexId } from "./ids.js"

/** Extraction lifecycle stored on every entry. */
export const ExtractionStatus = Schema.Literals(["pending", "structured", "failed"])
export type ExtractionStatus = typeof ExtractionStatus["Type"]

/**
 * Per-entry publication state ONLY (contract v0.2). WHO may see a published
 * entry — the audience — is resolved from household/relationship grants and is
 * deliberately NOT stored on the entry: no fused status enum, no audience
 * field. Audience permissions live where household/relationship grants live.
 */
export const EntryVisibility = Schema.Literals(["draft", "published"])
export type EntryVisibility = typeof EntryVisibility["Type"]

/**
 * A journal entry: the caregiver's raw transcript is stored verbatim (the
 * extraction pipeline never destroys the source), with the events derived from
 * it linked by id. `authorId` is an external identity string — the flat
 * blueprint model has no parents table. `photoId` references a Convex
 * storage document when the entry carries a photo.
 */
export const EntryFields = {
  householdId: convexId("households"),
  childId: convexId("children"),
  authorId: Schema.String,
  rawTranscript: Schema.NonEmptyString,
  structuredEventIds: Schema.Array(convexId("events")),
  extractionStatus: ExtractionStatus,
  visibility: EntryVisibility,
  photoId: Schema.optional(Schema.String),
  createdAt: Schema.Number,
} satisfies Schema.Struct.Fields

export const EntrySchema = Schema.Struct(EntryFields)
export type Entry = typeof EntrySchema["Type"]

/** Entry table view plus Convex system fields. */
export const EntryDocumentFields = {
  ...EntryFields,
  _id: convexId("entries"),
  _creationTime: Schema.Number,
} satisfies Schema.Struct.Fields
export const EntryDocument = Schema.Struct(EntryDocumentFields)
export type EntryDocument = typeof EntryDocument["Type"]
