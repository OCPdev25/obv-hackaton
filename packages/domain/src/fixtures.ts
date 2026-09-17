/**
 * Deterministic demo fixtures: one child, two caregivers.
 * Fixtures only — the schemas impose no hard limits on children or caregivers.
 * IDs are decoded through the branded schemas so a typo here fails at import,
 * not silently in production data.
 */
import { Schema } from "effect"

import { CaregiverId, ChildId } from "./ids.js"

export interface ChildFixture {
  readonly childId: ChildId
  readonly displayName: string
}

export interface CaregiverFixture {
  readonly caregiverId: CaregiverId
  readonly displayName: string
}

const id = Schema.decodeSync

export const fixtureChild: ChildFixture = {
  childId: id(ChildId)("child_mila"),
  displayName: "Mila",
}

export const fixtureCaregivers: readonly [CaregiverFixture, CaregiverFixture] = [
  { caregiverId: id(CaregiverId)("caregiver_ana"), displayName: "Ana" },
  { caregiverId: id(CaregiverId)("caregiver_rafa"), displayName: "Rafa" },
]
