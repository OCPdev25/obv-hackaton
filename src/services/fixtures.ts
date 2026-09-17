/**
 * Fixtures — one child, two caregivers.
 *
 * These are FIXTURES ONLY: the schema and server impose no limits on the
 * number of children or caregivers. IDs are constructed through the domain
 * schemas (branded, non-empty) and are stable strings so fixture upserts are
 * idempotent and attribution is stable across runs.
 */
import { Schema } from "effect"
import { CaregiverId, ChildId, type CaregiverId as CaregiverIdType, type ChildId as ChildIdType } from "../domain/schema.js"

export interface FixtureCaregiver {
  readonly caregiverId: CaregiverIdType
  readonly name: string
}

export const fixtureChild: { readonly childId: ChildIdType; readonly name: string } = {
  childId: Schema.decodeSync(ChildId)("child-ada"),
  name: "Ada",
}

export const fixtureCaregivers: ReadonlyArray<FixtureCaregiver> = [
  { caregiverId: Schema.decodeSync(CaregiverId)("caregiver-maya"), name: "Maya" },
  { caregiverId: Schema.decodeSync(CaregiverId)("caregiver-noah"), name: "Noah" },
]
