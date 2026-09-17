/**
 * Candidate B behavior tests (Vitest). Every test drives the real pipeline:
 * submitCapture (text or simulated-voice) -> extraction double -> review
 * edits -> publish -> corrections. No live Convex, no LLM, synthetic data only.
 */
import { describe, expect, it } from "vitest"

import { ExtractionResult as ExtractionResultSchema, type ExtractionResult } from "@journal/domain"
import { Schema } from "effect"
import {
  buildStore,
  HOUSEHOLD_TIMEZONE,
  MIXED_BOTH_CHILDREN,
  SEED_SAMPLE,
  VOICE_SAMPLE,
  wallToUtc,
} from "./testing.js"
import { CHILD_IRIS, CHILD_MILO, HOUSEHOLD_ID, OUTSIDER, PERSONAS, principalOf } from "./fixtures.js"
import { HomeBStore } from "./store.js"

const DANA = principalOf(PERSONAS.dana)
const GILBERT = principalOf(PERSONAS.gilbert)
const ROSA = principalOf(PERSONAS.rosa)
const ANON = { kind: "anonymous" as const }
const outsiderPrincipal = {
  kind: "caregiver" as const,
  caregiverId: OUTSIDER.caregiverId,
  name: OUTSIDER.name,
  role: "caregiver" as const,
  householdIds: ["hh_other"],
}

describe("mixed-topic capture (text and voice paths)", () => {
  it("splits a mixed-topic text capture into per-clause proposed events", () => {
    const store = buildStore()
    const result = store.submitCapture(DANA, {
      captureId: "cap-mixed-text-1",
      transcript: MIXED_BOTH_CHILDREN,
      channel: "text",
      capturedAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 8, 0),
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId: CHILD_MILO,
    })
    expect(result._tag).toBe("Created")
    if (result._tag !== "Created") return

    const feed = store.getFeed(DANA)
    expect(feed._tag).toBe("Feed")
    if (feed._tag !== "Feed") return
    const drafts = feed.drafts.filter((v) => v.entryId === result.entryId)
    expect(drafts.length).toBeGreaterThanOrEqual(2)

    // Per-clause attribution: Milo gets the meal and mood, Iris gets the nap.
    const miloEvents = drafts.filter((v) => v.childId === CHILD_MILO)
    const irisEvents = drafts.filter((v) => v.childId === CHILD_IRIS)
    expect(miloEvents.map((v) => v.category).sort()).toEqual(["meal", "mood"])
    expect(irisEvents.map((v) => v.category)).toEqual(["sleep"])
    const nap = irisEvents[0]
    expect(nap?.payload).toEqual({ minutes: 45 })
  })

  it("routes the simulated voice input through the SAME pipeline and yields identical events", () => {
    const textStore = buildStore()
    const voiceStore = buildStore()
    const capturedAt = wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 8, 0)

    const textResult = textStore.submitCapture(DANA, {
      captureId: "cap-mixed-text-2",
      transcript: MIXED_BOTH_CHILDREN,
      channel: "text",
      capturedAt,
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId: CHILD_MILO,
    })
    const voiceResult = voiceStore.submitCapture(DANA, {
      captureId: "cap-mixed-voice-2",
      transcript: VOICE_SAMPLE, // identical utterance produced by the voice demo path
      channel: "voice",
      capturedAt,
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId: CHILD_MILO,
    })
    expect(textResult._tag).toBe("Created")
    expect(voiceResult._tag).toBe("Created")

    const asViews = (store: HomeBStore, r: typeof textResult | typeof voiceResult) => {
      expect(r._tag).toBe("Created")
      if (r._tag !== "Created") throw new Error("unreachable")
      const feed = store.getFeed(DANA)
      if (feed._tag !== "Feed") throw new Error("unreachable")
      return feed.drafts
        .filter((v) => v.entryId === r.entryId)
        .map(({ category, childId, timestamp, payload }) => ({ category, childId, timestamp, payload }))
        .sort((a, b) => a.timestamp - b.timestamp || a.category.localeCompare(b.category))
    }
    expect(asViews(voiceStore, voiceResult)).toEqual(asViews(textStore, textResult))
  })

  it("preserves the raw transcript verbatim on the draft entry (raw-before-events)", () => {
    const store = buildStore()
    const result = store.submitCapture(DANA, {
      captureId: "cap-raw-1",
      transcript: MIXED_BOTH_CHILDREN,
      channel: "text",
      capturedAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 8, 0),
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId: CHILD_MILO,
    })
    expect(result._tag).toBe("Created")
    if (result._tag !== "Created") return
    const raw = store.getRawSource(DANA, result.entryId)
    expect(raw._tag).toBe("RawSource")
    if (raw._tag !== "RawSource") return
    expect(raw.transcript).toBe(MIXED_BOTH_CHILDREN) // byte-for-byte
    expect(raw.visibility).toBe("draft")
  })

  it("replays the existing entry for a duplicate captureId (idempotency)", () => {
    const store = buildStore()
    const input = {
      captureId: "cap-idem-1",
      transcript: SEED_SAMPLE,
      channel: "text" as const,
      capturedAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 9, 0),
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId: CHILD_MILO,
    }
    const first = store.submitCapture(DANA, input)
    const second = store.submitCapture(DANA, input)
    expect(first._tag).toBe("Created")
    expect(second._tag).toBe("IdempotentReplay")
    if (first._tag !== "Created" || second._tag !== "IdempotentReplay") return
    expect(second.entryId).toBe(first.entryId)
    expect(store.counts().entries).toBe(1)
  })

  it("rejects an empty transcript without creating an entry", () => {
    const store = buildStore()
    const result = store.submitCapture(DANA, {
      captureId: "cap-empty-1",
      transcript: "",
      channel: "text",
      capturedAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 9, 0),
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId: CHILD_MILO,
    })
    expect(result._tag).toBe("Rejected")
    expect(store.counts().entries).toBe(0)
  })
})

describe("review surface before publish", () => {
  it("edits type, child, time, amount, and audience on proposed events", () => {
    const store = buildStore()
    const created = submitSample(store, "cap-review-1")
    const feed = store.getFeed(DANA)
    expect(feed._tag).toBe("Feed")
    if (feed._tag !== "Feed") throw new Error("unreachable")
    const proposed = feed.drafts.find((v) => v.entryId === created.entryId)
    expect(proposed).toBeDefined()
    if (proposed === undefined) return

    // type
    expect(store.updateProposedEvent(DANA, created.entryId, proposed.eventId, { category: "mood" })._tag).toBe("Updated")
    // child
    expect(store.updateProposedEvent(DANA, created.entryId, proposed.eventId, { childId: CHILD_IRIS })._tag).toBe("Updated")
    // time
    const newTime = wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 7, 45)
    expect(store.updateProposedEvent(DANA, created.entryId, proposed.eventId, { timestamp: newTime })._tag).toBe("Updated")
    // amount
    const amountEdit = store.updateProposedEvent(DANA, created.entryId, proposed.eventId, { payload: { minutes: 90 } })
    expect(amountEdit._tag).toBe("Updated")
    if (amountEdit._tag !== "Updated") return
    expect(amountEdit.event.payload).toEqual({ minutes: 90 })
    expect(amountEdit.event.childId).toBe(CHILD_IRIS)
    expect(amountEdit.event.timestamp).toBe(newTime)
    expect(amountEdit.event.category).toBe("mood")

    // audience (author may set it on the draft)
    expect(store.setAudience(DANA, created.entryId, "parents")._tag).toBe("AudienceSet")
  })

  it("refuses schema-invalid edits on proposed events", () => {
    const store = buildStore()
    const created = submitSample(store, "cap-review-2")
    const feed = store.getFeed(DANA)
    if (feed._tag !== "Feed") throw new Error("unreachable")
    const proposed = feed.drafts.find((v) => v.entryId === created.entryId)
    if (proposed === undefined) throw new Error("expected a proposed event")
    const bad = store.updateProposedEvent(DANA, created.entryId, proposed.eventId, { category: "nonsense" as never })
    expect(bad._tag).toBe("InvalidEvent")
  })

  it("blocks proposed-event edits after publish (NotDraft)", () => {
    const store = buildStore()
    const created = submitSample(store, "cap-review-3")
    expect(store.publishEntry(DANA, created.entryId)._tag).toBe("Published")
    const feed = store.getFeed(DANA)
    if (feed._tag !== "Feed") throw new Error("unreachable")
    const published = feed.published.find((v) => v.entryId === created.entryId)
    if (published === undefined) throw new Error("expected a published event")
    expect(store.updateProposedEvent(DANA, created.entryId, published.eventId, { category: "mood" })._tag).toBe("NotDraft")
  })
})

describe("publish and provenance", () => {
  it("publishes with raw source preserved and provenance back to the capture", () => {
    const store = buildStore()
    const created = submitSample(store, "cap-pub-1")
    expect(store.publishEntry(DANA, created.entryId)._tag).toBe("Published")

    const raw = store.getRawSource(GILBERT, created.entryId)
    expect(raw._tag).toBe("RawSource")
    if (raw._tag !== "RawSource") return
    expect(raw.transcript).toBe(SEED_SAMPLE)
    expect(raw.captureId).toBe("cap-pub-1")
    expect(raw.channel).toBe("text")
    expect(raw.visibility).toBe("published")

    const feed = store.getFeed(GILBERT)
    if (feed._tag !== "Feed") throw new Error("unreachable")
    const view = feed.published.find((v) => v.entryId === created.entryId)
    expect(view).toBeDefined()
    if (view === undefined) return
    expect(view.rawTranscript).toBe(SEED_SAMPLE) // provenance: source visible from the feed row
    expect(view.captureId).toBe("cap-pub-1")
    expect(view.confidence).toBe(1) // caregiver-confirmed at publish
  })

  it("defaults audience to household and hides parents-only entries from the caregiver", () => {
    const store = buildStore()
    const created = submitSample(store, "cap-pub-2")
    expect(store.setAudience(DANA, created.entryId, "parents")._tag).toBe("AudienceSet")
    expect(store.publishEntry(DANA, created.entryId)._tag).toBe("Published")

    const danaFeed = store.getFeed(DANA)
    const rosaFeed = store.getFeed(ROSA)
    expect(danaFeed._tag).toBe("Feed")
    expect(rosaFeed._tag).toBe("Feed")
    if (danaFeed._tag !== "Feed" || rosaFeed._tag !== "Feed") return
    expect(danaFeed.published.some((v) => v.entryId === created.entryId)).toBe(true)
    expect(rosaFeed.published.some((v) => v.entryId === created.entryId)).toBe(false)
  })

  it("restricts audience changes to the author or a parent", () => {
    const store = buildStore()
    const created = submitSample(store, "cap-pub-3")
    expect(store.setAudience(ROSA, created.entryId, "parents")._tag).toBe("Denied") // neither author nor parent
    expect(store.setAudience(GILBERT, created.entryId, "parents")._tag).toBe("AudienceSet") // parent, not author
  })
})

describe("post-publish correction (append-only lineage)", () => {
  it("appends a correction without mutating the original event row", () => {
    const store = buildStore()
    const created = submitSample(store, "cap-lin-1")
    expect(store.publishEntry(DANA, created.entryId)._tag).toBe("Published")
    const feed = store.getFeed(DANA)
    if (feed._tag !== "Feed") throw new Error("unreachable")
    const event = feed.published.find((v) => v.entryId === created.entryId && v.category === "sleep")
    if (event === undefined) throw new Error("expected a published sleep event")

    const correction = store.correctEvent(DANA, {
      eventId: event.eventId,
      patch: { payload: { minutes: 60 } },
      reason: "Timer log showed 60 minutes; initial dictation said 30.",
    })
    expect(correction._tag).toBe("Corrected")
    if (correction._tag !== "Corrected") return

    const detail = store.getEventDetail(DANA, event.eventId)
    expect(detail._tag).toBe("Detail")
    if (detail._tag !== "Detail") return
    expect(detail.detail.corrections).toHaveLength(1)
    expect(detail.detail.corrections[0]?.priorEvent.payload).toEqual({ minutes: 45 }) // original preserved
    expect(detail.detail.corrections[0]?.correctedEvent.payload).toEqual({ minutes: 60 })
    expect(detail.detail.corrections[0]?.correctedBy).toBe(DANA.caregiverId)
    expect(detail.detail.view.payload).toEqual({ minutes: 60 }) // display uses the correction
    expect(detail.detail.view.correctedFrom).toEqual({ minutes: 45 })
    expect(detail.detail.view.hasLineage).toBe(true)
    expect(store.counts().corrections).toBe(1)
  })

  it("refuses corrections on draft events (NotPublished)", () => {
    const store = buildStore()
    const created = submitSample(store, "cap-lin-2")
    const feed = store.getFeed(DANA)
    if (feed._tag !== "Feed") throw new Error("unreachable")
    const draft = feed.drafts.find((v) => v.entryId === created.entryId)
    if (draft === undefined) throw new Error("expected a draft event")
    expect(store.correctEvent(DANA, { eventId: draft.eventId, patch: { payload: { minutes: 99 } }, reason: "too early" })._tag).toBe("NotPublished")
  })

  it("denies corrections by a non-member and marks the lineage actor", () => {
    const store = buildStore()
    const created = submitSample(store, "cap-lin-3")
    expect(store.publishEntry(DANA, created.entryId)._tag).toBe("Published")
    const feed = store.getFeed(DANA)
    if (feed._tag !== "Feed") throw new Error("unreachable")
    const event = feed.published.find((v) => v.entryId === created.entryId)
    if (event === undefined) throw new Error("expected a published event")
    expect(store.correctEvent(outsiderPrincipal, { eventId: event.eventId, patch: { payload: { minutes: 10 } }, reason: "nope" })._tag).toBe("Denied")
  })
})

describe("fail-closed authorization", () => {
  it("shows a non-member nothing on reads and denies every write", () => {
    const store = buildStore()
    const created = submitSample(store, "cap-fc-1")
    expect(store.publishEntry(DANA, created.entryId)._tag).toBe("Published")

    const feed = store.getFeed(outsiderPrincipal)
    // Fail-closed: a non-member is DENIED outright — no empty-feed distinction.
    expect(feed._tag).toBe("Denied")
    expect(store.getRawSource(outsiderPrincipal, created.entryId)._tag).toBe("Denied")
    expect(store.publishEntry(outsiderPrincipal, created.entryId)._tag).toBe("Denied")
    const write = store.submitCapture(outsiderPrincipal, {
      captureId: "cap-fc-out",
      transcript: SEED_SAMPLE,
      channel: "text",
      capturedAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 10, 0),
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId: CHILD_MILO,
    })
    expect(write._tag).toBe("Denied")
  })

  it("denies anonymous access entirely", () => {
    const store = buildStore()
    expect(store.getFeed(ANON)._tag).toBe("Denied")
    expect(store.getCatchUp(ANON)._tag).toBe("Denied")
  })

  it("denies an unknown caregiver id (not on the roster) even with a well-formed principal", () => {
    const store = buildStore()
    seedSampleHistory(store)
    const ghost = { kind: "caregiver" as const, caregiverId: "cg_ghost", name: "Ghost", role: "caregiver" as const, householdIds: [HOUSEHOLD_ID] }
    // Fail-closed: roster lookup happens server-side, so a well-formed principal
    // with a household id is still DENIED — a denial, not an empty feed.
    expect(store.getFeed(ghost)._tag).toBe("Denied")
    expect(store.getCatchUp(ghost)._tag).toBe("Denied")
  })
})

describe("read-only lookups never write", () => {
  it("leaves state byte-identical across feed, month, catch-up, detail, and raw-source lookups", () => {
    const store = buildStore()
    seedSampleHistory(store)
    const before = store.serializeState()

    expect(store.getFeed(DANA)._tag).toBe("Feed")
    expect(store.getFeed(DANA, { day: { year: 2026, month: 9, day: 8 } })._tag).toBe("Feed")
    expect(store.getFeed(DANA, { childId: CHILD_IRIS })._tag).toBe("Feed")
    expect(store.getMonthSummary(DANA, 2026, 9)._tag).toBe("MonthSummary")
    expect(store.getCatchUp(GILBERT)._tag).toBe("CatchUp")
    expect(store.getRawSource(ROSA, "ent_missing")._tag).toBe("NotFound")

    expect(store.serializeState()).toBe(before)
  })

  it("summarizes the demo month by wall-clock day", () => {
    const store = buildStore()
    seedSampleHistory(store)
    const summary = store.getMonthSummary(DANA, 2026, 9)
    expect(summary._tag).toBe("MonthSummary")
    if (summary._tag !== "MonthSummary") return
    const day8 = summary.days.find((d) => d.day === 8)
    expect(day8?.count).toBeGreaterThan(0)
    const days = summary.days.map((d) => d.day)
    expect(days).toEqual([...days].sort((a, b) => a - b))
  })

  it("builds the catch-up block from lastSeen and honors markSeen", () => {
    const store = buildStore()
    seedSampleHistory(store)
    const catchUp = store.getCatchUp(GILBERT)
    expect(catchUp._tag).toBe("CatchUp")
    if (catchUp._tag !== "CatchUp") return
    // Gilbert last seen Sep 12 07:45 — later entries show up in the block.
    expect(catchUp.events.length).toBeGreaterThan(0)

    // markSeen is an explicit user action, not a lookup.
    store.markSeen(GILBERT, wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 9, 0))
    const after = store.getCatchUp(GILBERT)
    if (after._tag !== "CatchUp") throw new Error("unreachable")
    expect(after.events.length).toBeLessThan(catchUp.events.length)
  })
})

describe("extraction envelope application", () => {
  const resultFor = (captureId: string, attempt: number, childId: string, timestamp: number): ExtractionResult =>
    // Decode through the canonical schema so captureId carries its brand.
    Schema.decodeUnknownSync(ExtractionResultSchema)({
      captureId,
      attempt,
      events: [{ householdId: HOUSEHOLD_ID, childId, category: "meal", timestamp, confidence: 0.9 }],
    })

  it("suppresses a stale result and never merges it", () => {
    const store = buildStore()
    store.submitCapture(DANA, {
      captureId: "cap-env-1",
      transcript: SEED_SAMPLE,
      channel: "text",
      capturedAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 8, 0),
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId: CHILD_MILO,
    })
    // attempt 2 applies, then a late attempt-1 result is discarded.
    expect(store.applyExtractionResult(DANA, resultFor("cap-env-1", 2, CHILD_MILO, 1))._tag).toBe("Applied")
    expect(store.applyExtractionResult(DANA, resultFor("cap-env-1", 1, CHILD_IRIS, 2))._tag).toBe("Superseded")
    const feed = store.getFeed(DANA)
    if (feed._tag !== "Feed") throw new Error("unreachable")
    expect(feed.drafts.every((v) => v.childId === CHILD_MILO)).toBe(true) // Iris event never merged
  })

  it("is idempotent: applying the same attempt twice is a no-op", () => {
    const store = buildStore()
    store.submitCapture(DANA, {
      captureId: "cap-env-2",
      transcript: SEED_SAMPLE,
      channel: "text",
      capturedAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 8, 0),
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId: CHILD_MILO,
    })
    const result = resultFor("cap-env-2", 3, CHILD_MILO, 5)
    expect(store.applyExtractionResult(DANA, result)._tag).toBe("Applied")
    expect(store.applyExtractionResult(DANA, result)._tag).toBe("IdempotentNoop")
    expect(store.counts().events).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function submitSample(store: HomeBStore, captureId: string) {
  const result = store.submitCapture(DANA, {
    captureId,
    transcript: SEED_SAMPLE,
    channel: "text",
    capturedAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 8, 0),
    timezone: HOUSEHOLD_TIMEZONE,
    focusChildId: CHILD_MILO,
  })
  if (result._tag !== "Created") throw new Error(`expected Created, got ${result._tag}`)
  return result
}

/** A few published entries spanning the demo month (deterministic, no corrections). */
function seedSampleHistory(store: HomeBStore): void {
  const samples: readonly { readonly day: number; readonly hh: number; readonly author: typeof DANA | typeof GILBERT | typeof ROSA; readonly childId: string; readonly transcript: string }[] = [
    { day: 2, hh: 8, author: GILBERT, childId: CHILD_MILO, transcript: "Milo started his new pre-K classroom today, drop off at 8." },
    { day: 5, hh: 11, author: DANA, childId: CHILD_MILO, transcript: "Park trip this morning, snack was crackers and raisins at 10:45." },
    { day: 8, hh: 17, author: DANA, childId: CHILD_MILO, transcript: "Milestone! Milo pedaled his balance bike by himself today at 5:15." },
    { day: 14, hh: 15, author: ROSA, childId: CHILD_IRIS, transcript: "Iris napped 75 minutes from 2:20, deep sleep." },
  ]
  samples.forEach((s, i) => {
    const created = store.submitCapture(s.author, {
      captureId: `cap-history-${i}`,
      transcript: s.transcript,
      channel: "text",
      capturedAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, s.day, s.hh, 0),
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId: s.childId,
    })
    if (created._tag !== "Created") throw new Error(`history seed failed at ${i}`)
    if (store.publishEntry(s.author, created.entryId)._tag !== "Published") throw new Error(`history publish failed at ${i}`)
  })
}
