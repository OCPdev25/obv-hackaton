import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import type { CaptureId } from "@journal/domain"
import { fixtureCaregiverAna, fixtureChild } from "@journal/domain"

import { makeCaptureLoop } from "../src/runtime.js"
import type { ExtractionServiceShape } from "../src/services/extraction.js"
import { makeDeterministicExtractor, makeFaultyExtractor } from "../src/services/extraction.js"
import { makeInMemoryEntryStore } from "../src/services/entries.js"

const ana = fixtureCaregiverAna.caregiverId
const childId = fixtureChild.childId
const FIXED_NOW = 1726500000000

const services = () => ({
  extraction: makeDeterministicExtractor(() => FIXED_NOW),
  store: makeInMemoryEntryStore(),
})

const RAW = "Mila used the potty today. She napped for 90 minutes."
const captureId = "capture_loop_001" as CaptureId
const captureId2 = "capture_loop_002" as CaptureId

describe("capture loop (update + command execution, local-real services)", () => {
  it("drives Idle→…→Published and persists exactly one entry, raw transcript verbatim", async () => {
    const services_ = services()
    const states: string[] = []
    const loop = makeCaptureLoop(services_, (state) => states.push(state._tag))

    await loop.dispatch({ _tag: "CaptureStarted", captureId, childId, authorId: ana })
    await loop.dispatch({ _tag: "CompletedTranscription", captureId, transcript: RAW })
    await loop.dispatch({ _tag: "SubmittedForExtraction", captureId })

    expect(loop.state()._tag).toBe("Review")
    expect(states).toEqual(["Recording", "Transcribed", "Extracting", "Review"])

    // Reviewer confirms AFTER seeing extracted events (no auto-publish).
    await loop.dispatch({ _tag: "ConfirmedReview", captureId, at: new Date(FIXED_NOW + 60_000) })
    expect(loop.state()._tag).toBe("Published")

    const timeline = await Effect.runPromise(Effect.orDie(services_.store.timeline(childId)))
    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.transcript).toBe(RAW)
    expect(timeline[0]?.events.map((e) => e.category).sort()).toEqual(["potty", "sleep"])
    expect(timeline[0]?.entryId).toBeDefined()
  })

  it("retry after extraction failure loses neither raw input nor idempotency", async () => {
    const store = makeInMemoryEntryStore()
    // Provider is misbehaving on the first attempt, recovered on the retry —
    // same service interface, same captureId, same raw transcript.
    let providerHealthy = false
    const extraction: ExtractionServiceShape = {
      extract: (input) =>
        providerHealthy
          ? makeDeterministicExtractor(() => FIXED_NOW).extract(input)
          : makeFaultyExtractor().extract(input),
    }
    const loop = makeCaptureLoop({ extraction, store }, () => {})

    await loop.dispatch({ _tag: "CaptureStarted", captureId, childId, authorId: ana })
    await loop.dispatch({ _tag: "CompletedTranscription", captureId, transcript: RAW })
    // First attempt: the faulty provider's output dies at the validation
    // boundary and the executor turns the failure into FailedExtraction.
    await loop.dispatch({ _tag: "SubmittedForExtraction", captureId })
    expect(loop.state()).toMatchObject({ _tag: "Transcribed", rawTranscript: RAW, captureId })

    // Same captureId → retry succeeds; publish stays idempotent even if
    // ConfirmedReview fires twice (e.g. double-tap).
    providerHealthy = true
    await loop.dispatch({ _tag: "SubmittedForExtraction", captureId })
    await loop.dispatch({ _tag: "ConfirmedReview", captureId, at: new Date(FIXED_NOW + 60_000) })
    await loop.dispatch({ _tag: "ConfirmedReview", captureId, at: new Date(FIXED_NOW + 61_000) })
    expect(loop.state()._tag).toBe("Published")

    const timeline = await Effect.runPromise(Effect.orDie(store.timeline(childId)))
    expect(timeline).toHaveLength(1)
  })

  it("stale late result after cancel cannot mutate the new capture", async () => {
    const services_ = services()
    const loop = makeCaptureLoop(services_, () => {})

    await loop.dispatch({ _tag: "CaptureStarted", captureId, childId, authorId: ana })
    await loop.dispatch({ _tag: "CompletedTranscription", captureId, transcript: RAW })
    await loop.dispatch({ _tag: "SubmittedForExtraction", captureId })
    await loop.dispatch({ _tag: "CancelledCapture", captureId })
    expect(loop.state()._tag).toBe("Idle")

    // A new capture starts; the OLD extraction result arrives late.
    await loop.dispatch({ _tag: "CaptureStarted", captureId: captureId2, childId, authorId: ana })
    await loop.dispatch({ _tag: "CompletedTranscription", captureId: captureId2, transcript: "Later note." })
    await loop.dispatch({ _tag: "SucceededExtraction", captureId, events: [] })

    expect(loop.state()).toMatchObject({ _tag: "Transcribed", rawTranscript: "Later note." })
  })
})
