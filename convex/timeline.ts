import { query } from './_generated/server'
import { v } from 'convex/values'

export const list = query({
  args: {
    childId: v.id('children'),
  },
  handler: async (ctx, args) => {
    // Chronological order (oldest first) — a journal reads forward in time.
    return await ctx.db
      .query('entries')
      .withIndex('by_child_createdAt', (q) => q.eq('childId', args.childId))
      .order('asc')
      .collect()
  },
})
