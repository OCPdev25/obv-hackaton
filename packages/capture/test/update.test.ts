import { describe, expect, it } from "vitest"

import {
  CaptureId,
  CaregiverId,
  ChildId,
  EntryId,
  fixtureCaregiverAna,
  fixtureChild,
} from "@journal/domain"

import { update, initialCaptureState } from "../src/update.js"

// Brand casts are safe here: fixture ids are already validated at import time.
const childId = fixtureChild.childId as ChildId
const ana = fixtureCaregiverAna.caregiverId as CaregiverId
const captureId = "capture_test_001" as CaptureId
const entryId = "entry_test_001" as EntryId

const domainEvent = {
  _tag: "Event",
  category: "potty",
  occurredAt: new Date(1726500000000),
  confidence: 0.8,
  authorId: ana,
  note: "Mila used the potty.",
} as const

const recording = { _tag: "Recording", captureId, childId, authorId: ana } as const
const transcribed = {
  _tag: "Transcribed",
  captureId,
  childId,
  authorId: ana,
  rawTranscript: "Mila used the potty.",
} as const
const extracting = { ...transcribed, _tag: "Extracting" } as const
const review = {
  _tag: "Review",
  captureId,
  childId,
  authorId: ana,
  rawTranscript: "Mila used the potty.",
  events: [domainEvent],
} as const
const published = { _tag: "Published", captureId, entryId } as const

describe("capture update", () => {
  it("Idle + CaptureStarted → Recording", () => {
    const [state, commands] = update(initialCaptureState, {
      _tag: "CaptureStarted",
      captureId,
      childId,
      authorId: ana,
    })
    expect(state._tag).toBe("Recording")
    expect(commands).toHaveLength(0)
  })

  it("Recording + CompletedTranscription keeps transcript verbatim", () => {
    const raw = "Mila said  'first time'  by herself!!!   "
    const [state, commands] = update(recording, { _tag: "CompletedTranscription", captureId, transcript: raw })
    expect(state._tag).toBe("Transcribed")
    expect(state._tag === "Transcribed" && state.rawTranscript).toBe(raw)
    expect(commands).toHaveLength(0)
  })

  it("Transcribed + SubmittedForExtraction → Extracting + ExtractEvents command", () => {
    const [state, commands] = update(transcribed, { _tag: "SubmittedForExtraction", captureId })
    expect(state._tag).toBe("Extracting")
    expect(commands).toEqual([
      {
        _tag: "ExtractEvents",
        captureId,
        childId,
        authorId: ana,
        transcript: "Mila used the potty.",
      },
    ])
  })

  it("Extracting + SucceededExtraction → Review with validated events", () => {
    const [state, commands] = update(extracting, {
      _tag: "SucceededExtraction",
      captureId,
      events: [domainEvent],
    })
    expect(state._tag).toBe("Review")
    expect(state._tag === "Review" && state.events).toEqual([domainEvent])
    expect(commands).toHaveLength(0)
  })

  it("validation failure: Extracting + FailedExtraction → Transcribed with raw input intact", () => {
    const [state, commands] = update(extracting, {
      _tag: "FailedExtraction",
      captureId,
      reason: "confidence 1.5 out of range",
    })
    expect(state._tag).toBe("Transcribed")
    expect(state._tag === "Transcribed" && state.rawTranscript).toBe(transcribed.rawTranscript)
    expect(state._tag === "Transcribed" && state.captureId).toBe(captureId)
    expect(commands).toHaveLength(0)
  })

  it("Review + ConfirmedReview keeps state and returns PublishEntry with stable captureId", () => {
    const at = new Date(1726500010000)
    const [state, commands] = update(review, { _tag: "ConfirmedReview", captureId, at })
    expect(state._tag).toBe("Review")
    expect(commands).toEqual([
      {
        _tag: "PublishEntry",
        captureId,
        childId,
        authorId: ana,
        transcript: "Mila used the potty.",
        createdAt: at,
        events: [domainEvent],
      },
    ])
  })

  it("Review + FailedPublish stays Review (publish retryable, raw intact)", () => {
    const [state, commands] = update(review, { _tag: "FailedPublish", captureId, reason: "network down" })
    expect(state._tag).toBe("Review")
    expect(commands).toHaveLength(0)
  })

  it("Review + PublishedEntry → Published", () => {
    const [state, commands] = update(review, { _tag: "PublishedEntry", captureId, entryId })
    expect(state).toEqual(published)
    expect(commands).toHaveLength(0)
  })

  it("stale results are ignored: old captureId cannot mutate a newer capture", () => {
    const staleId = "capture_old_000" as CaptureId
    const [state, commands] = update(extracting, {
      _tag: "SucceededExtraction",
      captureId: staleId,
      events: [domainEvent],
    })
    expect(state._tag).toBe("Extracting")
    expect(commands).toHaveLength(0)
  })

  it("Published is terminal: no message mutates it", () => {
    for (const message of [
      { _tag: "FailedExtraction", captureId, reason: "late failure" },
      { _tag: "FailedPublish", captureId, reason: "late failure" },
      { _tag: "PublishedEntry", captureId, entryId: "entry_other" as EntryId },
      { _tag: "CancelledCapture", captureId },
    ] as const) {
      const [state, commands] = update(published, message)
      expect(state._tag).toBe("Published")
      expect(commands).toHaveLength(0)
    }
  })

  it("CancelledCapture returns to Idle from every active state", () => {
    for (const state of [recording, transcribed, extracting, review]) {
      const [next, commands] = update(state, { _tag: "CancelledCapture", captureId })
      expect(next._tag).toBe("Idle")
      expect(commands).toHaveLength(0)
    }
  })
})
