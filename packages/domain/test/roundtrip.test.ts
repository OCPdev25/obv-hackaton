import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import {
  CaptureId,
  CreateChildInput,
  CreateEntryInput,
  CreateEntryOutput,
  CreateHouseholdInput,
  EntrySchema,
  EventSchema,
  ExtractionRequest,
  ExtractionResult,
  ListEntriesByChildInput,
  ListEntriesByChildOutput,
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
    // CaptureId is branded at the type level (v0.3) — widen for the runtime
    // equality check; the wire value is unchanged.
    expect(request.captureId as string).toBe("capture-abc-123")

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

    const authorId = createEntry.authorId as { kind: string; isOptional: string }
    expect(authorId.kind).toBe("string")
    expect(authorId.isOptional).toBe("required")

    // captureId is optional on the wire: manual entries have no capture session.
    const captureId = createEntry.captureId as { kind: string; isOptional: string }
    expect(captureId.kind).toBe("string")
    expect(captureId.isOptional).toBe("optional")

    const photoId = createEntry.photoId as { kind: string; isOptional: string }
    expect(photoId.kind).toBe("string")
    expect(photoId.isOptional).toBe("optional")

    const listArgs = convexFields(ListEntriesByChildInput)
    const limit = listArgs.limit as { kind: string; isOptional: string }
    expect(limit.kind).toBe("float64")
    expect(limit.isOptional).toBe("optional")
  })

  test("derives validators for the create outputs and child/household inputs", () => {
    const entryOutput = convexFields(CreateEntryOutput)
    const entryId = entryOutput.entryId as { kind: string; tableName: string }
    expect(entryId.kind).toBe("id")
    expect(entryId.tableName).toBe("entries")
    const status = entryOutput.status as { kind: string; members: unknown[] }
    expect(status.kind).toBe("union")
    expect(status.members).toHaveLength(2)

    const childInput = convexFields(CreateChildInput)
    const householdId = childInput.householdId as { kind: string; tableName: string }
    expect(householdId.kind).toBe("id")
    expect(householdId.tableName).toBe("households")
    const birthDate = childInput.birthDate as { kind: string; isOptional: string }
    expect(birthDate.kind).toBe("float64")
    expect(birthDate.isOptional).toBe("optional")

    const householdInput = convexFields(CreateHouseholdInput)
    expect((householdInput.name as { kind: string }).kind).toBe("string")
  })

  test("Entry decode treats captureId as optional and rejects an empty one", () => {
    const base = {
      householdId: "jd7civil0000000000000000",
      childId: "jd7cchild00000000000000000",
      authorId: "caregiver-1",
      rawTranscript: "She napped 45 minutes after lunch.",
      structuredEventIds: [],
      extractionStatus: "pending",
      visibility: "draft",
      createdAt: 1758136800000,
    }
    const without = Schema.decodeUnknownSync(EntrySchema)(base)
    expect(without.captureId).toBeUndefined()

    const withCapture = Schema.decodeUnknownSync(EntrySchema)({ ...base, captureId: "cap-001" })
    expect(withCapture.captureId).toBe(Schema.decodeUnknownSync(CaptureId)("cap-001"))

    expect(() => Schema.decodeUnknownSync(EntrySchema)({ ...base, captureId: "" })).toThrow()
  })

  test("timeline read boundary: stored rows decode to contract output, system fields stripped", () => {
    const row = {
      _id: "jd7centry00000000000000000",
      _creationTime: 1758136800000,
      householdId: "jd7civil0000000000000000",
      childId: "jd7cchild00000000000000000",
      authorId: "caregiver-1",
      rawTranscript: "She napped 45 minutes after lunch.",
      structuredEventIds: [],
      extractionStatus: "pending",
      visibility: "draft",
      captureId: "cap-001",
      createdAt: 1758136800000,
    }
    const decoded = Schema.decodeUnknownSync(ListEntriesByChildOutput)([row])
    expect(decoded).toHaveLength(1)
    expect(decoded[0]).toEqual({
      householdId: "jd7civil0000000000000000",
      childId: "jd7cchild00000000000000000",
      authorId: "caregiver-1",
      rawTranscript: "She napped 45 minutes after lunch.",
      structuredEventIds: [],
      extractionStatus: "pending",
      visibility: "draft",
      captureId: Schema.decodeUnknownSync(CaptureId)("cap-001"),
      createdAt: 1758136800000,
    })
    expect(JSON.stringify(decoded[0])).not.toContain("_id")
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
