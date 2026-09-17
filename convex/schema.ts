import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { entryValidator } from './wire'

export default defineSchema({
  children: defineTable({
    name: v.string(),
    birthDate: v.optional(v.number()),
    createdAt: v.number(),
  }),
  // Storage superset of the Entry contract: childId + captureId are thin-path
  // storage keys (per-child timeline + idempotent retry), not contract fields.
  entries: defineTable({
    ...entryValidator.fields,
    childId: v.id('children'),
    captureId: v.string(),
  })
    .index('by_capture_id', ['captureId'])
    .index('by_child_createdAt', ['childId', 'createdAt']),
})
