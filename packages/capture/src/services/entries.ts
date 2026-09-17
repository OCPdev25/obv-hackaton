/**
 * EntryStore service: persistence boundary with two layers.
 *
 *  - `inMemoryEntryStoreLayer` — deterministic in-process store, keyed by
 *    captureId. Idempotency semantics are identical to the Convex layer's
 *    (check-then-insert inside one atomic operation), which makes it the
 *    controlled test implementation.
 *  - `makeConvexEntryStoreLayer(url)` — LOCAL-REAL persistence: talks to a
 *    Convex backend over HTTP (local dev mode in this slice). Labels live in
 *    docs/ARENA-CANDIDATE-D.md; this is not a deployed/cloud deployment.
 */
import { Context, Effect, Layer, Schema } from "effect"

import type { ChildId, Entry, EntryId } from "@journal/domain"
import { decodeEntryResult, encodeEntry } from "@journal/domain"

export class PublishError extends Schema.TaggedError<PublishError>()("PublishError", {
  captureId: Schema.NonEmptyString,
  reason: Schema.String,
}) {}

export class ReadError extends Schema.TaggedError<ReadError>()("ReadError", {
  childId: Schema.NonEmptyString,
  reason: Schema.String,
}) {}

export interface EntryStoreShape {
  /** Idempotent by captureId: retrying the same publish never duplicates. */
  publish: (draft: Entry) => Effect.Effect<Entry, PublishError>
  timeline: (childId: ChildId) => Effect.Effect<ReadonlyArray<Entry>, ReadError>
}

export class EntryStore extends Context.Service<EntryStore, EntryStoreShape>()("@journal/EntryStore") {}

const entryIdsByCounter = (prefix: string): (() => EntryId) => {
  let counter = 0
  const decode = Schema.decodeSync(Schema.NonEmptyString.pipe(Schema.brand("EntryId")))
  return () => decode(`${prefix}_${String(++counter).padStart(6, "0")}`)
}

export const makeInMemoryEntryStore = (
  mintEntryId: () => EntryId = entryIdsByCounter("entry_mem"),
): EntryStoreShape => {
  // captureId → stored entry. The key IS the idempotency guarantee.
  const entries = new Map<string, Entry>()
  return {
    publish: (draft) =>
      Effect.sync(() => {
        const existing = entries.get(draft.captureId)
        if (existing !== undefined) return existing
        const stored: Entry = { ...draft, entryId: mintEntryId() }
        entries.set(draft.captureId, stored)
        return stored
      }),
    timeline: (childId) =>
      Effect.sync(() =>
        [...entries.values()]
          .filter((entry) => entry.childId === childId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
  }
}

export const inMemoryEntryStoreLayer = Layer.effect(
  EntryStore,
  Effect.sync(() => makeInMemoryEntryStore()),
)
