/**
 * Extraction-double and v0.3 envelope semantics at the store level:
 * clause/event alignment, category routing, lineage, and the late-apply
 * retry rules (stale suppression, idempotent no-op).
 */
import { describe, expect, it } from "vitest"

import { runExtraction } from "../src/capture/extraction.js"
import { anonymousPrincipal, at, memberPrincipal } from "../src/fixtures/household.js"
import { createSeptemberStore } from "../src/fixtures/september.js"

const { Schema, CaptureId } = (() => {
  // Local helpers to brand plain capture ids for the double.
  return { Schema: require("effect").Schema, CaptureId: require("@journal/domain").CaptureId }
})()

const HOUSEHOLD_ID = "hh_polanco_household"

function extract(captureId: string, transcript: string, capturedAt: number, defaultChildId: string) {
  return runExtraction({
    captureId: Schema.decodeUnknownSync(CaptureId)(captureId),
    attempt: 0,
    transcript,
    capturedAt,
    householdId: HOUSEHOLD_ID,
    childIds: ["ch_milo", "ch_iris"],
    childNames: [
      { name: "Milo", aliases: ["buddy"] },
      { name: "Iris", aliases: ["sis"] },
    ],
    defaultChildId,
    attemptRecordId: "atn_test",
  })
}

describe("extraction double", () => {
  const MIXED =
    "Milo ate scrambled eggs and toast at 8, then had a total meltdown when the block tower fell, and Iris napped 45 minutes."

  it("splits a mixed-topic utterance into aligned events and source clauses", () => {
    const outcome = extract("cap_pipeline_mixed", MIXED, at(16, 8, 0), "ch_milo")
    expect(outcome.events.length).toBe(3)
    expect(outcome.sourceClauses.length).toBe(outcome.events.length) // parallel arrays
    expect(outcome.events.map((event) => event.category).sort()).toEqual(["meal", "mood", "sleep"])
    for (const event of outcome.events) {
      expect(event.producedBy?.extractorVersion).toBe("home-a-extraction-double/0.1.0")
    }
    // Per-clause child attribution: Milo's meal and mood, Iris's nap.
    expect(outcome.events.find((event) => event.category === "meal")?.childId).toBe("ch_milo")
    expect(outcome.events.find((event) => event.category === "mood")?.childId).toBe("ch_milo")
    const sleep = outcome.events.find((event) => event.category === "sleep")
    expect(sleep?.childId).toBe("ch_iris") // the nap clause belongs to Iris
    expect(sleep?.payload?.["minutes"]).toBe(45) // count quantities are numeric
  })

  it("keeps skipped naps from becoming sleep events", () => {
    const outcome = extract("cap_pipeline_skip", "Milo skipped his nap this morning.", at(16, 12, 0), "ch_milo")
    expect(outcome.events.every((event) => event.category !== "sleep")).toBe(true)
  })

  it("water-play 'soaked' does not invent a potty event", () => {
    const outcome = extract(
      "cap_pipeline_water",
      "Water play day at pre-K — Milo's teacher says he led the bucket brigade. He was soaked and delighted.",
      at(16, 9, 0),
      "ch_milo",
    )
    expect(outcome.events.some((event) => event.category === "potty")).toBe(false)
    expect(outcome.events.map((event) => event.category).sort()).toEqual(["mood", "school"])
    for (const event of outcome.events) expect(event.childId).toBe("ch_milo")
  })

  it("never invents a category for health content (stays raw)", () => {
    const outcome = extract("cap_pipeline_health", "Iris had her checkup today.", at(16, 10, 0), "ch_iris")
    expect(outcome.events.length).toBe(0)
    expect(outcome.unstructured.length).toBeGreaterThan(0)
  })
})

describe("v0.3 late-apply envelope semantics", () => {
  it("stale results are suppressed, latest re-apply is a no-op, unknown captures rejected", () => {
    const { store } = createSeptemberStore()
    const principal = memberPrincipal("mem_dana")
    const first = store.capture(principal, {
      captureId: "cap_late_apply",
      transcript: "Iris napped 40 minutes.",
      authorId: "mem_dana",
      capturedAt: at(16, 18, 0),
      channel: "text" as const,
    })
    expect(first.kind).toBe("captured")
    if (first.kind !== "captured") return
    const captureId = first.proposals[0]?.captureId
    expect(captureId).toBeDefined()
    if (captureId === undefined) return

    const late = extract(captureId, "Iris napped 40 minutes.", at(16, 18, 0), "ch_iris")

    // attempt 0 already applied → re-applying attempt 1 lands
    expect(store.applyExtractionResult(captureId, 1, late)).toEqual({ applied: true, reason: "applied" })
    // attempt 0 is now stale → suppressed, never merged
    expect(store.applyExtractionResult(captureId, 0, late)).toEqual({ applied: false, reason: "stale-suppressed" })
    // attempt 1 again → idempotent no-op
    expect(store.applyExtractionResult(captureId, 1, late)).toEqual({ applied: false, reason: "idempotent-no-op" })
    // unknown capture → rejected
    expect(store.applyExtractionResult("cap_never_captured", 5, late)).toEqual({ applied: false, reason: "unknown-capture" })
  })
})

describe("fail-closed store-level reads", () => {
  it("anonymous principals get empty timelines and denied answers", () => {
    const { store } = createSeptemberStore()
    expect(store.visibleEntries(anonymousPrincipal)).toEqual([])
    const answer = store.ask(anonymousPrincipal, "How did naps go this week?", at(16, 20, 0))
    expect(answer.kind).toBe("denied")
  })

  it("a parent's answers never move the write counter", () => {
    const { store } = createSeptemberStore()
    const before = store.writeCount
    store.ask(memberPrincipal("mem_dana"), "How did naps go this week?", at(16, 20, 0))
    store.catchUp(memberPrincipal("mem_gilbert"), at(16, 20, 1))
    store.monthView(memberPrincipal("mem_dana"), "2026-09")
    expect(store.writeCount).toBe(before)
  })
})
