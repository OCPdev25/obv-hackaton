import { ConvexHttpClient } from 'convex/browser'
import { Effect, Schema } from 'effect'
import { StoreError } from '@journal/domain'
import { CaptureStore, EntryId, type CaptureStoreShape } from '@journal/domain'
import type { CaptureId, ChildId, Event, Entry, TimelineItem } from '@journal/domain'
import { decodeTimeline, encodeEntry, encodeEvents } from './wire.js'
import { api } from '../convex/_generated/api.js'

/**
 * Live Convex-backed CaptureStore. Talks to a Convex deployment (local dev
 * backend at http://127.0.0.1:3210 in this arena) through ConvexHttpClient.
 * Wire conversion happens here at the boundary only.
 */
export const makeConvexCaptureStore = (client: ConvexHttpClient): CaptureStoreShape => {
  const toStoreError = (error: unknown): StoreError => {
    // Convex surfaces ConvexError payloads as { code, detail } via data.
    const data = (error as { data?: unknown } | null)?.data
    if (typeof data === 'object' && data !== null && 'code' in data && 'detail' in data) {
      return new StoreError(data as { code: 'raw_capture_missing' | 'unavailable' | 'validation_failed'; detail: string })
    }
    return new StoreError({ code: 'unavailable', detail: error instanceof Error ? error.message : String(error) })
  }

  return {
    persistRaw: (entry: Entry) =>
      Effect.tryPromise({
        try: async () => {
          await client.mutation(api.capture.persistRawCapture, { entry: encodeEntry(entry) })
        },
        catch: toStoreError,
      }),

    publish: ({ captureId, events }: { captureId: CaptureId; events: ReadonlyArray<Event> }) =>
      Effect.tryPromise({
        try: async () => {
          const result = await client.mutation(api.capture.publishEvents, { captureId, events: encodeEvents(events) })
          // Boundary conversion: the Convex document id becomes the domain's
          // branded EntryId through the canonical schema.
          return { _tag: result._tag, entryId: Schema.decodeSync(EntryId)(result.entryId) }
        },
        catch: toStoreError,
      }),

    timeline: (childId: ChildId) =>
      Effect.tryPromise({
        try: async () => {
          const wire = await client.query(api.capture.timeline, { childId })
          return decodeTimeline(wire) as Array<TimelineItem>
        },
        catch: toStoreError,
      }),
  }
}
