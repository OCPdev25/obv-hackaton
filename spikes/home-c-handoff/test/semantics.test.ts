import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import { ExtractionResult, type ExtractionResult as TExtractionResult } from "../src/contract"
import { applyExtractionResult, currentEvents as contractCurrentEvents } from "../src/contract"
import { canSeeEntry, eventCue, type HouseholdMember } from "../src/grants"
import { cueFor, currentEvents, day, eventById, feedForMember, memberByUserId, restrictionFor, supersededEvents } from "../src/data"
import dayJson from "../fixtures/s1-day.json"

const parent = (userId: string): HouseholdMember | undefined => memberByUserId(userId)
const rosa = (): HouseholdMember | undefined => memberByUserId("rosa")

describe("audience grants (contract v0.2: visibility vs audience are separate dimensions)", () => {
  test("parents-only event: Marco and Elena see it, Rosa gets a locked cue (not silence)", () => {
    const school = eventById("ev-school-1")
    expect(school).toBeDefined()
    const entry = day.entries[0]
    if (school === undefined || entry === undefined) throw new Error("fixture missing")
    expect(eventCue(parent("marco")!, entry.wire, undefined)).toBe("visible")
    expect(eventCue(rosa()!, entry.wire, undefined)).toBe("visible")
    const restriction = restrictionFor("ev-school-1")
    expect(restriction?.scope).toBe("parents")
    expect(eventCue(rosa()!, entry.wire, restriction)).toBe("locked")
  })

  test("restrictions narrow, never widen: a parents-scoped event never shows to caregivers", () => {
    const school = eventById("ev-school-1")
    const entry = day.entries[0]
    if (school === undefined || entry === undefined) throw new Error("fixture missing")
    const restriction = { eventId: school.eventId, scope: "parents" as const, grantedBy: "elena", grantedAt: 0 }
    expect(cueFor(rosa(), school)).toBe("locked")
    expect(cueFor(parent("marco"), school)).toBe("visible")
    void restriction
  })

  test("drafts: visible to author and parents, never to caregiver role (stated prototype rule)", () => {
    const draft = { authorId: "elena", visibility: "draft" as const }
    expect(canSeeEntry(rosa()!, draft)).toBe(false)
    expect(canSeeEntry(parent("marco")!, draft)).toBe(true)
    expect(canSeeEntry(parent("elena")!, draft)).toBe(true)
  })

  test("feedForMember: caregiver sees the lock tile; parents see the event", () => {
    const rosaFeed = feedForMember("rosa")
    const locked = rosaFeed.find((x) => x.event.eventId === "ev-school-1")
    expect(locked?.cue).toBe("locked")
    const marcoFeed = feedForMember("marco")
    const visible = marcoFeed.find((x) => x.event.eventId === "ev-school-1")
    expect(visible?.cue).toBe("visible")
  })
})

describe("extraction envelope semantics (contract v0.2 rules 1–3)", () => {
  const decode = Schema.decodeUnknownSync(ExtractionResult)
  const result = (captureId: string, attempt: number, category: string): TExtractionResult =>
    decode({
      _tag: "ExtractionResult",
      captureId,
      attempt,
      events: [
        { _tag: "Event", category, occurredAt: 1_757_900_000_000 + attempt, confidence: 0.7, authorId: "elena" },
      ],
    })

  test("stale-result suppression: a superseded attempt is discarded, never merged", () => {
    const applied = applyExtractionResult([], result("cap-x", 1, "meal"))
    const stale = applyExtractionResult(applied, result("cap-x", 0, "potty"))
    expect(contractCurrentEvents(stale, "cap-x").length).toBe(1)
    expect(contractCurrentEvents(stale, "cap-x")[0]?.category).toBe("meal")
  })

  test("idempotent completion: applying the same (captureId, attempt) twice is a no-op", () => {
    const once = applyExtractionResult([], result("cap-y", 0, "sleep"))
    const twice = applyExtractionResult(once, result("cap-y", 0, "sleep"))
    expect(twice.length).toBe(once.length)
  })

  test("captures are independent", () => {
    const a = applyExtractionResult([], result("cap-a", 0, "meal"))
    const b = applyExtractionResult(a, result("cap-b", 0, "mood"))
    expect(contractCurrentEvents(b, "cap-a")[0]?.category).toBe("meal")
    expect(contractCurrentEvents(b, "cap-b")[0]?.category).toBe("mood")
  })
})

describe("corrections and pinning (art_rBKvvzIa §3.2 semantics in the home lens)", () => {
  test("the corrected night waking is caregiver-confirmed (pinned) and survives attempt 1", () => {
    const corrected = eventById("ev-sleep-2")
    expect(corrected?.wire.confidence).toBe(1)
    expect(corrected?.corrects).toBe("ev-sleep-1")
    const entry = day.entries[0]
    const attempt1 = entry?.capture.attempts.find((a) => a.attempt === 1)
    expect(attempt1?.suppressedConflicts?.[0]?.category).toBe("sleep")
    expect(attempt1?.suppressedConflicts?.[0]?.reason).toContain("pinned")
  })

  test("the misread original is never erased (append-only lineage)", () => {
    const misread = eventById("ev-sleep-1")
    expect(misread?.supersededBy).toBe("ev-sleep-2")
    expect(misread?.wire.note).toContain("misread")
    expect(currentEvents().find((e) => e.eventId === "ev-sleep-1")).toBeUndefined()
  })

  test("the correction is what makes five-fact #4 true (No nap recorded — absence of record, not a confirmed absence)", () => {
    const fact4 = day.takeover.fiveFacts[3]
    expect(fact4?.headline).toBe("No nap recorded")
    expect(fact4?.refs.some((r) => r.kind === "correction")).toBe(true)
    expect(fact4?.refs.some((r) => r.kind === "fixture" && r.ref.startsWith("coverage:"))).toBe(true)
  })
})

describe("read-only questions never write", () => {
  test("Marco's 'Did she nap?' answer is source-linked and carries no mutation path", () => {
    const q = day.readOnlyQuestions[0]
    expect(q?.question).toBe("Did she nap?")
    expect(q?.askedBy).toBe("marco")
    expect(q?.sources.length).toBeGreaterThanOrEqual(2)
    expect(q?.sources.some((s) => s.kind === "fixture" && s.ref.startsWith("coverage:"))).toBe(true)
    expect(q?.answer).toContain("No nap recorded today")
  })
})

describe("missing-data semantics (product-owner ruling: absence of record ≠ confirmed absence)", () => {
  // The ruling: missing data reads "No nap recorded" — it may never imply a
  // confirmed absence, and no behavioral prediction may be shown without a
  // supported source event. Negative control: fails if any prediction-capable
  // surface (brief headlines/details, plan note, Q&A answer) starts
  // forecasting behavior from missing data again.
  test("no behavioral prediction appears in the brief, plan, or answers without a supported source event", () => {
    const fact4 = day.takeover.fiveFacts[3]
    const plan = day.takeover.plan
    const answer = day.readOnlyQuestions[0]?.answer ?? ""
    const surfaces = [fact4?.headline, fact4?.detail, plan?.note, answer].filter(
      (s): s is string => s !== undefined,
    )

    for (const text of surfaces) {
      expect(text).not.toMatch(/no nap today/i) // confirmed-absence phrasing is banned
      expect(text).not.toMatch(/meltdown/i) // forecast vocabulary is banned on missing data
      expect(text).not.toMatch(/expect an early/i)
      expect(text).not.toMatch(/consider an early/i)
    }
    expect(fact4?.headline).toBe("No nap recorded")
    expect(plan?.note).toContain("no behavioral prediction is offered without a supported source")
    expect(answer).toContain("No nap recorded today")

    // Sweep the WHOLE fixture: every "meltdown" mention must sit in the
    // drop-off event's own context (its parents-only restriction note) — a
    // recorded event, never a prediction about missing data:
    const meltdownPaths: Array<string> = []
    const walk = (node: unknown, path: string): void => {
      if (typeof node === "string") {
        if (node.toLowerCase().includes("meltdown")) meltdownPaths.push(path)
        return
      }
      if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`))
      if (typeof node === "object" && node !== null) {
        for (const [k, v] of Object.entries(node)) walk(v, path === "" ? k : `${path}.${k}`)
      }
    }
    walk(dayJson, "")
    expect(meltdownPaths.length).toBeGreaterThan(0)
    for (const path of meltdownPaths) {
      expect(path.startsWith("audienceRestrictions")).toBe(true)
    }
    expect(
      day.audienceRestrictions.some(
        (r) => r.eventId === "ev-school-1" && r.note?.toLowerCase().includes("meltdown"),
      ),
    ).toBe(true)

    // The plan's basis is non-empty and every id resolves to a real source event:
    expect((plan?.basis ?? []).length).toBeGreaterThan(0)
    for (const id of plan?.basis ?? []) {
      expect(eventById(id)).toBeDefined()
    }
  })
})
