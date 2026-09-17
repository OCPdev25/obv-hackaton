import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

/**
 * THROWAWAY QA schema for the PR #8 device-proof / 3-request-flow evidence
 * runs (checklist item 9). Deliberately NOT part of the canonical backend
 * schema in backend/convex — the v0.1 domain contract has no photo-capture
 * table (that extension belongs to the contract thread), and this schema only
 * exists so the reference module's flow can run against a real Convex server
 * (local-real dev backend) without touching shared deployments or contracts.
 *
 * Synthetic data only.
 */

export default defineSchema({
  photoCaptures: defineTable({
    storageId: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    entryId: v.optional(v.union(v.id("entries"), v.null())),
    createdAt: v.number(),
  }),
  // Minimal entries shape for the optional Entry-commit path. NOTE: the
  // reference module's entry validator carries `_tag: v.literal("Entry")` —
  // per the PR #5 finding (F1) Convex rejects underscore-prefixed stored
  // fields, so the entry path is expected to fail; the driver probes both
  // paths and records the observed behavior.
  entries: defineTable({
    transcript: v.string(),
    authorId: v.string(),
    createdAt: v.number(),
    status: v.union(v.literal("draft"), v.literal("published")),
  }),
})
