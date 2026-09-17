import { Schema } from "effect"

import { convexId } from "./ids.js"

export const HouseholdFields = {
  name: Schema.NonEmptyString,
  createdAt: Schema.Number,
} satisfies Schema.Struct.Fields

export const HouseholdSchema = Schema.Struct(HouseholdFields)
export type Household = typeof HouseholdSchema["Type"]

/** Household table view plus Convex system fields. */
export const HouseholdDocumentFields = {
  ...HouseholdFields,
  _id: convexId("households"),
  _creationTime: Schema.Number,
} satisfies Schema.Struct.Fields
export const HouseholdDocument = Schema.Struct(HouseholdDocumentFields)
export type HouseholdDocument = typeof HouseholdDocument["Type"]
