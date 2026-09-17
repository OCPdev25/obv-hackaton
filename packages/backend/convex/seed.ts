import { mutation } from "./_generated/server.js"
import { FIXTURE_CAREGIVERS, FIXTURE_CHILD, FIXTURE_HOUSEHOLD } from "@journal/contracts"

/**
 * Seed the demo household from the shared fixtures: one child, two
 * caregivers. Idempotent — safe to call before every demo run.
 */
export const seedFixtures = mutation({
  args: {},
  handler: async (ctx) => {
    const existingHousehold = await ctx.db.query("households").first()
    if (existingHousehold !== null) {
      return { householdId: existingHousehold._id, seeded: false as const }
    }
    const householdId = await ctx.db.insert("households", { name: FIXTURE_HOUSEHOLD.name })
    await ctx.db.insert("children", { ...FIXTURE_CHILD, householdId })
    for (const caregiver of FIXTURE_CAREGIVERS) {
      await ctx.db.insert("caregivers", { ...caregiver, householdId })
    }
    return { householdId, seeded: true as const }
  },
})
