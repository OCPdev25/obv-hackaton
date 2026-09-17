import { mutationGeneric } from 'convex/server'
import { v } from 'convex/values'

/**
 * REFERENCE Convex module for the photo capture flow — the server side of
 * `src/photo/photoStorage.ts`. In the real app these functions move into the
 * monorepo scaffold's `convex/` directory (with `_generated/server` and the
 * household-scoped auth checks); this copy exists so the flow's shape and
 * validators are reviewable and typechecked alongside the client.
 *
 * Validators follow the published contract's "Convex mapping" table
 * (art_I2TCG08V) one-directionally: schema -> validators. This module must
 * never be imported by domain code, and the Effect schema must never be
 * replaced by a second hand-rolled domain model.
 *
 * Table note: `photoCaptures` and `entries` land with the app scaffold — this
 * module documents the document shapes and the 3-request upload flow until then.
 */

/** Entry per the contract's Convex mapping (dates as v.number() unix-ms). */
export const entryValidator = v.object({
  _tag: v.literal('Entry'),
  transcript: v.string(),
  authorId: v.string(),
  createdAt: v.number(),
  status: v.union(v.literal('draft'), v.literal('published')),
  events: v.array(
    v.object({
      _tag: v.literal('Event'),
      category: v.union(
        v.literal('potty'),
        v.literal('meal'),
        v.literal('sleep'),
        v.literal('mood'),
        v.literal('milestone'),
        v.literal('school'),
      ),
      occurredAt: v.number(),
      quantity: v.optional(v.object({ value: v.number(), unit: v.optional(v.string()) })),
      confidence: v.number(),
      authorId: v.string(),
      note: v.optional(v.string()),
    }),
  ),
})

/** Step 1 of the upload flow: hand out a short-lived upload URL (expires in 1h). */
export const generatePhotoUploadUrl = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    // Authorization (which caregiver may upload to which household) lands with
    // the scaffold's auth tables — fail closed there.
    return await ctx.storage.generateUploadUrl()
  },
})

/** Step 3 of the upload flow: persist the capture record after the POST succeeded. */
export const commitPhotoCapture = mutationGeneric({
  args: {
    storageId: v.id('_storage'),
    mimeType: v.string(),
    sizeBytes: v.number(),
    entry: v.optional(entryValidator),
  },
  handler: async (ctx, args) => {
    const entryId = args.entry === undefined ? undefined : await ctx.db.insert('entries', args.entry)
    const photoId = await ctx.db.insert('photoCaptures', {
      storageId: args.storageId,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      entryId,
      createdAt: Date.now(),
    })
    return { photoId, entryId: entryId ?? null }
  },
})
