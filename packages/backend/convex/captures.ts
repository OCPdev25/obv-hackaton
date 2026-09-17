import { v } from "convex/values"
import { Result } from "effect"
import { mutation, query } from "./_generated/server.js"
import { decodeJournalEvent } from "@journal/contracts"

/**
 * Capture persistence — the Convex half of the service boundary.
 *
 * Invariants (from the arena contract):
 *  1. Raw input is retained UNCHANGED, append-only, keyed by the client-minted
 *     captureId. persistCaptureRaw is idempotent: a retry returns the existing
 *     record instead of writing a duplicate.
 *  2. The Effect Schema (@journal/contracts) is the validation authority.
 *     publishEntry re-decodes the event payload at the boundary and fails the
 *     mutation on any schema violation — the client keeps its raw capture and
 *     may retry after correction (PublishFailed → Review state machine).
 *  3. journal_entries holds at most one entry per captureId (idempotent
 *     publication).
 *
 * Deliberate boundary split: Convex validators (v.string(), v.number(), v.any())
 * are cheap structural checks for the wire; domain meaning lives in the
 * Effect Schema decode below.
 */

const CAPTURE_ARGS = {
  captureId: v.string(),
  childId: v.string(),
  authorCaregiverId: v.string(),
  rawText: v.string(),
  occurredAt: v.number(),
  schemaVersion: v.number(),
}

export const persistCaptureRaw = mutation({
  args: CAPTURE_ARGS,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("captures")
      .withIndex("by_capture_id", (q) => q.eq("captureId", args.captureId))
      .first()
    if (existing !== null) {
      // Idempotent retry: raw record already retained, nothing duplicated.
      return { status: "already" as const, captureId: args.captureId }
    }
    await ctx.db.insert("captures", { ...args, createdAt: Date.now() })
    return { status: "created" as const, captureId: args.captureId }
  },
})

export const publishEvent = mutation({
  args: {
    ...CAPTURE_ARGS,
    event: v.any(), // re-validated below by the JournalEvent Effect Schema
  },
  handler: async (ctx, args) => {
    const decoded = decodeJournalEvent(args.event)
    if (Result.isFailure(decoded)) {
      // Schema authority says no. The client keeps raw + event and retries
      // (machine: PublishFailed → Review with raw text intact).
      throw new Error(`EVENT_DECODE_FAILED: ${decoded.failure.message}`)
    }
    // Result.Success carries the decoded value in `.success`.
    const event = decoded.success

    const existing = await ctx.db
      .query("journal_entries")
      .withIndex("by_capture_id", (q) => q.eq("captureId", args.captureId))
      .first()
    if (existing !== null) {
      return { status: "already" as const, entryId: existing._id, captureId: args.captureId }
    }

    // Raw capture must exist before an event can publish (raw-first invariant).
    const capture = await ctx.db
      .query("captures")
      .withIndex("by_capture_id", (q) => q.eq("captureId", args.captureId))
      .first()
    if (capture === null) {
      throw new Error("CAPTURE_NOT_PERSISTED: publish requires the raw capture to exist first")
    }

    const entryId = await ctx.db.insert("journal_entries", {
      captureId: args.captureId,
      childId: args.childId,
      authorCaregiverId: args.authorCaregiverId,
      occurredAt: args.occurredAt,
      event,
      schemaVersion: args.schemaVersion,
      publishedAt: Date.now(),
    })
    return { status: "created" as const, entryId, captureId: args.captureId }
  },
})

export const publishRawOnly = mutation({
  args: CAPTURE_ARGS,
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("journal_entries")
      .withIndex("by_capture_id", (q) => q.eq("captureId", args.captureId))
      .first()
    if (existing !== null) {
      return { status: "already" as const, entryId: existing._id, captureId: args.captureId }
    }
    const capture = await ctx.db
      .query("captures")
      .withIndex("by_capture_id", (q) => q.eq("captureId", args.captureId))
      .first()
    if (capture === null) {
      throw new Error("CAPTURE_NOT_PERSISTED: publish requires the raw capture to exist first")
    }
    const entryId = await ctx.db.insert("journal_entries", {
      captureId: args.captureId,
      childId: args.childId,
      authorCaregiverId: args.authorCaregiverId,
      occurredAt: args.occurredAt,
      event: null, // raw-only entry: no schema-validated event extracted
      schemaVersion: args.schemaVersion,
      publishedAt: Date.now(),
    })
    return { status: "created" as const, entryId, captureId: args.captureId }
  },
})

export const listEntries = query({
  args: { childId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("journal_entries")
      .withIndex("by_child_occurred", (q) => q.eq("childId", args.childId))
      .order("desc")
      .take(100)
  },
})

export const listCaptures = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("captures").order("desc").take(100)
  },
})

export const getChild = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("children")
      .filter((q) => q.eq(q.field("name"), args.name))
      .first()
  },
})

export const listCaregivers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("caregivers").take(100)
  },
})
