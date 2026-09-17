/**
 * Entry store boundary (candidate D's storage service, extended by the grafts):
 * the pipeline's only write surface for capture entries.
 *
 * The store's contract encodes the two invariants the arena integration
 * settles:
 *  1. RAW-FIRST (candidate C): the first write of a capture is ALWAYS the
 *     verbatim raw transcript, as a `draft` entry — `attachEvents` and
 *     `publish` both fail with `raw_capture_missing` if no draft exists, so no
 *     extracted event can ever outlive or precede the caregiver's words.
 *  2. IDEMPOTENCE (envelope semantics (c) — same (captureId, attempt) applied
 *     twice is a no-op): persisting the same raw draft, attaching the same
 *     events, or publishing the same entry twice returns the existing state
 *     instead of duplicating rows.
 *
 * The in-memory double keeps an append-only raw log so `reloadFromLog`
 * reproduces candidate B's cold-start read-path semantics locally.
 */
import { Effect } from "effect"

import type { CaptureId } from "@journal/domain"
import type { CapturedEntry, CapturedEvent } from "../event.js"

export type { CapturedEntry, CapturedEvent }

export type StoreError =
  | { readonly _tag: "raw_capture_missing"; readonly captureId: string }
  | { readonly _tag: "unavailable"; readonly reason: string }

export interface DraftInput {
  readonly captureId: CaptureId
  readonly childId: string
  readonly authorId: string
  /** Verbatim dictated text — stored byte-for-byte, no normalization. */
  readonly rawTranscript: string
  /** Capture instant (Unix ms) — never process time. */
  readonly createdAt: number
}

export interface EntryStoreShape {
  /** Create (or idempotently return) the raw-first draft entry. */
  persistRawDraft: (draft: DraftInput) => Effect.Effect<CapturedEntry, StoreError>
  /** Attach extracted events to the existing draft (set-once per capture). */
  attachEvents: (captureId: string, events: ReadonlyArray<CapturedEvent>) => Effect.Effect<CapturedEntry, StoreError>
  /** Flip the draft to published visibility (idempotent). */
  publish: (captureId: string) => Effect.Effect<{ readonly entryId: string }, StoreError>
  /** The child's timeline, oldest first — draft and published alike, per contract. */
  timeline: (childId: string) => Effect.Effect<ReadonlyArray<CapturedEntry>, StoreError>
}

/** Raw-byte-safe identity check: same transcript bytes count as the same draft. */
const sameDraft = (existing: CapturedEntry, draft: DraftInput): boolean =>
  existing.captureId === draft.captureId && existing.rawTranscript === draft.rawTranscript

const sameEvents = (a: ReadonlyArray<CapturedEvent>, b: ReadonlyArray<CapturedEvent>): boolean =>
  a.length === b.length && a.every((event, index) => JSON.stringify(event) === JSON.stringify(b[index]))

export interface InMemoryEntryStore extends EntryStoreShape {
  /** Cold-start read-path probe: rebuild indexes from the durable raw log. */
  reloadFromLog: () => Effect.Effect<void>
  /** Test/inspection surface: count of durable raw-draft log records. */
  rawLogSize: () => number
}

export const makeInMemoryEntryStore = (): InMemoryEntryStore => {
  const entries = new Map<string, CapturedEntry>()
  /**
   * Durable op log (the reload double's source of truth): every mutation is
   * appended here in order; `reloadFromLog` replays it exactly, so the
   * post-reload timeline is identical to the pre-reload one — no lost,
   * duplicated, reordered, or mutated events (fixture 06 semantics).
   */
  const durableLog: Array<
    | { readonly kind: "draft"; readonly draft: DraftInput }
    | { readonly kind: "attach"; readonly captureId: string; readonly events: ReadonlyArray<CapturedEvent> }
    | { readonly kind: "publish"; readonly captureId: string }
  > = []

  const persistRawDraft = (draft: DraftInput): Effect.Effect<CapturedEntry, StoreError> =>
    Effect.suspend((): Effect.Effect<CapturedEntry, StoreError> => {
      const existing = entries.get(draft.captureId)
      if (existing !== undefined) {
        // Idempotent replay (fixture 04): identical raw bytes → same entry.
        if (sameDraft(existing, draft)) return Effect.succeed(existing)
        return Effect.fail({ _tag: "unavailable" as const, reason: `captureId ${draft.captureId} already exists with different raw content` })
      }
      const entry: CapturedEntry = {
        _tag: "Entry",
        captureId: draft.captureId,
        childId: draft.childId,
        authorId: draft.authorId,
        rawTranscript: draft.rawTranscript,
        createdAt: draft.createdAt,
        status: "draft",
        events: [],
      }
      entries.set(draft.captureId, entry)
      durableLog.push({ kind: "draft", draft: { ...draft } })
      return Effect.succeed(entry)
    })

  const attachEvents = (
    captureId: string,
    events: ReadonlyArray<CapturedEvent>,
  ): Effect.Effect<CapturedEntry, StoreError> =>
    Effect.suspend((): Effect.Effect<CapturedEntry, StoreError> => {
      const entry = entries.get(captureId)
      // Raw-before-events (candidate B's invariant, enforced client-side here
      // and server-side in backend/convex): no events without a raw draft.
      if (entry === undefined) return Effect.fail({ _tag: "raw_capture_missing" as const, captureId })
      if (sameEvents(entry.events, events)) return Effect.succeed(entry)
      if (entry.events.length > 0) {
        return Effect.fail({ _tag: "unavailable" as const, reason: `entry ${captureId} already carries different events` })
      }
      const updated: CapturedEntry = { ...entry, events: [...events] }
      entries.set(captureId, updated)
      durableLog.push({ kind: "attach", captureId, events: [...events] })
      return Effect.succeed(updated)
    })

  const publish = (captureId: string): Effect.Effect<{ readonly entryId: string }, StoreError> =>
    Effect.suspend((): Effect.Effect<{ readonly entryId: string }, StoreError> => {
      const entry = entries.get(captureId)
      if (entry === undefined) return Effect.fail({ _tag: "raw_capture_missing" as const, captureId })
      if (entry.status === "published") return Effect.succeed({ entryId: entry.captureId })
      entries.set(captureId, { ...entry, status: "published" })
      durableLog.push({ kind: "publish", captureId })
      return Effect.succeed({ entryId: entry.captureId })
    })

  const timeline = (childId: string) =>
    Effect.succeed(
      [...entries.values()].filter((entry) => entry.childId === childId).sort((a, b) => a.createdAt - b.createdAt),
    )

  const reloadFromLog = () =>
    Effect.sync(() => {
      entries.clear()
      for (const op of durableLog) {
        if (op.kind === "draft") {
          const draft = op.draft
          const entry: CapturedEntry = {
            _tag: "Entry",
            captureId: draft.captureId,
            childId: draft.childId,
            authorId: draft.authorId,
            rawTranscript: draft.rawTranscript,
            createdAt: draft.createdAt,
            status: "draft",
            events: [],
          }
          entries.set(draft.captureId, entry)
        } else if (op.kind === "attach") {
          const entry = entries.get(op.captureId)
          if (entry !== undefined) entries.set(op.captureId, { ...entry, events: [...op.events] })
        } else {
          const entry = entries.get(op.captureId)
          if (entry !== undefined) entries.set(op.captureId, { ...entry, status: "published" })
        }
      }
    })

  return {
    persistRawDraft,
    attachEvents,
    publish,
    timeline,
    reloadFromLog,
    rawLogSize: () => durableLog.length,
  }
}
