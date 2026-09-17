import { Schema } from "effect"

import { EntrySchema, ListEntriesByChildInput, ListEntriesByChildOutput } from "@journal/domain"
import { convexFields } from "@journal/domain/convex"

import { query } from "./_generated/server"
import { ConvexError } from "convex/values"

import { errorText, stripUndefined } from "./lib"

/**
 * Per-child timeline, chronological (oldest first — a journal reads forward
 * in time). Ported from the retired thin-path `timeline:list` (PR #5) onto
 * the canonical model.
 *
 * Read boundary: stored rows decode through the canonical `EntrySchema`, so
 * the returned objects are validated contract output. The decode also strips
 * the Convex system fields (`_id`, `_creationTime`) — the contract's
 * `ListEntriesByChildOutput` is `Array(EntrySchema)`, and event payloads are
 * reached through `structuredEventIds` (rows in the `events` table), not
 * embedded in the entry.
 */
export const list = query({
  args: convexFields(ListEntriesByChildInput),
  handler: async (ctx, rawArgs): Promise<typeof ListEntriesByChildOutput["Type"]> => {
    let args: typeof ListEntriesByChildInput["Type"]
    try {
      args = Schema.decodeUnknownSync(ListEntriesByChildInput)(stripUndefined(rawArgs))
    } catch (err) {
      throw new ConvexError({ code: "INVALID_LIST_INPUT", message: errorText(err) })
    }

    const ordered = ctx.db
      .query("entries")
      .withIndex("by_child_createdAt", (q) => q.eq("childId", args.childId))
      .order("asc")

    const rows = args.limit === undefined ? await ordered.collect() : await ordered.take(args.limit)

    const decodeEntry = Schema.decodeUnknownSync(EntrySchema)
    return rows.map((row) => decodeEntry(row))
  },
})
