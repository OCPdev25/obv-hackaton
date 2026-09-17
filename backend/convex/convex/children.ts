import { Schema } from "effect"

import { CreateChildInput, CreateChildOutput } from "@journal/domain"
import { convexFields } from "@journal/domain/convex"

import { mutation } from "./_generated/server"
import { ConvexError } from "convex/values"

import { errorText, stripUndefined } from "./lib"

/**
 * Create a child inside an existing household. Ported from the retired
 * thin-path `children:create` (PR #5): non-empty trimmed name, optional
 * `birthDate` in unix ms. The canonical model adds the household reference —
 * the port checks it exists rather than writing an orphan child row.
 */
export const create = mutation({
  args: convexFields(CreateChildInput),
  handler: async (ctx, rawArgs) => {
    let args: typeof CreateChildInput["Type"]
    try {
      args = Schema.decodeUnknownSync(CreateChildInput)(stripUndefined(rawArgs))
    } catch (err) {
      throw new ConvexError({ code: "INVALID_NAME", message: errorText(err) })
    }

    // normalizeId bridges the contract's string id to Convex's branded Id
    // type (runtime-validated against the table — no casts).
    const householdId = ctx.db.normalizeId("households", args.householdId)
    if (householdId === null) {
      throw new ConvexError({
        code: "HOUSEHOLD_NOT_FOUND",
        message: `household ${args.householdId} does not exist`,
      })
    }
    const household = await ctx.db.get(householdId)
    if (household === null) {
      throw new ConvexError({
        code: "HOUSEHOLD_NOT_FOUND",
        message: `household ${args.householdId} does not exist`,
      })
    }

    // Same normalization as the thin-path: trim, then reject empty — a
    // whitespace-only name passes the raw non-empty decode but not this.
    const name = args.name.trim()
    if (name.length === 0) {
      throw new ConvexError({ code: "INVALID_NAME", message: "name must be a non-empty string" })
    }

    const createdAt = Date.now()
    const childId = await ctx.db.insert(
      "children",
      args.birthDate === undefined
        ? { householdId, name, createdAt }
        : { householdId, name, birthDate: args.birthDate, createdAt },
    )
    return {
      status: "created" as const,
      childId,
      name,
    } satisfies typeof CreateChildOutput["Type"]
  },
})
