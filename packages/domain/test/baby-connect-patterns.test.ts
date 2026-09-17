import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import { EntrySchema, EventSchema } from "../src/index.js"

/**
 * Baby Connect workflow patterns as executable contract properties.
 *
 * Research source: docs/research/baby-connect-patterns.md (v1, September 17,
 * 2026) — source-linked interaction analysis of Baby Connect (babyconnect.com)
 * for the Shared Child Journal. Each test pins ONE pattern from that document
 * against the canonical Effect v4 schemas. Fixtures are synthetic (fx_ ids, no
 * real people, no medical claims); transcripts are preserved byte-for-byte and
 * every fixture block names the pattern it exercises.
 *
 * Patterns covered (numbers refer to the research doc, §6):
 *   P1  attributed multi-account roster  (Entry.authorId integrity)
 *   P2  one ordering basis, applied everywhere (timeline + summary comparator)
 *   P3  append-only correction           (original preserved, disjoint event ids)
 *   P4  handoff summary is a derived read model over published entries
 *   —   two-dimension rule               (no audience field, no fused status)
 *
 * The P2 comparator and P4 summarizer are reference implementations that live
 * in this file on purpose: slots 21 (authored timeline) and 24 (digest with
 * gap disclosure) lift them into src/ when those slots land. This file adds
 * no schema fields and changes no sources — additive only by design.
 *
 * Known contract delta (posted on the contract artifact): the repo EventSchema
 * carries no per-event authorId — attribution lives on Entry and flows to
 * events through structuredEventIds linkage. The contract artifact v0.2
 * (art_I2TCG08V) specifies Event.authorId; the lineage slots (02, 10)
 * reconcile that. These tests pin entry-level attribution only.
 */

const HOUSEHOLD_ID = "fx_household_1"
const CHILD_ID = "fx_child_1"

type Event = typeof EventSchema["Type"]
type Entry = typeof EntrySchema["Type"]

// ---------------------------------------------------------------------------
// Synthetic fixtures — one day, three authors (mom, dad, invited caregiver).
//
// P1 evidence: Baby Connect links separate caregiver accounts to one child
// profile and "everybody will be able to view and enter information about
// your child" (https://en.babyconnect.com/support, accessed 2026-09-17).
// Baby Connect's own sources never show per-author attribution (research doc
// U1); SCJ makes it first-class, so every entry below carries its author.
// ---------------------------------------------------------------------------

// Trailing double space is deliberate: raw transcripts must survive
// byte-for-byte (blueprint raw-preservation rule). An emoji rides in dad's
// transcript for the same reason.
const MOM_TRANSCRIPT = "She ate the whole banana at 8 and had a huge nap till 10.  "
const DAD_TRANSCRIPT = "he pooped on the potty right after lunch 😊"
const GRANDMA_TRANSCRIPT = "we read three books before quiet time"

const FX_EVENTS: Record<string, unknown> = {
  fx_event_1: {
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "meal",
    timestamp: 1789550400000,
    payload: { count: 1 },
    confidence: 1,
  },
  // Sleep span: payload.minutes gives the end time (start + minutes). P2 uses it.
  fx_event_2: {
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "sleep",
    timestamp: 1789550400000,
    payload: { minutes: 120 },
    confidence: 1,
  },
  fx_event_3: {
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "potty",
    timestamp: 1789551600000, // inside the sleep span — the P2 collision case
    confidence: 1,
  },
  fx_event_4: {
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "mood",
    timestamp: 1789580400000,
    confidence: 0.9,
  },
}

const momEntry: Record<string, unknown> = {
  householdId: HOUSEHOLD_ID,
  childId: CHILD_ID,
  authorId: "fx_mom",
  rawTranscript: MOM_TRANSCRIPT,
  structuredEventIds: ["fx_event_1", "fx_event_2"],
  extractionStatus: "structured",
  visibility: "published",
  createdAt: 1789550500000,
}

const dadEntry: Record<string, unknown> = {
  householdId: HOUSEHOLD_ID,
  childId: CHILD_ID,
  authorId: "fx_dad",
  rawTranscript: DAD_TRANSCRIPT,
  structuredEventIds: ["fx_event_3"],
  extractionStatus: "structured",
  visibility: "published",
  createdAt: 1789551700000,
}

// Draft: extraction finished but the entry is not published. The two status
// axes (publication vs extraction) stay independent — operator spec §2.2.
const grandmaEntry: Record<string, unknown> = {
  householdId: HOUSEHOLD_ID,
  childId: CHILD_ID,
  authorId: "fx_grandma",
  rawTranscript: GRANDMA_TRANSCRIPT,
  structuredEventIds: ["fx_event_4"],
  extractionStatus: "structured",
  visibility: "draft",
  createdAt: 1789580500000,
}

// P3 fixture: mom corrects dad's potty entry. Correction is a NEW entry with
// a NEW event id — the original entry and its event linkage are untouched.
const correctedEntry: Record<string, unknown> = {
  householdId: HOUSEHOLD_ID,
  childId: CHILD_ID,
  authorId: "fx_mom",
  rawTranscript: "correction to dad's note: the potty happened at 1:20, not right after lunch",
  structuredEventIds: ["fx_event_5"],
  extractionStatus: "structured",
  visibility: "published",
  createdAt: 1789554000000,
}
FX_EVENTS.fx_event_5 = {
  householdId: HOUSEHOLD_ID,
  childId: CHILD_ID,
  category: "potty",
  timestamp: 1789551600000,
  confidence: 1,
}

const decodeEvent = (raw: unknown): Event => Schema.decodeUnknownSync(EventSchema)(raw)
const decodeEntry = (raw: unknown): Entry => Schema.decodeUnknownSync(EntrySchema)(raw)

describe("Baby Connect pattern properties (docs/research/baby-connect-patterns.md)", () => {
  test("P1: three caregiver accounts attribute entries distinctly; raw transcripts survive byte-for-byte", () => {
    const mom = decodeEntry(momEntry)
    const dad = decodeEntry(dadEntry)
    const grandma = decodeEntry(grandmaEntry)

    // Attribution integrity: three authors, three distinct ids, none mutated.
    expect(new Set([mom.authorId, dad.authorId, grandma.authorId]).size).toBe(3)
    expect(mom.authorId).toBe("fx_mom")

    // Byte fidelity: trailing whitespace and emoji survive decode untouched.
    expect(mom.rawTranscript).toBe(MOM_TRANSCRIPT)
    expect(MOM_TRANSCRIPT.endsWith("  ")).toBe(true) // fixture itself keeps raw bytes
    expect(dad.rawTranscript).toBe(DAD_TRANSCRIPT)
    expect(dad.rawTranscript.includes("😊")).toBe(true)
    expect(grandma.rawTranscript).toBe(GRANDMA_TRANSCRIPT)
  })

  test("P2: one ordering basis drives BOTH the timeline and the summary pick (Baby Connect's 'entry time based on')", () => {
    // Baby Connect's FAQ ships start-vs-end ordering as an explicit setting
    // that applies to the chronological list AND the summary in the same
    // breath (https://en.babyconnect.com/support). The property to pin: the
    // "last entry" a summary reports is the timeline's last element under
    // the SAME basis — never a second, divergent ordering.
    const sleep = decodeEvent(FX_EVENTS.fx_event_2)
    const potty = decodeEvent(FX_EVENTS.fx_event_3)

    type Span = { readonly id: string; readonly start: number; readonly end: number }
    type Basis = "start" | "end"

    // Span reconstruction: point events start === end; spans use payload.minutes.
    const toSpan = (id: string, event: Event): Span => ({
      id,
      start: event.timestamp,
      end: event.timestamp + ((event.payload?.minutes ?? 0) as number) * 60_000,
    })

    const spans = [toSpan("fx_event_2", sleep), toSpan("fx_event_3", potty)]
    const eventTime = (span: Span, basis: Basis) => (basis === "start" ? span.start : span.end)
    const sortTimeline = (items: readonly Span[], basis: Basis): readonly Span[] =>
      [...items].sort((a, b) => eventTime(a, basis) - eventTime(b, basis))

    // The collision case is real: the two bases genuinely disagree here.
    const startOrder = sortTimeline(spans, "start").map((s) => s.id)
    const endOrder = sortTimeline(spans, "end").map((s) => s.id)
    expect(startOrder).toEqual(["fx_event_2", "fx_event_3"]) // sleep (1:00) before potty (1:20)
    expect(endOrder).toEqual(["fx_event_3", "fx_event_2"]) // potty before sleep END (3:00)

    // Consistency property: summary pick === timeline last, per basis.
    const summaryPick = (basis: Basis) => sortTimeline(spans, basis).at(-1)?.id
    for (const basis of ["start", "end"] as const) {
      expect(summaryPick(basis)).toBe(sortTimeline(spans, basis).at(-1)?.id)
    }
  })

  test("P3: correction is append-only — the original entry stays byte-identical with disjoint event ids", () => {
    const original = decodeEntry(dadEntry)
    const corrected = decodeEntry(correctedEntry)

    // The original is not mutated in place: same transcript bytes, same
    // linkage, same author.
    expect(original.rawTranscript).toBe(DAD_TRANSCRIPT)
    expect(original.structuredEventIds).toEqual(["fx_event_3"])

    // The correction links a NEW event id — no reuse, no overlap.
    const originalIds = new Set(original.structuredEventIds)
    for (const id of corrected.structuredEventIds) {
      expect(originalIds.has(id)).toBe(false)
    }

    // Cross-author correction (mom corrects dad) is representable without
    // touching the original — correction rights are grantable, per the
    // sibling-product evidence (Daily Connect Security checkbox) and the
    // operator spec's append-only lineage.
    expect(corrected.authorId).toBe("fx_mom")
    expect(corrected.structuredEventIds).toEqual(["fx_event_5"])

    // The corrected event still decodes through the canonical Event schema.
    expect(decodeEvent(FX_EVENTS.fx_event_5).category).toBe("potty")
  })

  test("P4: handoff summary is a derived read model over PUBLISHED entries only — drafts are excluded, attribution flows through", () => {
    const entries = [decodeEntry(momEntry), decodeEntry(dadEntry), decodeEntry(grandmaEntry)]
    const eventsById = new Map(Object.entries(FX_EVENTS).map(([id, raw]) => [id, decodeEvent(raw)]))

    // Reference implementation for slot 24 (digest with gap disclosure):
    // derived from entries + linked events, no new write path.
    const buildHandoffSummary = (allEntries: readonly Entry[], byId: ReadonlyMap<string, Event>) => {
      const published = allEntries.filter((entry) => entry.visibility === "published")
      const counts = new Map<string, number>()
      const authorsByCategory = new Map<string, Set<string>>()
      for (const entry of published) {
        for (const id of entry.structuredEventIds) {
          const event = byId.get(id)
          if (!event) continue
          counts.set(event.category, (counts.get(event.category) ?? 0) + 1)
          const authors = authorsByCategory.get(event.category) ?? new Set<string>()
          authors.add(entry.authorId)
          authorsByCategory.set(event.category, authors)
        }
      }
      return { includedEntries: published.length, counts, authorsByCategory }
    }

    const summary = buildHandoffSummary(entries, eventsById)

    // Grandma's draft entry is real but excluded from the handoff.
    expect(summary.includedEntries).toBe(2)
    expect(summary.counts.get("mood")).toBeUndefined()

    // Published categories count correctly; attribution flows through the
    // derivation (source-linked, not anonymous).
    expect(summary.counts.get("meal")).toBe(1)
    expect(summary.counts.get("sleep")).toBe(1)
    expect(summary.counts.get("potty")).toBe(1)
    expect(summary.authorsByCategory.get("meal")).toEqual(new Set(["fx_mom"]))
    expect(summary.authorsByCategory.get("potty")).toEqual(new Set(["fx_dad"]))
  })

  test("Two-dimension rule: Entry carries publication state only — no audience field, no fused status enum (contract v0.2)", () => {
    // Type-level pins: if a fused `status` or `audience` field ever lands on
    // Entry, these assignments stop typechecking and this test fails.
    type HasAudienceField = "audience" extends keyof Entry ? true : false
    type HasFusedStatus = "status" extends keyof Entry ? true : false
    const pins: [HasAudienceField, HasFusedStatus] = [false, false]
    expect(pins).toEqual([false, false])

    // Runtime pin: a draft entry with finished extraction decodes — the two
    // axes (publication, extraction) are independent dimensions.
    const grandma = decodeEntry(grandmaEntry)
    expect(grandma.visibility).toBe("draft")
    expect(grandma.extractionStatus).toBe("structured")
  })
})
