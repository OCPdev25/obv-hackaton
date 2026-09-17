import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'

export const create = mutation({
  args: {
    name: v.string(),
    // Unix ms on the wire.
    birthDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim()
    if (name.length === 0) {
      throw new ConvexError({
        code: 'INVALID_NAME',
        message: 'name must be a non-empty string',
      })
    }
    const createdAt = Date.now()
    const child =
      args.birthDate === undefined
        ? { name, createdAt }
        : { name, birthDate: args.birthDate, createdAt }
    const childId = await ctx.db.insert('children', child)
    return { status: 'created' as const, childId, name }
  },
})
