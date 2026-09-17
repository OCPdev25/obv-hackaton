import { ConvexError } from 'convex/values'
import { mutation, query } from './_generated/server.js'
import { v } from 'convex/values'

/**
 * Idempotent capture mutations. Every write is keyed by the client-generated
 * `captureId`, so a retried persist or publish can never duplicate an entry.
 */

const wireEvent = v.object({
  _tag: v.literal('Event'),
  category: v.string(),
  occurredAt: v.number(),
  quantity: v.optional(v.object({ value: v.number(), unit: v.optional(v.string()) })),
  confidence: v.number(),
  authorId: v.string(),
  note: v.optional(v.string()),
})

// Mirrors the contract wire shape: _tag on the wire, status carried through.
const wireEntry = v.object({
  _tag: v.literal('Entry'),
  captureId: v.string(),
  childId: v.string(),
  transcript: v.string(),
  authorId: v.string(),
  createdAt: v.number(),
  status: v.union(v.literal('draft'), v.literal('published')),
  events: v.array(wireEvent),
})

export const persistRawCapture = mutation({
  args: { entry: wireEntry },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('entries')
      .withIndex('by_capture_id', (q) => q.eq('captureId', args.entry.captureId))
      .first()
    if (existing) return { captureId: args.entry.captureId, inserted: false as const }
    const { _tag, ...fields } = args.entry
    const id = await ctx.db.insert('entries', { ...fields, status: 'draft' as const })
    return { captureId: args.entry.captureId, inserted: true as const, docId: id }
  },
})

export const publishEvents = mutation({
  args: { captureId: v.string(), events: v.array(wireEvent) },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query('entries')
      .withIndex('by_capture_id', (q) => q.eq('captureId', args.captureId))
      .first()
    if (!entry) {
      // Raw-before-events invariant: never fabricate an entry at publish time.
      throw new ConvexError({ code: 'raw_capture_missing', detail: `no draft entry for capture ${args.captureId}` })
    }
    if (entry.status === 'published') {
      return { _tag: 'AlreadyPublished' as const, entryId: entry._id }
    }
    await ctx.db.patch(entry._id, { status: 'published' as const, events: args.events })
    return { _tag: 'Published' as const, entryId: entry._id }
  },
})

export const timeline = query({
  args: { childId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('entries')
      .withIndex('by_child_created', (q) => q.eq('childId', args.childId))
      .order('desc')
      .collect()
    return rows
      .filter((row) => row.status === 'published')
      .map((row) => ({
        entryId: row._id,
        captureId: row.captureId,
        childId: row.childId,
        transcript: row.transcript,
        authorId: row.authorId,
        createdAt: row.createdAt,
        events: row.events,
      }))
  },
})
