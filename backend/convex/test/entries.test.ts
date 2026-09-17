/**
 * Validator-level tests for the entry functions' arena-integration grafts
 * (backend/convex) — the knowledge.test.ts evidence pattern (N1: no local
 * Convex runtime harness): exercise the exact contracts and pure decision
 * logic the handlers use. Handler wiring is proven by strict typechecking
 * against the generated API (rawCaptures table + appendEvents mutation).
 *
 * Grafts under test:
 *  - A (ea5c736): server-side Effect re-decode — confidence 1.5 rejected HERE.
 *  - B (15fe84f9): append-only raw-captures log + raw-before-events.
 */
import { describe, expect, it } from "bun:test"
import { Schema } from "effect"

import { CaptureId, EventSchema } from "@journal/domain"
import { convexFields } from "@journal/domain/convex"

import {
  buildRawCaptureRow,
  decodeAppendEvents,
  decideAttach,
  RawCaptureFields,
  requireRawCaptureBeforeEvents,
  type EntryRef,
} from "../convex/entriesInput"

const CAPTURE = Schema.decodeSync(CaptureId)("cap-01")

const entry = (over: Partial<EntryRef> = {}): EntryRef => ({
  captureId: CAPTURE,
  structuredEventIds: [],
  extractionStatus: "pending",
  ...over,
})

// Canonical AppendEventsInput events — exactly what a successful re-decode
// yields (EventFields.Type). The client supplies tenancy fields too — the
// attach decision must derive them from the entry instead.
const decodedEvents = (count: number, confidence = 0.9) =>
  Array.from({ length: count }, (_, i) => ({
    householdId: "household-attacker",
    childId: "child-other",
    category: "meal" as const,
    timestamp: 1_700_000_000_000 + i * 1_000,
    payload: { ounces: 6 },
    confidence,
  }))

const appendArgs = (events: unknown) => ({
  entryId: "e1" as never, // Id<"entries"> at the contract level; decode-shaped here
  events,
})

describe("raw-captures row builder (candidate B)", () => {
  it("builds an append-only row composed from canonical fields", () => {
    const row = buildRawCaptureRow({
      captureId: CAPTURE,
      childId: "child-1",
      authorId: "author-mom",
      rawTranscript: "She drank 6 ounces of formula.",
      now: 1_700_000_000_000,
    })
    expect(row.captureId).toBe(CAPTURE)
    expect(row.childId).toBe("child-1")
    expect(row.authorId).toBe("author-mom")
    expect(row.rawTranscript).toBe("She drank 6 ounces of formula.")
    expect(row.capturedAt).toBe(1_700_000_000_000)
    expect(row.createdAt).toBe(1_700_000_000_000)
  })

  it("derives Convex validators from the canonical composition (adapter smoke)", () => {
    const validators = convexFields(Schema.Struct(RawCaptureFields))
    expect(Object.keys(validators)).toContain("captureId")
    expect(Object.keys(validators)).toContain("rawTranscript")
  })
})

describe("raw-before-events (candidate B, server-enforced)", () => {
  it("refuses events for a capture-session entry with no durable raw capture", () => {
    const error = requireRawCaptureBeforeEvents(entry(), undefined)
    expect(error).not.toBeNull()
    expect(error).toContain("no durable raw capture")
  })

  it("refuses events when the raw capture belongs to another capture session", () => {
    const error = requireRawCaptureBeforeEvents(entry(), { captureId: "cap-other" })
    expect(error).not.toBeNull()
  })

  it("permits events once the durable raw capture exists", () => {
    expect(requireRawCaptureBeforeEvents(entry(), { captureId: CAPTURE })).toBeNull()
  })

  it("permits events for manual entries — the entry row is its own raw record", () => {
    expect(requireRawCaptureBeforeEvents(entry({ captureId: undefined }), undefined)).toBeNull()
  })
})

describe("server-side re-decode (candidate A)", () => {
  it("accepts a canonical, in-bounds event payload", () => {
    const decoded = decodeAppendEvents(appendArgs(decodedEvents(1)))
    expect(decoded.ok).toBe(true)
  })

  it("rejects confidence 1.5 server-side — the client's validation is irrelevant", () => {
    const decoded = decodeAppendEvents(appendArgs(decodedEvents(1, 1.5)))
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.reason.length).toBeGreaterThan(0)
  })

  it("rejects malformed payloads through the canonical EventFields schema", () => {
    expect(decodeAppendEvents(appendArgs([{ category: "not-a-category", timestamp: 1, confidence: 0.9 }])).ok).toBe(false)
    expect(decodeAppendEvents(appendArgs([{ category: "meal", timestamp: "not-a-number", confidence: 0.9 }])).ok).toBe(false)
    expect(decodeAppendEvents({ events: "not-an-array" }).ok).toBe(false)
  })
})

describe("set-once attach decision", () => {
  const context = { householdId: "household-1", childId: "child-1" }

  it("attaches first-time events with tenancy derived from the entry, not the client", () => {
    const decision = decideAttach(entry(), decodedEvents(2), context)
    expect(decision.kind).toBe("attach")
    if (decision.kind === "attach") {
      expect(decision.eventRows.length).toBe(2)
      for (const row of decision.eventRows) {
        expect(row.householdId).toBe("household-1")
        expect(row.childId).toBe("child-1")
      }
    }
  })

  it("treats the pipeline's own retry (same count) as idempotent", () => {
    const decision = decideAttach(
      entry({ structuredEventIds: ["e1", "e2"], extractionStatus: "structured" }),
      decodedEvents(2),
      context,
    )
    expect(decision.kind).toBe("idempotent")
  })

  it("refuses a different event set on an entry that already carries events", () => {
    const decision = decideAttach(
      entry({ structuredEventIds: ["e1"], extractionStatus: "structured" }),
      decodedEvents(3),
      context,
    )
    expect(decision.kind).toBe("conflict")
  })

  it("refuses an empty append instead of silently flipping extraction status", () => {
    const decision = decideAttach(entry(), decodedEvents(0), context)
    expect(decision.kind).toBe("conflict")
  })
})

describe("canonical round-trip", () => {
  it("event rows re-decode through the canonical EventSchema", () => {
    const decision = decideAttach(entry(), decodedEvents(1), { householdId: "hh", childId: "c1" })
    if (decision.kind !== "attach") throw new Error("expected attach")
    for (const row of decision.eventRows) expect(Schema.is(EventSchema)(row)).toBe(true)
  })
})
