/**
 * Child timeline — reads entries for one child in creation order and joins
 * caregiver names for attribution. The client re-decodes rows through the
 * TimelineRow Effect schema (boundary decode on the read side).
 */
import { v } from "convex/values"
import { query } from "./_generated/server"

export const timelineForChild = query({
  args: { childId: v.string() },
  handler: async (ctx, { childId }) => {
    const entries = await ctx.db
      .query("entries")
      .withIndex("by_child_created", (q) => q.eq("childId", childId))
      .order("asc")
      .collect()
    const caregivers = await ctx.db.query("caregivers").collect()
    const nameByCaregiverKey = new Map(caregivers.map((c) => [c.caregiverKey, c.name]))
    return entries.map((entry) => ({
      recordId: entry._id,
      captureId: entry.captureId,
      transcript: entry.transcript,
      authorId: entry.authorId,
      authorName: nameByCaregiverKey.get(entry.authorId) ?? entry.authorId,
      status: entry.status,
      createdAt: entry.createdAt,
      events: entry.events,
    }))
  },
})
