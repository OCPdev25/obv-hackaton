import { Schema } from "effect"

import { AppendEventsInput, CreateEntryInput, CreateEntryOutput } from "@journal/domain"
import { convexFields } from "@journal/domain/convex"

import { mutation } from "./_generated/server"
import { ConvexError } from "convex/values"

import { errorText, stripUndefined } from "./lib"
import { buildRawCaptureRow, decodeAppendEvents, decideAttach, requireRawCaptureBeforeEvents } from "./entriesInput"

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

    // Arena-integration graft (candidate B): the append-only raw-captures log.
    // The verbatim transcript becomes immutable BEFORE any event can attach —
    // `appendEvents` fails closed without this row (raw-before-events).
    if (args.captureId !== undefined) {
      await ctx.db.insert("rawCaptures", buildRawCaptureRow({
        captureId: args.captureId,
        childId: args.childId,
        authorId: args.authorId,
        rawTranscript: args.rawTranscript,
        now: Date.now(),
      }))
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


/**
 * Arena-integration graft: append extracted events to an entry, consuming the
 * canonical `AppendEventsInput` contract. Enforcement order is fail-closed:
 * (1) candidate A's server-side re-decode through the canonical `EventFields`
 * — a confidence of 1.5 is rejected HERE regardless of client validation;
 * (2) candidate B's raw-before-events — an entry born from a capture session
 * must have its durable raw-capture row, or events are refused; (3) set-once
 * attach — first attach wins, the pipeline's own retry is idempotent, and a
 * different event set on an entry that already carries events is a conflict.
 */
export const appendEvents = mutation({
  args: convexFields(AppendEventsInput),
  handler: async (ctx, rawArgs) => {
    const decoded = decodeAppendEvents(stripUndefined(rawArgs))
    if (!decoded.ok) {
      throw new ConvexError({ code: "INVALID_APPEND_INPUT", message: decoded.reason })
    }
    const args = decoded.value

    const entryObjectId = ctx.db.normalizeId("entries", args.entryId)
    if (entryObjectId === null) {
      throw new ConvexError({ code: "ENTRY_NOT_FOUND", message: `entry ${args.entryId} does not exist` })
    }
    const entry = await ctx.db.get(entryObjectId)
    if (entry === null) {
      throw new ConvexError({ code: "ENTRY_NOT_FOUND", message: `entry ${args.entryId} does not exist` })
    }

    // Raw-before-events (candidate B, server-enforced): an entry produced by
    // a capture session requires its immutable raw-capture row. The by_capture
    // index guarantees captureId equality; the ref is built explicitly because
    // indexed reads return a loosely-typed row.
    const captureId = entry.captureId
    const rawCaptureRow =
      captureId === undefined
        ? undefined
        : await ctx.db
            .query("rawCaptures")
            .withIndex("by_capture", (q) => q.eq("captureId", captureId))
            .first()
    const rawCaptureRef =
      rawCaptureRow === null || rawCaptureRow === undefined
        ? undefined
        : { captureId: rawCaptureRow.captureId }
    const rawError = requireRawCaptureBeforeEvents(
      {
        captureId: entry.captureId,
        structuredEventIds: entry.structuredEventIds,
        extractionStatus: entry.extractionStatus,
      },
      rawCaptureRef,
    )
    if (rawError !== null) {
      throw new ConvexError({ code: "RAW_CAPTURE_REQUIRED", message: rawError })
    }

    const childObjectId = ctx.db.normalizeId("children", entry.childId)
    if (childObjectId === null) {
      throw new ConvexError({ code: "CHILD_NOT_FOUND", message: `entry child ${entry.childId} does not exist` })
    }
    const child = await ctx.db.get(childObjectId)
    if (child === null) {
      throw new ConvexError({ code: "CHILD_NOT_FOUND", message: `entry child ${entry.childId} does not exist` })
    }

    const decision = decideAttach(
      {
        captureId: entry.captureId,
        structuredEventIds: entry.structuredEventIds,
        extractionStatus: entry.extractionStatus,
      },
      args.events,
      { householdId: child.householdId, childId: entry.childId },
    )
    if (decision.kind === "conflict") {
      throw new ConvexError({ code: "EVENTS_SET_ONCE", message: decision.reason })
    }
    if (decision.kind === "idempotent") {
      return { status: "idempotent_hit" as const, entryId: entry._id }
    }

    const eventIds = []
    for (const row of decision.eventRows) {
      eventIds.push(await ctx.db.insert("events", row))
    }
    await ctx.db.patch(entryObjectId, {
      structuredEventIds: eventIds,
      extractionStatus: "structured",
    })
    return { status: "appended" as const, entryId: entry._id }
  },
})
