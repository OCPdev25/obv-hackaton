import { Schema } from "effect"

import {
  AdvanceReadStateInput,
  CatchUpQueryInput,
  CatchUpReport,
  EntryDocument,
  EventDocument,
  computeCatchUp,
} from "@journal/domain"
import { convexFields } from "@journal/domain/convex"

import { mutation, query } from "./_generated/server"
import { ConvexError } from "convex/values"

import { errorText, stripUndefined } from "./lib"

/**
 * Since-last-seen caregiver catch-up (contract delta v0.1, art_6qhBut41).
 *
 * `getCatchUp` derives the report from the flat model through the
 * deterministic domain reducer; `advanceReadState` upserts the monotonic
 * per-(caregiver, child) watermark. `now` is part of the decoded contract
 * input (the reducer stays pure — no wall clock inside domain code).
 *
 * Corrected path NOT wired: `eventRevisions` has no table on master — the
 * v0.3 fold (slot 10) owns revision persistence and will pass revisions into
 * the reducer here. Until then the corrected path stays silent on the
 * backend; the reducer's corrected logic is exercised by the domain tests.
 */

// PLACEHOLDER grants pending slot 19 (household members/grants): the flat
// model has no membership table, so the grant is a named allowlist and the
// default is DENY. Replace with the real membership check the moment slot 19
// lands — this list must never graduate to a config surface.
const knownReaders: ReadonlyArray<string> = ["reader_mom", "reader_dad"]

const grantsFor = {
  canRead: (readerId: string, _householdId: string): boolean => knownReaders.includes(readerId),
}

/**
 * Catch-up report for one (reader, child) pair. Rows are read per-child via
 * the canonical indexes; events are joined through each entry's
 * structuredEventIds (entries carry no event payloads). Authorization fails
 * closed: an unlisted reader is an error, never a partial report.
 */
export const getCatchUp = query({
  args: convexFields(CatchUpQueryInput),
  handler: async (ctx, rawArgs): Promise<typeof CatchUpReport["Type"]> => {
    let args: typeof CatchUpQueryInput["Type"]
    try {
      args = Schema.decodeUnknownSync(CatchUpQueryInput)(stripUndefined(rawArgs))
    } catch (err) {
      throw new ConvexError({ code: "INVALID_CATCHUP_INPUT", message: errorText(err) })
    }

    // Fail-closed referential check (same shape as entries.createEntry).
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

    // Watermark: absent row = first-time reader (the reducer treats it as 0).
    const readState = await ctx.db
      .query("caregiverReadState")
      .withIndex("by_caregiver_child", (q) =>
        q.eq("caregiverId", args.readerId).eq("childId", args.childId),
      )
      .first()

    const [entryRows, eventRows] = await Promise.all([
      ctx.db
        .query("entries")
        .withIndex("by_child", (q) => q.eq("childId", args.childId))
        .collect(),
      ctx.db
        .query("events")
        .withIndex("by_child", (q) => q.eq("childId", args.childId))
        .collect(),
    ])

    // Rows decode through the *_Document contracts (system fields included —
    // the reducer cites entry._id and event._id).
    const decodeEntry = Schema.decodeUnknownSync(EntryDocument)
    const decodeEvent = Schema.decodeUnknownSync(EventDocument)
    // Domain ids are plain strings (convexId is an annotated Schema.String);
    // the generated doc type brands them. Key the join by the plain-string view.
    const eventsById = new Map(eventRows.map((event) => [event._id as string, event]))

    const catchUpEntries = entryRows.map((row) => {
      const entry = decodeEntry(row)
      return {
        entry,
        events: entry.structuredEventIds.flatMap((eventId) => {
          const found = eventsById.get(eventId)
          if (found === undefined) return []
          return [decodeEvent(found)]
        }),
      }
    })

    // TODO(v0.3 fold / slot 10): load eventRevisions for this child and pass
    // them through so in-window corrections surface from the backend.
    const result = computeCatchUp(
      args,
      {
        householdId: child.householdId,
        readerLastSeenAt: readState?.lastSeenAt,
        entries: catchUpEntries,
        revisions: [],
      },
      grantsFor,
    )

    if ("_tag" in result) {
      throw new ConvexError({
        code: result._tag === "UnauthorizedReader" ? "UNAUTHORIZED_READER" : "HORIZON_EXCEEDED",
        message:
          result._tag === "UnauthorizedReader"
            ? `reader ${args.readerId} is not authorized for this child's household`
            : "horizonDays exceeds the 30-day maximum",
      })
    }
    return result
  },
})

/**
 * Monotonic watermark advance: max(existing, at) — a stale client or a replay
 * can never move the reader backwards. Upsert keyed on by_caregiver_child;
 * the first write creates the row (undefined -> at).
 */
export const advanceReadState = mutation({
  args: convexFields(AdvanceReadStateInput),
  handler: async (ctx, rawArgs): Promise<{ lastSeenAt: number }> => {
    let args: typeof AdvanceReadStateInput["Type"]
    try {
      args = Schema.decodeUnknownSync(AdvanceReadStateInput)(stripUndefined(rawArgs))
    } catch (err) {
      throw new ConvexError({ code: "INVALID_ADVANCE_INPUT", message: errorText(err) })
    }

    const childId = ctx.db.normalizeId("children", args.childId)
    if (childId === null) {
      throw new ConvexError({
        code: "CHILD_NOT_FOUND",
        message: `child ${args.childId} does not exist`,
      })
    }

    const existing = await ctx.db
      .query("caregiverReadState")
      .withIndex("by_caregiver_child", (q) =>
        q.eq("caregiverId", args.caregiverId).eq("childId", args.childId),
      )
      .first()

    if (existing === null) {
      await ctx.db.insert("caregiverReadState", {
        caregiverId: args.caregiverId,
        childId: args.childId,
        lastSeenAt: args.at,
      })
      return { lastSeenAt: args.at }
    }
    // Same-value advance is a no-op (idempotent by construction).
    if (args.at > existing.lastSeenAt) {
      await ctx.db.patch(existing._id, { lastSeenAt: args.at })
      return { lastSeenAt: args.at }
    }
    return { lastSeenAt: existing.lastSeenAt }
  },
})
