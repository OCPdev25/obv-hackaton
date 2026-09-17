import { query } from './_generated/server'
import { v } from 'convex/values'

export const list = query({
  args: {
    childId: v.id('children'),
  },
  handler: async (ctx, args) => {
    // Chronological order (oldest first) — a journal reads forward in time.
    const rows = await ctx.db
      .query('entries')
      .withIndex('by_child_createdAt', (q) => q.eq('childId', args.childId))
      .order('asc')
      .collect()
    // Read boundary: re-wrap the wire-level `_tag` discriminators that storage
    // strips (Convex reserves `_`-prefixed fields), so returned objects decode
    // through the canonical Entry/Event schemas unchanged.
    return rows.map((row) => ({
      _tag: 'Entry' as const,
      ...row,
      events: row.events.map((event) => ({ _tag: 'Event' as const, ...event })),
    }))
  },
})
