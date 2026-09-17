/**
 * Convex storage schema — transport/Storage ONLY.
 *
 * The domain authority is the Effect Schema in src/domain/schema.ts; these
 * Convex validators are the one-directional adapter (schema → validators) the
 * canonical contract prescribes. Nothing here encodes limits on children or
 * caregivers — fixtures decide the demo data, not the schema.
 */
import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const eventCategory = v.union(
  v.literal("potty"),
  v.literal("meal"),
  v.literal("sleep"),
  v.literal("mood"),
  v.literal("milestone"),
  v.literal("school"),
)

const eventValidator = v.object({
  _tag: v.literal("Event"),
  category: eventCategory,
  // Unix-ms number on the wire (Effect Schema.DateFromMillis).
  occurredAt: v.number(),
  quantity: v.optional(v.object({ value: v.number(), unit: v.optional(v.string()) })),
  // NOTE: v.number() cannot express the [0, 1] domain range — the range is
  // enforced by the Effect Schema decode inside publishCapture, which is the
  // reason Effect Schema is the domain authority.
  confidence: v.number(),
  authorId: v.string(),
  note: v.optional(v.string()),
})

export default defineSchema({
  children: defineTable({
    childKey: v.string(),
    name: v.string(),
  }).index("by_childKey", ["childKey"]),

  caregivers: defineTable({
    caregiverKey: v.string(),
    name: v.string(),
  }).index("by_caregiverKey", ["caregiverKey"]),

  entries: defineTable({
    // Arena brief: idempotency on a stable captureId.
    captureId: v.string(),
    childId: v.string(),
    transcript: v.string(),
    authorId: v.string(),
    createdAt: v.number(),
    status: v.union(v.literal("draft"), v.literal("published")),
    events: v.array(eventValidator),
  })
    .index("by_captureId", ["captureId"])
    .index("by_child_created", ["childId", "createdAt"]),
})
