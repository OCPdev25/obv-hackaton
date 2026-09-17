import { mutationGeneric, queryGeneric } from "convex/server"
import { v } from "convex/values"

/**
 * QA deployment of the spike's REFERENCE module (spikes/voice-photo/convex/
 * photoStorage.ts) plus a read-back query for byte verification. Same flow,
 * same validators, deployed only to the throwaway local-real QA backend (see
 * qa-convex/schema.ts). Synthetic data only.
 */

/** Step 1 of the upload flow: hand out a short-lived upload URL (expires in 1h). */
export const generatePhotoUploadUrl = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl()
  },
})

/** Step 3 of the upload flow: persist the capture record after the POST succeeded. */
export const commitPhotoCapture = mutationGeneric({
  args: {
    storageId: v.id("_storage"),
    mimeType: v.string(),
    sizeBytes: v.number(),
    entry: v.optional(
      v.object({
        _tag: v.literal("Entry"),
        transcript: v.string(),
        authorId: v.string(),
        createdAt: v.number(),
        status: v.union(v.literal("draft"), v.literal("published")),
        events: v.array(v.any()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const entryId =
      args.entry === undefined ? undefined : await ctx.db.insert("entries", { ...args.entry, _tag: undefined as never })
    const photoId = await ctx.db.insert("photoCaptures", {
      storageId: args.storageId,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      entryId,
      createdAt: Date.now(),
    })
    return { photoId, entryId: entryId ?? null }
  },
})

/** Read-back for byte verification: a URL that serves the stored file. */
export const getPhotoUrl = queryGeneric({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId)
  },
})

/** Count of photoCaptures (synthetic-data hygiene check). */
export const countPhotoCaptures = queryGeneric({
  args: {},
  handler: async (ctx) => {
    return (await ctx.db.query("photoCaptures").collect()).length
  },
})
