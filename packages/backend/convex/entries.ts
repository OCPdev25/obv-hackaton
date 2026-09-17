/**
 * Entry persistence functions. publishEntry is idempotent by captureId:
 * a retry returns the FIRST stored entry and inserts nothing. Wire shape
 * (millis, plain strings) matches @journal/domain encodeEntry/decodeEntryResult.
 */
import { v } from "convex/values"

import { mutation, query } from "./_generated/server.js"

const toWire = (doc: {
  _id: string
  _tag: "Entry"
  captureId: string
  childId: string
  transcript: string
  authorId: string
  createdAt: number
  status: "draft" | "published"
  events: unknown[]
}) => ({
  _tag: doc._tag,
  entryId: doc._id,
  captureId: doc.captureId,
  childId: doc.childId,
  transcript: doc.transcript,
  authorId: doc.authorId,
  createdAt: doc.createdAt,
  status: doc.status,
  events: doc.events,
})

export const publishEntry = mutation({
  args: {
    _tag: v.literal("Entry"),
    captureId: v.string(),
    childId: v.string(),
    transcript: v.string(),
    authorId: v.string(),
    createdAt: v.number(),
    status: v.union(v.literal("draft"), v.literal("published")),
    events: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("entries")
      .withIndex("by_captureId", (q) => q.eq("captureId", args.captureId))
      .unique()
    if (existing !== null) return toWire(existing)
    const entryId = await ctx.db.insert("entries", args)
    return toWire({ ...args, _id: entryId })
  },
})

export const timelineForChild = query({
  args: { childId: v.string() },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("entries")
      .withIndex("by_childId_createdAt", (q) => q.eq("childId", args.childId))
      .order("desc")
      .collect()
    return docs.map(toWire)
  },
})
