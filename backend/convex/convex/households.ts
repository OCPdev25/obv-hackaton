import { Schema } from "effect"

import { CreateHouseholdInput, CreateHouseholdOutput } from "@journal/domain"
import { convexFields } from "@journal/domain/convex"

import { mutation } from "./_generated/server"
import { ConvexError } from "convex/values"

import { errorText, stripUndefined } from "./lib"

/**
 * Create a household. The canonical child/entry rows reference a household,
 * so this is the root of every synthetic or real write path. The full
 * membership/invitation flow supersedes this minimal creation later.
 */
export const create = mutation({
  args: convexFields(CreateHouseholdInput),
  handler: async (_ctx, rawArgs) => {
    let args: typeof CreateHouseholdInput["Type"]
    try {
      args = Schema.decodeUnknownSync(CreateHouseholdInput)(stripUndefined(rawArgs))
    } catch (err) {
      throw new ConvexError({ code: "INVALID_NAME", message: errorText(err) })
    }

    const name = args.name.trim()
    if (name.length === 0) {
      throw new ConvexError({ code: "INVALID_NAME", message: "name must be a non-empty string" })
    }

    const householdId = await _ctx.db.insert("households", { name, createdAt: Date.now() })
    return {
      status: "created" as const,
      householdId,
      name,
    } satisfies typeof CreateHouseholdOutput["Type"]
  },
})
