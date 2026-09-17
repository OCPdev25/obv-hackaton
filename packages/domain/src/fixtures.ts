import { Schema } from 'effect'
import { Caregiver, Child } from './schema.js'
import type { CaptureSession } from './capture.js'

/**
 * Fixtures: one child, two caregivers. Fixtures only — the schemas impose no
 * hard limits on household size; these exist so every surface (tests, e2e
 * script, demo app) shares the same synthetic data.
 */

export const fixtureChild = Schema.decodeUnknownSync(Child)({
  _tag: 'Child',
  childId: 'child-mila',
  displayName: 'Mila',
})

export const fixtureCaregiverAlex = Schema.decodeUnknownSync(Caregiver)({
  _tag: 'Caregiver',
  caregiverId: 'caregiver-alex',
  displayName: 'Alex Rivera',
})

export const fixtureCaregiverSam = Schema.decodeUnknownSync(Caregiver)({
  _tag: 'Caregiver',
  caregiverId: 'caregiver-sam',
  displayName: 'Sam Ortiz',
})

export const fixtureCaregivers: readonly [typeof fixtureCaregiverAlex, typeof fixtureCaregiverSam] = [
  fixtureCaregiverAlex,
  fixtureCaregiverSam,
]

export const fixtureSessionAlex: CaptureSession = {
  childId: fixtureChild.childId,
  authorId: fixtureCaregiverAlex.caregiverId,
}

export const fixtureSessionSam: CaptureSession = {
  childId: fixtureChild.childId,
  authorId: fixtureCaregiverSam.caregiverId,
}

/** Synthetic transcript used across tests, e2e script, and the demo app. */
export const fixtureTranscript =
  'Mila slept 13 hours last night, ate all of her lunch at school, and first time rode a bike without training wheels!'
