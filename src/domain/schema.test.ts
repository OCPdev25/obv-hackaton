import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { Entry, Event, PublishOutput, TimelineRow, decodeFailureMessage } from "./schema.js"

const caregiverId = "caregiver-maya"

const validEvent = {
  _tag: "Event",
  category: "milestone",
  occurredAt: 1758100000000,
  confidence: 0.9,
  authorId: caregiverId,
  note: "first word",
}

const validEntry = {
  _tag: "Entry",
  captureId: "cap-abc-123",
  childId: "child-ada",
  transcript: "milestone: Ada said mama",
  authorId: caregiverId,
  createdAt: 1758100000000,
  status: "published",
  events: [validEvent],
}

const decodeError = (schema: typeof Entry | typeof Event, value: unknown): string => {
  const result = Schema.decodeUnknownResult(schema)(value)
  if (result._tag === "Failure") return String(result.failure)
  throw new Error(`expected ${JSON.stringify(value)} to be rejected`)
}

describe("Event schema (domain authority)", () => {
  it("decodes a valid wire event, materializing Date from unix ms", () => {
    const event = Schema.decodeUnknownSync(Event)(validEvent)
    expect(event.occurredAt).toBeInstanceOf(Date)
    expect(event.occurredAt.getTime()).toBe(1758100000000)
    expect(event.category).toBe("milestone")
  })

  it("rejects an unknown category, naming the field and the valid set", () => {
    const message = decodeError(Event, { ...validEvent, category: "naptime" })
    expect(message).toContain("category")
    expect(message).toContain("milestone")
  })

  it("rejects confidence outside [0, 1]", () => {
    expect(decodeError(Event, { ...validEvent, confidence: 1.5 })).toContain("between 0 and 1")
    expect(decodeError(Event, { ...validEvent, confidence: -0.1 })).toContain("between 0 and 1")
  })

  it("rejects a missing or wrong tag", () => {
    const { _tag, ...untagged } = validEvent
    expect(decodeError(Event, untagged)).toBeDefined()
    expect(decodeError(Event, { ...validEvent, _tag: "SomethingElse" })).toBeDefined()
  })
})

describe("Entry schema (domain authority)", () => {
  it("decodes a valid wire entry", () => {
    const entry = Schema.decodeUnknownSync(Entry)(validEntry)
    expect(entry.captureId).toBe("cap-abc-123")
    expect(entry.createdAt).toBeInstanceOf(Date)
  })

  it("rejects an empty transcript", () => {
    expect(decodeError(Entry, { ...validEntry, transcript: "" })).toBeDefined()
  })

  it("round-trips: encoding strips absent optionals and converts Dates to ms numbers", () => {
    const entry = Schema.decodeUnknownSync(Entry)(validEntry)
    const wire = Schema.encodeSync(Entry)(entry) as Record<string, unknown>
    expect(wire.createdAt).toBe(1758100000000)
    // present note survives the round-trip
    const events = wire.events as Array<Record<string, unknown>>
    expect(events[0]!.note).toBe("first word")
    // an ABSENT optional key must not reappear as an explicit undefined
    // (Convex documents reject undefined values)
    const { note: _omitted, ...noNoteEvent } = validEvent
    const noNote = Schema.decodeUnknownSync(Entry)({ ...validEntry, events: [noNoteEvent] })
    const noNoteWire = Schema.encodeSync(Entry)(noNote) as Record<string, unknown>
    const noNoteEvents = noNoteWire.events as Array<Record<string, unknown>>
    expect(Object.hasOwn(noNoteEvents[0]!, "note")).toBe(false)
    expect("note" in noNoteEvents[0]!).toBe(false)
  })
})

describe("output contracts", () => {
  it("PublishOutput decodes a publish result", () => {
    const out = Schema.decodeUnknownSync(PublishOutput)({ recordId: "rec-1", duplicate: false, eventCount: 1 })
    expect(out.duplicate).toBe(false)
  })

  it("TimelineRow decodes a query row into domain shape", () => {
    const row = Schema.decodeUnknownSync(TimelineRow)({
      recordId: "rec-1",
      captureId: "cap-abc-123",
      transcript: "milestone: Ada said mama",
      authorId: caregiverId,
      authorName: "Maya",
      status: "published",
      createdAt: 1758100000000,
      events: [validEvent],
    })
    expect(row.authorName).toBe("Maya")
    expect(row.events[0]!.occurredAt).toBeInstanceOf(Date)
  })

  it("decodeFailureMessage extracts a flat message for display", () => {
    const result = Schema.decodeUnknownResult(Event)({ ...validEvent, confidence: 2 })
    if (result._tag !== "Failure") throw new Error("expected failure")
    expect(decodeFailureMessage(result.failure)).toContain("between 0 and 1")
  })
})
