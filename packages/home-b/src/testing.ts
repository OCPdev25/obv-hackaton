/**
 * Test/demo wiring for Candidate B: shared sample utterances and a
 * store factory over the synthetic roster. Kept out of `index.ts` so the
 * package's public surface stays product-shaped.
 */
import { buildChildren, buildHousehold, buildMembers } from "./fixtures.js"
import { DEMO_NOW, HOUSEHOLD_TIMEZONE, wallToUtc } from "./time.js"
import { HomeBStore } from "./store.js"

export { HOUSEHOLD_TIMEZONE, wallToUtc }

/**
 * The load-bearing mixed-topic utterance from the operator spec: two children,
 * three events (meal + mood for Milo, nap for Iris) in one dictation.
 */
export const MIXED_BOTH_CHILDREN = "Milo ate scrambled eggs and toast at 8, then had a total meltdown when the block tower fell, and Iris napped 45 minutes."

/** The voice demo path emits the SAME transcript as typed text would produce. */
export const VOICE_SAMPLE = MIXED_BOTH_CHILDREN

/** Two-clause single-child sample: meal for Milo, sleep for Iris. */
export const SEED_SAMPLE = "Milo ate all his dinner, and Iris napped 45 minutes."

/** Fresh store over the synthetic Polanco household with the fixed demo clock. */
export const buildStore = (): HomeBStore =>
  new HomeBStore(
    { household: buildHousehold(), children: buildChildren(), members: buildMembers() },
    { now: () => DEMO_NOW },
  )
