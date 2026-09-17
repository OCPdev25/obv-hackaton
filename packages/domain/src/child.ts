import { Schema } from "effect"
import { convexId } from "./ids.js"

export const ChildFields = {
  householdId: convexId("households"),
  name: Schema.NonEmptyString,
  /** Birth date as epoch millis (day precision at the UI layer). */
  birthDate: Schema.optionalKey(Schema.Number),
  notes: Schema.optional(Schema.String),
  createdAt: Schema.Number,
} satisfies Schema.Struct.Fields

export const ChildSchema = Schema.Struct(ChildFields)
export type Child = typeof ChildSchema["Type"]

/** Child table view plus Convex system fields. */
export const ChildDocumentFields = {
  ...ChildFields,
  _id: convexId("children"),
  _creationTime: Schema.Number,
} satisfies Schema.Struct.Fields
export const ChildDocument = Schema.Struct(ChildDocumentFields)
export type ChildDocument = typeof ChildDocument["Type"]
