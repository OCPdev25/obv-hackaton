import { Schema } from "effect"

import { CreateEntryInput, CreateEntryOutput } from "@journal/domain"
import { convexFields } from "@journal/domain/convex"

import { mutation } from "./_generated/server"
import { ConvexError } from "convex/values"

import { errorText, stripUndefined } from "./lib"

/**
 * Capture an entry. Ported from the retired thin-path `entries:createEntry`
 * (PR #5) onto the canonical four-table model, preserving the deployment-
 * verified `captureId` idempotency semantics: a retried capture returns the
 * original entry without writing — the original capture wins, and retried
 * payload changes are absorbed.
 *
 * Divergence from the thin-path (canonical lifecycle): the raw transcript is
 * stored first with `extractionStatus: "pending"` and NO events. Event rows
 * belong to the extraction pipeline (append through the `AppendEventsInput`
 * contract), not to capture creation — the thin path's inline-events shortcut
 * existed only because there was no extraction pipeline.
 */
export const createEntry = mutation({
  args: convexFields(CreateEntryInput),
  handler: async (ctx, rawArgs) => {
    let args: typeof CreateEntryInput["Type"]
    try {
      args = Schema.decodeUnknownSync(CreateEntryInput)(stripUndefined(rawArgs))
    } catch (err) {
      throw new ConvexError({ code: "INVALID_ENTRY_INPUT", message: errorText(err) })
    }

    // Fail-closed referential check: the entry derives its household from the
    // child row, so a bogus childId must not create a row. normalizeId bridges
    // the contract's string ids to Convex's branded Id type (runtime-validated
    // against the table — no casts).
    const childId = ctx.db.normalizeId("children", args.childId)
    if (childId === null) {
      throw new ConvexError({
        code: "CHILD_NOT_FOUND",
        message: `child ${args.childId} does not exist`,
      })
    }
    const child = await ctx.db.get(childId)
    if (child === null) {
      throw new ConvexError({
        code: "CHILD_NOT_FOUND",
        message: `child ${args.childId} does not exist`,
      })
    }

    // Idempotency: the original capture wins. A retry with the same captureId
    // returns the existing entry without writing, even if the payload changed.
    if (args.captureId !== undefined) {
      const existing = await ctx.db
        .query("entries")
        .withIndex("by_capture", (q) => q.eq("captureId", args.captureId))
        .first()
      if (existing !== null) {
        return {
          status: "idempotent_hit" as const,
          entryId: existing._id,
          captureId: args.captureId,
        } satisfies typeof CreateEntryOutput["Type"]
      }
    }

    const entryId = await ctx.db.insert("entries", {
      householdId: child.householdId,
      childId: args.childId,
      authorId: args.authorId,
      rawTranscript: args.rawTranscript,
      structuredEventIds: [],
      extractionStatus: "pending",
      visibility: "draft",
      ...(args.photoId === undefined ? {} : { photoId: args.photoId }),
      ...(args.captureId === undefined ? {} : { captureId: args.captureId }),
      createdAt: Date.now(),
    })
    return {
      status: "created" as const,
      entryId,
      ...(args.captureId === undefined ? {} : { captureId: args.captureId }),
    } satisfies typeof CreateEntryOutput["Type"]
  },
})
