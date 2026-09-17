import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import {
  CreateEntryInput,
  EntrySchema,
  EventSchema,
  ExtractionRequest,
  ExtractionResult,
  ListEntriesByChildInput,
  toolSchemaFor,
} from "../src/index.js"
import { convexFields } from "../src/convexAdapter.js"

/**
 * Contract round-trip tests. These are the repo's first tests: they pin the
 * Effect v4 schema behavior AND the Effect -> Convex validator adapter
 * against the exact shapes verified for effect@4.0.0-rc.115 and convex 1.46.
 */

const eventFromTranscript = {
  householdId: "jd7civil0000000000000000",
  childId: "jd7cchild00000000000000000",
  category: "sleep",
  timestamp: 1758136800000,
  payload: { minutes: 45 },
  confidence: 0.92,
} satisfies Record<string, unknown>

describe("Effect schema contracts", () => {
  test("representative round trip: transcript-derived Event decodes, encodes, re-decodes", () => {
    const decoded = Schema.decodeUnknownSync(EventSchema)(eventFromTranscript)
    expect(decoded.category).toBe("sleep")
    expect(decoded.payload?.minutes).toBe(45)

    const encoded = Schema.encodeSync(EventSchema)(decoded)
    const redecoded = Schema.decodeUnknownSync(EventSchema)(encoded)
    expect(redecoded).toEqual(decoded)
  })

  test("rejects invalid category with a typed schema error", () => {
    const bad = { ...eventFromTranscript, category: "nap" }
    expect(() => Schema.decodeUnknownSync(EventSchema)(bad)).toThrow()
  })

  test("rejects out-of-range confidence (filter checks stay active)", () => {
    const bad = { ...eventFromTranscript, confidence: 1.5 }
    expect(() => Schema.decodeUnknownSync(EventSchema)(bad)).toThrow()
    const nan = { ...eventFromTranscript, confidence: Number.NaN }
    expect(() => Schema.decodeUnknownSync(EventSchema)(nan)).toThrow()
  })

  test("rejects empty raw transcripts on Entry", () => {
    const bad = {
      householdId: "jd7civil0000000000000000",
      childId: "jd7cchild00000000000000000",
      authorId: "caregiver-1",
      rawTranscript: "",
      structuredEventIds: [],
      extractionStatus: "pending",
      visibility: "draft",
      createdAt: 1758136800000,
    }
    expect(() => Schema.decodeUnknownSync(EntrySchema)(bad)).toThrow()
  })

  test("Entry decodes with visibility and rejects fused status/audience values", () => {
    const entry = {
      householdId: "jd7civil0000000000000000",
      childId: "jd7cchild00000000000000000",
      authorId: "caregiver-1",
      rawTranscript: "She napped 45 minutes after lunch.",
      structuredEventIds: [],
      extractionStatus: "pending",
      visibility: "draft",
      createdAt: 1758136800000,
    }
    const decoded = Schema.decodeUnknownSync(EntrySchema)(entry)
    expect(decoded.visibility).toBe("draft")

    // Audience is NOT part of the per-entry state — a fused status/audience
    // enum value like "published:household" must be rejected.
    const fused = { ...entry, visibility: "published:household" }
    expect(() => Schema.decodeUnknownSync(EntrySchema)(fused)).toThrow()
  })

  test("extraction envelope decodes requests and results carrying captureId/attempt", () => {
    const request = Schema.decodeUnknownSync(ExtractionRequest)({
      captureId: "capture-abc-123",
      attempt: 0,
      transcript: "He ate all of his dinner.",
    })
    expect(request.captureId).toBe("capture-abc-123")

    const result = Schema.decodeUnknownSync(ExtractionResult)({
      captureId: "capture-abc-123",
      attempt: 2,
      events: [],
    })
    expect(result.attempt).toBe(2)

    const emptyCapture = { ...request, captureId: "" }
    expect(() => Schema.decodeUnknownSync(ExtractionRequest)(emptyCapture)).toThrow()
  })
})

describe("Effect -> Convex validator adapter", () => {
  test("derives Convex validators for the Event table", () => {
    const fields = convexFields(EventSchema)

    const householdId = fields.householdId as { kind: string; tableName: string }
    expect(householdId.kind).toBe("id")
    expect(householdId.tableName).toBe("households")

    const childId = fields.childId as { kind: string; tableName: string }
    expect(childId.kind).toBe("id")
    expect(childId.tableName).toBe("children")

    const category = fields.category as { kind: string; members: Array<{ kind: string }> }
    expect(category.kind).toBe("union")
    expect(category.members).toHaveLength(6)
    for (const member of category.members) expect(member.kind).toBe("literal")

    const timestamp = fields.timestamp as { kind: string; isOptional: string }
    expect(timestamp.kind).toBe("float64")
    expect(timestamp.isOptional).toBe("required")

    const payload = fields.payload as { kind: string; isOptional: string }
    expect(payload.kind).toBe("record")
    expect(payload.isOptional).toBe("optional")

    const confidence = fields.confidence as { kind: string }
    expect(confidence.kind).toBe("float64")
  })

  test("derives Convex validators for the Entry table including arrays of ids", () => {
    const fields = convexFields(EntrySchema)

    const structuredEventIds = fields.structuredEventIds as {
      kind: string
      element: { kind: string; tableName: string }
    }
    expect(structuredEventIds.kind).toBe("array")
    expect(structuredEventIds.element.kind).toBe("id")
    expect(structuredEventIds.element.tableName).toBe("events")

    const extractionStatus = fields.extractionStatus as { kind: string; members: unknown[] }
    expect(extractionStatus.kind).toBe("union")
    expect(extractionStatus.members).toHaveLength(3)

    const photoId = fields.photoId as { kind: string; isOptional: string }
    expect(photoId.kind).toBe("string")
    expect(photoId.isOptional).toBe("optional")
  })

  test("derives function-args validators from operation contracts", () => {
    const createEntry = convexFields(CreateEntryInput)
    const childId = createEntry.childId as { kind: string; tableName: string }
    expect(childId.kind).toBe("id")
    expect(childId.tableName).toBe("children")

    const photoId = createEntry.photoId as { kind: string; isOptional: string }
    expect(photoId.isOptional).toBe("optional")

    const listArgs = convexFields(ListEntriesByChildInput)
    const limit = listArgs.limit as { kind: string; isOptional: string }
    expect(limit.kind).toBe("float64")
    expect(limit.isOptional).toBe("optional")
  })

  test("rejects schema vocabulary outside the supported subset", () => {
    const Unsupported = Schema.Struct({ when: Schema.DateFromMillis })
    expect(() => convexFields(Unsupported)).toThrow(/unsupported schema node/)
  })
})

describe("JSON Schema tool contracts", () => {
  test("derives a draft-2020-12 contract with the category enum", () => {
    const document = toolSchemaFor(EventSchema)
    const json = JSON.stringify(document)
    expect(json).toContain("2020-12")
    for (const category of ["potty", "meal", "sleep", "mood", "milestone", "school"]) {
      expect(json).toContain(`"${category}"`)
    }
  })
})
