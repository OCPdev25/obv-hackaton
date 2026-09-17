import { Effect, Schema } from 'effect'
import { StoreError } from '@journal/domain'
import { CaptureStore, EntryId, type CaptureStoreShape } from '@journal/domain'
import type { CaptureId, ChildId, Event, Entry, TimelineItem } from '@journal/domain'

/**
 * Controlled in-memory implementation of CaptureStore. Deterministic and
 * dependency-free — the test double for unit tests, the CLI demo, and the
 * Expo demo when no Convex backend is configured. Idempotency semantics match
 * the Convex functions exactly (keyed by captureId).
 */
export const makeInMemoryCaptureStore = (): {
  store: CaptureStoreShape
  entries: Map<string, Entry>
  published: Map<string, { entryId: EntryId; events: ReadonlyArray<Event> }>
} => {
  const entries = new Map<string, Entry>()
  const published = new Map<string, { entryId: EntryId; events: ReadonlyArray<Event> }>()
  const timeline: Array<TimelineItem> = []

  const store: CaptureStoreShape = {
    persistRaw: (entry: Entry) =>
      Effect.sync(() => {
        if (!entries.has(entry.captureId)) entries.set(entry.captureId, { ...entry })
      }),

    publish: ({ captureId, events }: { captureId: CaptureId; events: ReadonlyArray<Event> }) =>
      Effect.gen(function* () {
        const raw = entries.get(captureId)
        // Raw-before-events invariant, enforced on the typed error channel.
        if (raw === undefined) {
          return yield* Effect.fail(new StoreError({ code: 'raw_capture_missing', detail: `no draft entry for capture ${captureId}` }))
        }
        const existing = published.get(captureId)
        if (existing) return { _tag: 'AlreadyPublished', entryId: existing.entryId }
        const entryId = Schema.decodeSync(EntryId)(`entry-${published.size + 1}`)
        published.set(captureId, { entryId, events: [...events] })
        timeline.unshift({
          entryId,
          captureId,
          childId: raw.childId,
          transcript: raw.transcript,
          authorId: raw.authorId,
          createdAt: raw.createdAt,
          events: [...events],
        })
        return { _tag: 'Published', entryId }
      }),

    timeline: (childId: ChildId) => Effect.sync(() => timeline.filter((item) => item.childId === childId)),
  }

  return { store, entries, published }
}
