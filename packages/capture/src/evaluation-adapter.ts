/**
 * Integrated corpus adapter (graft: the harness "runs identically against
 * every candidate"). Drives the integrated capture pipeline — D's loop and
 * reducer, C's raw-first persistence and retry, A's failure-park modeling —
 * over the in-memory entry store, and exposes ONLY the CandidateAdapter
 * surface (structural, no corpus import): the corpus must not import
 * candidate code, so this file must not import corpus internals either.
 */
import { Effect } from "effect"

import { makeCaptureLoop } from "./runtime.js"
import { makeInMemoryEntryStore } from "./services/entries.js"
import { makeDeterministicExtractor } from "./services/extraction.js"

import type { CaptureServices } from "./runtime.js"
import type { CapturedEntry } from "./services/entries.js"

/** Corpus-scoped child: one child's timeline, per evaluation/README.md. */
export const CORPUS_CHILD_ID = "child-corpus"

export const createIntegratedAdapter = () => {
  const entries = makeInMemoryEntryStore()
  const services: CaptureServices = {
    extraction: makeDeterministicExtractor(),
    entries,
  }

  const toWire = (entry: CapturedEntry) => ({
    _tag: "Entry" as const,
    captureId: entry.captureId,
    transcript: entry.rawTranscript,
    authorId: entry.authorId,
    createdAt: entry.createdAt,
    status: entry.status,
    events: entry.events,
  })

  const runPipeline = async (input: {
    readonly captureId: string
    readonly transcript: string
    readonly authorId: string
    readonly capturedAt: number
    readonly timezone: string
  }): Promise<void> => {
    // One machine per capture; the store is the shared durable layer.
    const loop = makeCaptureLoop(services)
    const dispatch = (message: unknown) => Effect.runPromise(loop.dispatch(message as never))
    await dispatch({
      _tag: "CaptureStarted",
      captureId: input.captureId,
      childId: CORPUS_CHILD_ID,
      authorId: input.authorId,
    })
    await dispatch({
      _tag: "CompletedTranscription",
      captureId: input.captureId,
      transcript: input.transcript,
      at: input.capturedAt,
      timezone: input.timezone,
    })
    await dispatch({ _tag: "SubmittedForExtraction", captureId: input.captureId })
  }

  return {
    name: "integrated-arena",
    createEntry: async (input: {
      readonly captureId: string
      readonly transcript: string
      readonly authorId: string
      readonly capturedAt: number
      readonly timezone: string
    }) => {
      // Raw-input policy refusal (corpus contract): empty transcript is
      // rejected before the machine runs — never for extraction failure.
      if (input.transcript.length === 0) {
        return { _tag: "Rejected" as const, reason: "transcript is empty" }
      }
      const existing = await Effect.runPromise(entries.timeline(CORPUS_CHILD_ID))
      const prior = existing.find((entry) => entry.captureId === input.captureId)
      if (prior !== undefined) {
        // Idempotency key: same captureId is a replay — return the existing
        // entry, persist nothing new. Conflicting raw text is refused.
        if (prior.rawTranscript === input.transcript) {
          return { _tag: "IdempotentReplay" as const, entry: toWire(prior) }
        }
        return { _tag: "Rejected" as const, reason: `capture ${input.captureId} already exists with different raw text` }
      }
      await runPipeline(input)
      const after = await Effect.runPromise(entries.timeline(CORPUS_CHILD_ID))
      const created = after.find((entry) => entry.captureId === input.captureId)
      if (created === undefined) {
        // The machine parked (store failure) — surface as refusal while the
        // raw text stays preserved in the machine's failure state.
        return { _tag: "Rejected" as const, reason: "capture pipeline failed to persist raw draft" }
      }
      return { _tag: "Created" as const, entry: toWire(created) }
    },
    readTimeline: async () => {
      const all = await Effect.runPromise(entries.timeline(CORPUS_CHILD_ID))
      return all.map(toWire)
    },
    reload: async () => {
      await Effect.runPromise(entries.reloadFromLog())
    },
  }
}
