import { Result, Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  CaptureMessage,
  CaptureState,
  Entry,
  decodeEntryResult,
  decodeEntrySync,
  decodeEventResult,
  encodeEntry,
  fixtureCaregivers,
  fixtureChild,
} from "../src/index.js"

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

const isState = Schema.is(CaptureState)
const isMessage = Schema.is(CaptureMessage)

// Domain-side Event (Date fields) for `Schema.is` acceptance checks.
const domainEvent = {
  _tag: "Event",
  category: "potty",
  occurredAt: new Date(1726500000000),
  confidence: 0.9,
  authorId: "caregiver_ana",
} as const

const wireEvent = {
  _tag: "Event",
  category: "potty",
  occurredAt: 1726500000000,
  confidence: 0.9,
  authorId: "caregiver_ana",
}

const wireEntry = {
  _tag: "Entry",
  captureId: "capture_01TEST",
  childId: "child_mila",
  transcript: "Mila used the potty before lunch and was very proud.",
  authorId: "caregiver_ana",
  createdAt: 1726500000000,
  status: "published",
  events: [wireEvent],
}

describe("Entry contract", () => {
  it("decodes a wire entry: millis → Date", () => {
    const entry = decodeEntrySync(clone(wireEntry))
    expect(entry.createdAt).toBeInstanceOf(Date)
    expect(entry.createdAt.getTime()).toBe(1726500000000)
    expect(entry.transcript).toBe(wireEntry.transcript)
    expect(entry.captureId).toBe("capture_01TEST")
  })

  it("encodes back to wire: Date → millis, absent entryId stays absent", () => {
    const entry = decodeEntrySync(clone(wireEntry))
    const wire = encodeEntry(entry)
    expect(wire).toEqual(wireEntry)
    expect("entryId" in wire).toBe(false)
  })

  it("rejects an invalid category", () => {
    const bad = { ...clone(wireEntry), events: [{ ...wireEvent, category: "homework" }] }
    const result = decodeEntryResult(bad)
    expect(Result.isSuccess(result)).toBe(false)
  })

  it("rejects out-of-range confidence", () => {
    const bad = { ...clone(wireEntry), events: [{ ...wireEvent, confidence: 1.5 }] }
    expect(Result.isSuccess(decodeEntryResult(bad))).toBe(false)
  })

  it("rejects an empty transcript", () => {
    const bad = { ...clone(wireEntry), transcript: "" }
    expect(Result.isSuccess(decodeEntryResult(bad))).toBe(false)
  })

  it("rejects a missing _tag", () => {
    const bad = { ...clone(wireEntry) } as Record<string, unknown>
    delete bad._tag
    expect(Result.isSuccess(decodeEntryResult(bad))).toBe(false)
  })

  it("preserves raw transcript byte-for-byte through decode/encode", () => {
    const raw = "Mila said  'first time'  by herself!!!   "
    const entry = decodeEntrySync({
      ...clone(wireEntry),
      transcript: raw,
    })
    expect(encodeEntry(entry).transcript).toBe(raw)
  })
})

describe("Event contract", () => {
  it("decodes quantity and optional note", () => {
    const result = decodeEventResult({
      ...wireEvent,
      quantity: { value: 15, unit: "minutes" },
      note: "fell asleep fast",
    })
    expect(Result.isSuccess(result)).toBe(true)
  })
})

describe("Capture state machine schemas", () => {
  const states = [
    { _tag: "Idle" },
    {
      _tag: "Recording",
      captureId: "capture_01TEST",
      childId: "child_mila",
      authorId: "caregiver_ana",
    },
    {
      _tag: "Transcribed",
      captureId: "capture_01TEST",
      childId: "child_mila",
      authorId: "caregiver_ana",
      rawTranscript: "hello",
    },
    {
      _tag: "Extracting",
      captureId: "capture_01TEST",
      childId: "child_mila",
      authorId: "caregiver_ana",
      rawTranscript: "hello",
    },
    {
      _tag: "Review",
      captureId: "capture_01TEST",
      childId: "child_mila",
      authorId: "caregiver_ana",
      rawTranscript: "hello",
      events: [domainEvent],
    },
    { _tag: "Published", captureId: "capture_01TEST", entryId: "entry_01TEST" },
  ]

  it.each(states)("accepts state $_tag", (state) => {
    expect(isState(state)).toBe(true)
  })

  const messages = [
    {
      _tag: "CaptureStarted",
      captureId: "capture_01TEST",
      childId: "child_mila",
      authorId: "caregiver_ana",
    },
    { _tag: "CompletedTranscription", captureId: "capture_01TEST", transcript: "hello" },
    { _tag: "SubmittedForExtraction", captureId: "capture_01TEST" },
    { _tag: "SucceededExtraction", captureId: "capture_01TEST", events: [domainEvent] },
    { _tag: "FailedExtraction", captureId: "capture_01TEST", reason: "bad output" },
    { _tag: "ConfirmedReview", captureId: "capture_01TEST", at: new Date(1726500000000) },
    { _tag: "PublishedEntry", captureId: "capture_01TEST", entryId: "entry_01TEST" },
    { _tag: "FailedPublish", captureId: "capture_01TEST", reason: "network down" },
    { _tag: "CancelledCapture", captureId: "capture_01TEST" },
  ]

  it.each(messages)("accepts message $_tag", (message) => {
    expect(isMessage(message)).toBe(true)
  })
})

describe("Fixtures", () => {
  it("provide one child and two caregivers", () => {
    expect(fixtureChild.childId).toBe("child_mila")
    expect(fixtureCaregivers).toHaveLength(2)
  })
})

describe("Entry schema is executable", () => {
  it("is registered as the Entry tag", () => {
    expect(Entry).toBeDefined()
  })
})
