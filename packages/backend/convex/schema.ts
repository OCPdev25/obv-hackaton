/**
 * Plain Convex schema (Confect is Effect-v3-only; memory note confect) — the
 * Effect domain remains the authority; these validators mirror the wire shape
 * that encodeEntry produces and decodeEntryResult consumes.
 */
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const eventValidator = v.object({
  _tag: v.literal("Event"),
  category: v.union(
    v.literal("potty"),
    v.literal("meal"),
    v.literal("sleep"),
    v.literal("mood"),
    v.literal("milestone"),
    v.literal("school"),
  ),
  occurredAt: v.number(),
  quantity: v.optional(v.object({ value: v.number(), unit: v.string() })),
  confidence: v.number(),
  authorId: v.string(),
  note: v.optional(v.string()),
})

export default defineSchema({
  entries: defineTable({
    _tag: v.literal("Entry"),
    captureId: v.string(),
    childId: v.string(),
    transcript: v.string(),
    authorId: v.string(),
    createdAt: v.number(),
    status: v.union(v.literal("draft"), v.literal("published")),
    events: v.array(eventValidator),
  })
    .index("by_captureId", ["captureId"])
    .index("by_childId_createdAt", ["childId", "createdAt"]),
})
