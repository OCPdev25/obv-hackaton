import { Context, type Effect } from 'effect'
import type { CaptureId, CaregiverId, ChildId, EntryId } from './ids.js'
import type { Event, Entry, TimelineItem } from './schema.js'
import type { ExtractionError, StoreError } from './errors.js'

/**
 * Effectful operations live behind service interfaces. Live (Convex) and
 * controlled test (in-memory) implementations both satisfy these shapes.
 */

export interface PublishOutcome {
  readonly _tag: 'Published' | 'AlreadyPublished'
  readonly entryId: EntryId
}

export interface ExtractorShape {
  readonly extract: (args: {
    readonly captureId: CaptureId
    readonly transcript: string
    readonly authorId: CaregiverId
    readonly capturedAt: Date
  }) => Effect.Effect<ReadonlyArray<Event>, ExtractionError>
}

export class Extractor extends Context.Service<Extractor, ExtractorShape>()('journal/Extractor') {}

export interface CaptureStoreShape {
  /**
   * Idempotent by `entry.captureId`: inserts when absent, no-op when present.
   * Never overwrites an already-published entry.
   */
  readonly persistRaw: (entry: Entry) => Effect.Effect<void, StoreError>
  /**
   * Idempotent by `captureId`. Requires the raw draft to exist first (the
   * raw-before-events invariant: raw input is retained before any events are
   * written). A repeat call for an already-published capture returns
   * `AlreadyPublished` and changes nothing.
   */
  readonly publish: (args: {
    readonly captureId: CaptureId
    readonly events: ReadonlyArray<Event>
  }) => Effect.Effect<PublishOutcome, StoreError>
  /** Published entries for a child, newest first. */
  readonly timeline: (childId: ChildId) => Effect.Effect<ReadonlyArray<TimelineItem>, StoreError>
}

export class CaptureStore extends Context.Service<CaptureStore, CaptureStoreShape>()('journal/CaptureStore') {}
