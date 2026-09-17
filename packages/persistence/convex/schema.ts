import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/**
 * Convex persistence for the capture slice. Wire shapes mirror the Effect
 * Schema contract (packages/domain): ids are strings, timestamps are unix
 * millis, events carry category/confidence. Domain types are decoded/encoded
 * at the adapter boundary (wire.ts), never inside functions.
 */
export default defineSchema({
  entries: defineTable({
    captureId: v.string(),
    childId: v.string(),
    transcript: v.string(),
    authorId: v.string(),
    createdAt: v.number(),
    status: v.union(v.literal('draft'), v.literal('published')),
    events: v.array(
      v.object({
        _tag: v.literal('Event'),
        category: v.string(),
        occurredAt: v.number(),
        quantity: v.optional(v.object({ value: v.number(), unit: v.optional(v.string()) })),
        confidence: v.number(),
        authorId: v.string(),
        note: v.optional(v.string()),
      }),
    ),
  })
    .index('by_capture_id', ['captureId'])
    .index('by_child_created', ['childId', 'createdAt']),
})
