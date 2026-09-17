import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

/**
 * Convex persistence schema. Deliberately cheap: validators here perform
 * structural checks only (ids are opaque strings, events are untyped at this
 * layer). The Effect Schema in @journal/contracts is the validation authority
 * for domain values — every mutation re-decodes before writing.
 *
 * No schema-level limits on children or caregivers: fixtures seed one child
 * and two caregivers, but the tables accept any household shape.
 */
export default defineSchema({
  households: defineTable({
    name: v.string(),
  }),

  children: defineTable({
    name: v.string(),
    birthdate: v.string(), // ISO date, informational only
    householdId: v.id("households"),
  }),

  caregivers: defineTable({
    name: v.string(),
    role: v.string(), // e.g. "technical owner", "co-parent", "caregiver"
    householdId: v.id("households"),
  }),

  // Immutable raw capture records — append-only, never updated.
  captures: defineTable({
    captureId: v.string(), // client-minted stable id (branded in contracts)
    childId: v.string(),
    authorCaregiverId: v.string(),
    rawText: v.string(),
    occurredAt: v.number(),
    schemaVersion: v.number(),
    createdAt: v.number(),
  })
    .index("by_capture_id", ["captureId"])
    .index("by_child", ["childId", "occurredAt"]),

  // Published journal entries. One entry per captureId maximum: the unique
  // index on captureId plus the idempotent write path make publication
  // retry-safe — a retried publish returns the existing entry.
  journal_entries: defineTable({
    captureId: v.string(),
    childId: v.string(),
    authorCaregiverId: v.string(),
    occurredAt: v.number(),
    event: v.any(), // validated by JournalEvent schema decode before write
    schemaVersion: v.number(),
    publishedAt: v.number(),
  })
    .index("by_capture_id", ["captureId"])
    .index("by_child_occurred", ["childId", "occurredAt"]),
})
