import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import {
  CaptureId,
  ContextEnvelope,
  EntrySchema,
  EventSchema,
  ExtractionAttempt,
  ExtractionAttemptDocument,
  ExtractionOutcome,
  deriveExtractionStatus,
  toolSchemaFor,
} from "../src/index.js"
import type { ExtractionOutcome as Outcome } from "../src/index.js"
import { convexFields } from "../src/convexAdapter.js"

/**
 * Contract v0.3 fold tests (delta: art_bKoYFzs7). These pin the folded
 * additions — ContextEnvelope, operation outputs, extraction lineage,
 * Event.producedBy, Entry.attachments, branded captureId, derived extraction
 * status — to the wire rules the contract is held to: unix-ms dates, no
 * explicit nulls, no underscore-prefixed stored fields, brand-safe capture
 * ids.
 */

const attachment = {
  attachmentId: "att-1",
  kind: "audio",
  storageId: "storage-doc-1",
  sha256: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  bytes: 1024,
  mimeType: "audio/mp4",
} satisfies Record<string, unknown>

const envelope = {
  envelopeId: "env-1",
  captureId: "capture-abc-123",
  capturedAt: 1758136800000,
  capturedAtTimezone: {
    value: "America/New_York",
    source: "app-known",
    basis: "device settings at capture time",
  },
  utterance: "She napped 45 minutes after lunch.",
  actor: { authorId: "caregiver-1", role: "parent" },
  householdId: "jd7civil0000000000000000",
  currentChild: {
    value: { childId: "jd7cchild00000000000000000", displayName: "Sofia" },
    source: "user-asserted",
    basis: "child picker selection on capture screen",
  },
  attachments: [attachment],
  references: [
    {
      referenceId: "ref-1",
      kind: "entry",
      targetId: "jd7centry0000000000000000",
      source: "app-known",
      visibleToActor: true,
    },
  ],
} satisfies Record<string, unknown>

describe("ContextEnvelope (v0.3)", () => {
  test("decodes a full envelope and keeps every provenance value", () => {
    const decoded = Schema.decodeUnknownSync(ContextEnvelope)(envelope)
    expect(decoded.currentChild?.value.displayName).toBe("Sofia")
    expect(decoded.currentChild?.source).toBe("user-asserted")
    expect(decoded.attachments?.[0]?.kind).toBe("audio")
    expect(decoded.references?.[0]?.visibleToActor).toBe(true)
  })

  test("absent optionals stay unknown (absent keys, not null or undefined)", () => {
    // Destructure the keys OUT entirely — optionality means the key is ABSENT,
    // never present-with-null and never present-with-undefined.
    const { currentChild: _cc, attachments: _at, references: _rf, ...rest } = envelope
    const minimal = Schema.decodeUnknownSync(ContextEnvelope)(rest)
    expect("currentChild" in minimal).toBe(false)
    expect(minimal.currentChild).toBeUndefined()
    expect(minimal.attachments).toBeUndefined()
    expect(minimal.locale).toBeUndefined()
  })

  test("explicit undefined for optional keys is rejected like explicit null", () => {
    expect(() =>
      Schema.decodeUnknownSync(ContextEnvelope)({ ...envelope, currentChild: undefined })
    ).toThrow()
  })

  test("rejects explicit nulls (no-explicit-nulls wire pin)", () => {
    expect(() =>
      Schema.decodeUnknownSync(ContextEnvelope)({ ...envelope, currentChild: null })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ContextEnvelope)({ ...envelope, viewContext: null })
    ).toThrow()
  })

  test("wire dates are unix ms numbers, not Date objects", () => {
    expect(() =>
      Schema.decodeUnknownSync(ContextEnvelope)({ ...envelope, capturedAt: new Date(1758136800000) })
    ).toThrow()
  })

  test("utterance stays verbatim (no trimming or normalization on decode)", () => {
    const padded = Schema.decodeUnknownSync(ContextEnvelope)({
      ...envelope,
      utterance: "  she napped 45 minutes after lunch.  ",
    })
    expect(padded.utterance.startsWith(" ")).toBe(true)
    expect(padded.utterance.endsWith("  ")).toBe(true)
  })
})

describe("ExtractionOutcome closed union (v0.3)", () => {
  const candidate = {
    category: "sleep",
    occurredAtWindow: { from: 1758136800000, to: 1758140400000 },
    childId: "jd7cchild00000000000000000",
    authorId: "caregiver-1",
    confidence: 0.9,
    resolution: { child: "app-known", time: "user-asserted", quantity: "user-asserted" },
  }

  const factCandidates = {
    outcome: "fact-candidates",
    envelopeId: "env-1",
    candidates: [candidate],
  }
  const questionIntent = {
    outcome: "question-intent",
    envelopeId: "env-1",
    readScope: {
      householdId: "jd7civil0000000000000000",
      window: { from: 1758136800000, to: 1758223200000 },
    },
  }
  const writeProposal = {
    outcome: "write-proposal",
    proposalId: "prop-1",
    envelopeId: "env-1",
    proposalType: "correction",
    targetEventId: "jd7cevent0000000000000000",
    changes: { quantity: { value: 30, unit: "minutes" } },
    status: "proposed",
    proposalHash: "hash-1",
  }
  const unresolved = {
    outcome: "unresolved-reference",
    envelopeId: "env-1",
    reason: "target-not-visible",
  }

  test("discriminates all four members by the outcome literal", () => {
    const decode = (input: unknown) => Schema.decodeUnknownSync(ExtractionOutcome)(input)
    expect(decode(factCandidates).outcome).toBe("fact-candidates")
    expect(decode(questionIntent).outcome).toBe("question-intent")
    expect(decode(writeProposal).outcome).toBe("write-proposal")
    expect(decode(unresolved).outcome).toBe("unresolved-reference")
  })

  test("an unknown outcome literal is rejected (closed union)", () => {
    expect(() =>
      Schema.decodeUnknownSync(ExtractionOutcome)({ ...factCandidates, outcome: "auto-write" })
    ).toThrow()
  })

  test("question-intent carries read scope only — no candidate or write payload decodes", () => {
    const decoded = Schema.decodeUnknownSync(ExtractionOutcome)(questionIntent)
    if (decoded.outcome !== "question-intent") throw new Error("wrong member")
    expect("candidates" in decoded).toBe(false)
    expect("proposalId" in decoded).toBe(false)
    expect(decoded.readScope.childId).toBeUndefined()
  })

  test("confidence bounds and provenance-vocabulary checks stay active on candidates", () => {
    expect(() =>
      Schema.decodeUnknownSync(ExtractionOutcome)({
        ...factCandidates,
        candidates: [{ ...candidate, confidence: 1.5 }],
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ExtractionOutcome)({
        ...factCandidates,
        candidates: [{ ...candidate, resolution: { ...candidate.resolution, child: "guessed" } }],
      })
    ).toThrow()
  })

  test("a switch over the outcome literal is exhaustive (never-case typechecks)", () => {
    const describe = (o: Outcome): string => {
      switch (o.outcome) {
        case "fact-candidates":
          return `candidates:${o.candidates.length}`
        case "question-intent":
          return "question"
        case "write-proposal":
          return `proposal:${o.proposalType}:${o.status}`
        case "unresolved-reference":
          return `unresolved:${o.reason}`
        default: {
          const exhaustive: never = o
          return exhaustive
        }
      }
    }
    const decoded = Schema.decodeUnknownSync(ExtractionOutcome)(writeProposal)
    expect(describe(decoded)).toBe("proposal:correction:proposed")
  })
})

describe("Extraction lineage (v0.3)", () => {
  const running = {
    householdId: "jd7civil0000000000000000",
    captureId: "capture-abc-123",
    attempt: 0,
    startedAt: 1758136800000,
    extractorVersion: "stub-0.1.0",
    schemaVersion: "0.3.0",
    triggeredBy: "original",
    inputHash: "hash-input-1",
  } satisfies Record<string, unknown>

  test("a running attempt decodes with absent outcome and reads as pending", () => {
    const decoded = Schema.decodeUnknownSync(ExtractionAttempt)(running)
    expect(decoded.outcome).toBeUndefined()
    expect(decoded.finishedAt).toBeUndefined()
    expect(deriveExtractionStatus(decoded)).toBe("pending")
  })

  test("ExtractionAttempt is the lineage RECORD now — a bare attempt number no longer decodes", () => {
    expect(() => Schema.decodeUnknownSync(ExtractionAttempt)(2)).toThrow()
  })

  test("finished attempts carry outcome; failure payloads use the v0.2 pipeline taxonomy", () => {
    const failed = Schema.decodeUnknownSync(ExtractionAttempt)({
      ...running,
      attempt: 1,
      finishedAt: 1758136801000,
      outcome: "failed",
      failure: { error: "MalformedModelOutput", message: "expected array, got string" },
    })
    expect(deriveExtractionStatus(failed)).toBe("failed")

    const succeeded = Schema.decodeUnknownSync(ExtractionAttemptDocument)({
      ...running,
      attempt: 2,
      finishedAt: 1758136802000,
      outcome: "succeeded",
      _id: "jd7cextr00000000000000000",
      _creationTime: 1758136800000,
    })
    expect(deriveExtractionStatus(succeeded)).toBe("structured")
  })

  test("derived status: no attempt => pending, latest attempt decides", () => {
    expect(deriveExtractionStatus(undefined)).toBe("pending")
    expect(deriveExtractionStatus({ outcome: undefined })).toBe("pending")
  })

  test("unknown failure taxonomy values are rejected", () => {
    expect(() =>
      Schema.decodeUnknownSync(ExtractionAttempt)({
        ...running,
        outcome: "failed",
        failure: { error: "ModelSaidNo", message: "?" },
      })
    ).toThrow()
  })
})

describe("Event.producedBy and branded CaptureId (v0.3)", () => {
  const event = {
    householdId: "jd7civil0000000000000000",
    childId: "jd7cchild00000000000000000",
    category: "sleep",
    timestamp: 1758136800000,
    payload: { minutes: 45 },
    confidence: 0.92,
  } satisfies Record<string, unknown>

  test("events decode without producedBy (optionalKey) and reject explicit null", () => {
    expect(Schema.decodeUnknownSync(EventSchema)(event).producedBy).toBeUndefined()
    expect(() => Schema.decodeUnknownSync(EventSchema)({ ...event, producedBy: null })).toThrow()
  })

  test("producedBy round-trips: attemptId, extractor and schema versions survive encode", () => {
    const withProvenance = Schema.decodeUnknownSync(EventSchema)({
      ...event,
      producedBy: { attemptId: "jd7cextr00000000000000001", extractorVersion: "stub-0.1.0", schemaVersion: "0.3.0" },
    })
    expect(withProvenance.producedBy?.extractorVersion).toBe("stub-0.1.0")
    const encoded = Schema.encodeSync(EventSchema)(withProvenance)
    const redecoded = Schema.decodeUnknownSync(EventSchema)(encoded)
    expect(redecoded.producedBy).toEqual(withProvenance.producedBy)
  })

  test("branded CaptureId decodes, encodes, and round-trips identically to its string", () => {
    const decoded = Schema.decodeUnknownSync(CaptureId)("capture-abc-123")
    // Widen the branded type for the runtime equality check — wire value unchanged.
    expect(decoded as string).toBe("capture-abc-123")
    const encoded = Schema.encodeSync(CaptureId)(decoded)
    expect(encoded).toBe("capture-abc-123")
  })

  test("brands are type-level only: the adapter maps captureId to v.string(), not v.id()", () => {
    const fields = convexFields(ContextEnvelope)
    const captureId = fields.captureId as { kind: string }
    expect(captureId.kind).toBe("string")
  })

  test("empty capture ids are still rejected", () => {
    expect(() => Schema.decodeUnknownSync(CaptureId)("")).toThrow()
  })
})

describe("Entry.attachments (v0.3)", () => {
  const baseEntry = {
    householdId: "jd7civil0000000000000000",
    childId: "jd7cchild00000000000000000",
    authorId: "caregiver-1",
    rawTranscript: "She napped 45 minutes after lunch.",
    structuredEventIds: [],
    extractionStatus: "pending",
    visibility: "draft",
    createdAt: 1758136800000,
  } satisfies Record<string, unknown>

  test("entries decode with an attachments list using the shared Attachment shape", () => {
    const decoded = Schema.decodeUnknownSync(EntrySchema)({ ...baseEntry, attachments: [attachment] })
    expect(decoded.attachments?.[0]?.storageId).toBe("storage-doc-1")
  })

  test("photo and audio are the only attachment kinds", () => {
    expect(() =>
      Schema.decodeUnknownSync(EntrySchema)({ ...baseEntry, attachments: [{ ...attachment, kind: "video" }] })
    ).toThrow()
  })

  test("the photoId scalar still decodes — back-compat until its readers migrate", () => {
    const decoded = Schema.decodeUnknownSync(EntrySchema)({ ...baseEntry, photoId: "storage-doc-2" })
    expect(decoded.photoId).toBe("storage-doc-2")
    expect(decoded.attachments).toBeUndefined()
  })

  test("JSON Schema derivation still works for envelope-bearing tool contracts", () => {
    const document = toolSchemaFor(EventSchema)
    expect(JSON.stringify(document)).toContain("2020-12")
  })
})
