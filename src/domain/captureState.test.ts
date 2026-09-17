import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { CaptureState, idleCaptureState, update } from "./captureState.js"
import { CaregiverId, CaptureId, ChildId, type Event } from "./schema.js"

const captureId = Schema.decodeSync(CaptureId)("cap-test-1")
const authorId = Schema.decodeSync(CaregiverId)("caregiver-maya")
const childId = Schema.decodeSync(ChildId)("child-ada")
const sampleEvent: Event = {
  _tag: "Event",
  category: "milestone",
  occurredAt: new Date(0),
  confidence: 1,
  authorId,
  note: "first word",
}

describe("pure capture state machine", () => {
  it("idle + captureStarted moves to recording with attribution", () => {
    const [next, commands] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    expect(next.status).toBe("recording")
    expect(commands).toEqual([])
    if (next.status === "recording") {
      expect(next.captureId).toBe(captureId)
      expect(next.authorId).toBe(authorId)
      expect(next.childId).toBe(childId)
    }
  })

  it("idle + textEntered is ignored (no capture in progress)", () => {
    const [next, commands] = update(idleCaptureState, { type: "textEntered", transcript: "stray input" })
    expect(next).toBe(idleCaptureState)
    expect(commands).toEqual([])
  })

  it("recording + textEntered → transcribed and asks for extraction", () => {
    const [recording] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    const [next, commands] = update(recording, { type: "textEntered", transcript: "milestone: first word" })
    expect(next.status).toBe("transcribed")
    if (next.status === "transcribed") {
      expect(next.transcript).toBe("milestone: first word")
      expect(commands).toEqual([
        { type: "extractEvents", captureId, authorId, transcript: "milestone: first word" },
      ])
    }
  })

  it("transcribed + extractionStarted → extracting", () => {
    const [recording] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    const [transcribed] = update(recording, { type: "textEntered", transcript: "milestone: first word" })
    const [next, commands] = update(transcribed, { type: "extractionStarted" })
    expect(next.status).toBe("extracting")
    expect(commands).toEqual([])
  })

  it("extracting + extractionSucceeded → review with decoded events", () => {
    const [recording] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    const [transcribed] = update(recording, { type: "textEntered", transcript: "milestone: first word" })
    const [extracting] = update(transcribed, { type: "extractionStarted" })
    const [next, commands] = update(extracting, { type: "extractionSucceeded", events: [sampleEvent] })
    expect(next.status).toBe("review")
    expect(commands).toEqual([])
    if (next.status === "review") {
      expect(next.events).toEqual([sampleEvent])
      expect(next.transcript).toBe("milestone: first word")
    }
  })

  it("extracting + extractionFailed → validationFailed and the raw transcript is PRESERVED", () => {
    const [recording] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    const [transcribed] = update(recording, { type: "textEntered", transcript: "gibberish without a rule" })
    const [extracting] = update(transcribed, { type: "extractionStarted" })
    const [next, commands] = update(extracting, { type: "extractionFailed", reason: "unclassifiable transcript" })
    expect(next.status).toBe("validationFailed")
    expect(commands).toEqual([])
    if (next.status === "validationFailed") {
      expect(next.transcript).toBe("gibberish without a rule")
      expect(next.reason).toBe("unclassifiable transcript")
    }
  })

  it("validationFailed + retryRequested re-extracts from the PRESERVED transcript (no re-entry)", () => {
    const [recording] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    const [transcribed] = update(recording, { type: "textEntered", transcript: "meal: oats and banana" })
    const [extracting] = update(transcribed, { type: "extractionStarted" })
    const [failed] = update(extracting, { type: "extractionFailed", reason: "transient" })
    const [retried, commands] = update(failed, { type: "retryRequested" })
    expect(retried.status).toBe("extracting")
    if (retried.status === "extracting") {
      expect(retried.transcript).toBe("meal: oats and banana")
      expect(commands).toEqual([
        { type: "extractEvents", captureId, authorId, transcript: "meal: oats and banana" },
      ])
    }
  })

  it("review + publishRequested → publishing and asks for persistence", () => {
    const [recording] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    const [transcribed] = update(recording, { type: "textEntered", transcript: "milestone: first word" })
    const [extracting] = update(transcribed, { type: "extractionStarted" })
    const [review] = update(extracting, { type: "extractionSucceeded", events: [sampleEvent] })
    const [next, commands] = update(review, { type: "publishRequested" })
    expect(next.status).toBe("publishing")
    if (next.status === "publishing") {
      expect(commands).toEqual([
        { type: "persistCapture", captureId, childId, authorId, transcript: "milestone: first word", events: [sampleEvent] },
      ])
    }
  })

  it("publishing + persistSucceeded → published with the record id", () => {
    const [recording] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    const [transcribed] = update(recording, { type: "textEntered", transcript: "milestone: first word" })
    const [extracting] = update(transcribed, { type: "extractionStarted" })
    const [review] = update(extracting, { type: "extractionSucceeded", events: [sampleEvent] })
    const [publishing] = update(review, { type: "publishRequested" })
    const [next, commands] = update(publishing, { type: "persistSucceeded", recordId: "convex-record-1" })
    expect(next.status).toBe("published")
    expect(commands).toEqual([])
    if (next.status === "published") {
      expect(next.recordId).toBe("convex-record-1")
    }
  })

  it("publishing + persistFailed → persistFailed with the raw transcript intact", () => {
    const [recording] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    const [transcribed] = update(recording, { type: "textEntered", transcript: "sleep: down at 19:30" })
    const [extracting] = update(transcribed, { type: "extractionStarted" })
    const [review] = update(extracting, { type: "extractionSucceeded", events: [{ ...sampleEvent, category: "sleep" }] })
    const [publishing] = update(review, { type: "publishRequested" })
    const [next, commands] = update(publishing, { type: "persistFailed", reason: "network down" })
    expect(next.status).toBe("persistFailed")
    expect(commands).toEqual([])
    if (next.status === "persistFailed") {
      expect(next.transcript).toBe("sleep: down at 19:30")
      expect(next.reason).toBe("network down")
    }
  })

  it("persistFailed + retryRequested re-publishes with the SAME captureId", () => {
    const [recording] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    const [transcribed] = update(recording, { type: "textEntered", transcript: "sleep: down at 19:30" })
    const [extracting] = update(transcribed, { type: "extractionStarted" })
    const [review] = update(extracting, { type: "extractionSucceeded", events: [{ ...sampleEvent, category: "sleep" }] })
    const [publishing] = update(review, { type: "publishRequested" })
    const [failed] = update(publishing, { type: "persistFailed", reason: "network down" })
    const [retried, commands] = update(failed, { type: "retryRequested" })
    expect(retried.status).toBe("publishing")
    if (retried.status === "publishing") {
      expect(retried.captureId).toBe(captureId)
      expect(commands).toEqual([
        { type: "persistCapture", captureId, childId, authorId, transcript: "sleep: down at 19:30", events: [{ ...sampleEvent, category: "sleep" }] },
      ])
    }
  })

  it("published is terminal: captureStarted does not restart the flow", () => {
    const [recording] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    const [transcribed] = update(recording, { type: "textEntered", transcript: "mood: happy" })
    const [extracting] = update(transcribed, { type: "extractionStarted" })
    const [review] = update(extracting, { type: "extractionSucceeded", events: [{ ...sampleEvent, category: "mood" }] })
    const [publishing] = update(review, { type: "publishRequested" })
    const [published] = update(publishing, { type: "persistSucceeded", recordId: "rec-1" })
    const [next, commands] = update(published, { type: "captureStarted", captureId, authorId, childId })
    expect(next).toBe(published)
    expect(commands).toEqual([])
  })

  it("every state survives an encode → decode round-trip through its own schema", () => {
    const [recording] = update(idleCaptureState, { type: "captureStarted", captureId, authorId, childId })
    const [transcribed] = update(recording, { type: "textEntered", transcript: "meal: oats" })
    const [extracting] = update(transcribed, { type: "extractionStarted" })
    const [failed] = update(extracting, { type: "extractionFailed", reason: "schema mismatch" })
    const states: CaptureState[] = [idleCaptureState, recording, transcribed, failed]
    for (const state of states) {
      const wire = Schema.encodeSync(CaptureState)(state)
      const back = Schema.decodeUnknownSync(CaptureState)(wire)
      expect(back).toEqual(state)
    }
  })
})
