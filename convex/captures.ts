/**
 * Capture publication — idempotent on the stable captureId.
 *
 * Boundary decode: the handler re-decodes the full wire payload through the
 * Effect Schema (src/domain/schema.ts) even though the Convex args validator
 * already passed. The Convex validator cannot express domain constraints
 * (confidence range, non-empty strings) — the Effect decode can, and rejects
 * with a ConvexError BEFORE anything is stored. That is the demonstration that
 * Effect Schema, not the transport validator, is the domain authority.
 */
import { Schema } from "effect"
import { ConvexError, v } from "convex/values"
import { mutation } from "./_generated/server"
import { Entry } from "../src/domain/schema.js"

const explain = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const publishCapture = mutation({
  args: {
    _tag: v.literal("Entry"),
    captureId: v.string(),
    childId: v.string(),
    transcript: v.string(),
    authorId: v.string(),
    createdAt: v.number(),
    status: v.union(v.literal("draft"), v.literal("published")),
    // Transport validators are deliberately loose here (v.any()); the Effect
    // Schema decode below is the domain authority.
    events: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    // Domain authority check — rejects confidence outside [0,1], empty
    // transcripts/notes, unknown categories, wrong tag, etc.
    let entry
    try {
      entry = Schema.decodeUnknownSync(Entry)(args)
    } catch (error) {
      throw new ConvexError({ code: "validation", detail: explain(error) })
    }

    // Idempotency: a captureId names exactly one Entry. A retried publish
    // returns the first result and stores nothing new.
    const existing = await ctx.db
      .query("entries")
      .withIndex("by_captureId", (q) => q.eq("captureId", entry.captureId))
      .first()
    if (existing !== null) {
      return { recordId: existing._id, duplicate: true, eventCount: existing.events.length }
    }

    // Re-encode through the schema before storage: Date fields become unix-ms
    // numbers and absent optional keys are stripped (Convex documents must not
    // carry undefined values).
    const wire = Schema.encodeSync(Entry)(entry)
    // Spread: encoded arrays are readonly; Convex documents take mutable arrays.
    const recordId = await ctx.db.insert("entries", {
      captureId: wire.captureId,
      childId: wire.childId,
      transcript: wire.transcript,
      authorId: wire.authorId,
      createdAt: wire.createdAt,
      status: wire.status,
      events: [...wire.events],
    })
    return { recordId, duplicate: false, eventCount: wire.events.length }
  },
})

/**
 * Fixture upsert — idempotent by stable keys. Takes ANY child/caregiver list;
 * the one-child-two-caregivers shape comes from src/services/fixtures.ts, not
 * from any schema limit.
 */
export const ensureFixtures = mutation({
  args: {
    childKey: v.string(),
    childName: v.string(),
    caregivers: v.array(v.object({ caregiverKey: v.string(), name: v.string() })),
  },
  handler: async (ctx, args) => {
    const child = await ctx.db
      .query("children")
      .withIndex("by_childKey", (q) => q.eq("childKey", args.childKey))
      .first()
    if (child === null) {
      await ctx.db.insert("children", { childKey: args.childKey, name: args.childName })
    }
    for (const caregiver of args.caregivers) {
      const existing = await ctx.db
        .query("caregivers")
        .withIndex("by_caregiverKey", (q) => q.eq("caregiverKey", caregiver.caregiverKey))
        .first()
      if (existing === null) {
        await ctx.db.insert("caregivers", { caregiverKey: caregiver.caregiverKey, name: caregiver.name })
      }
    }
    // Domain ids are the stable keys, not Convex _ids.
    return { childId: args.childKey, caregiverIds: args.caregivers.map((c) => c.caregiverKey) }
  },
})
