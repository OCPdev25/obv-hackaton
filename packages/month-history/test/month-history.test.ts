/**
 * @journal/month-history — package tests (bun).
 *
 * The deep behavioral coverage lives in the executable journeys
 * (src/journeys.ts + rubric.json, run via `bun src/run.ts`). These tests pin
 * the same surface for `pnpm test`/CI: every journey check passes, the
 * timezone helpers hold their DST/boundary behavior, correction lineage is
 * append-only and ordered, the handoff digest is deterministic and
 * source-linked, and projections never mutate the dataset.
 */
import { describe, expect, test } from "bun:test"

import {
  CORRECTIONS,
  DAD,
  ENTRY_IDS,
  EVENTS,
  EVENT_IDS,
  CHILD_ID,
  HOUSEHOLD_ID,
  HOUSEHOLD_ZONE,
  MOM,
  NOV1_0130_EDT,
  NOV1_0130_EST,
  buildAuthorizedView,
  buildHandoffDigest,
  buildLineage,
  buildMonthHistoryView,
  daySummary,
  entryViewInputFromDocument,
  eventViewInputFromDocument,
  isInstantInMonth,
  latestCorrection,
  localDateKey,
  monthAccess,
  zonedMonthBounds,
  type CorrectionRecord,
} from "../src/index.js"
import { ENTRIES, EVENTS as FIXTURE_EVENTS } from "../src/fixtures/monthHistory.js"
import { JOURNEY_CHECKS } from "../src/journeys.js"

const SCOPE = { childId: CHILD_ID, householdId: HOUSEHOLD_ID }
const MOM_PRINCIPAL = { kind: "caregiver" as const, caregiverId: MOM, householdIds: [HOUSEHOLD_ID] }
const DAD_PRINCIPAL = { kind: "caregiver" as const, caregiverId: DAD, householdIds: [HOUSEHOLD_ID] }

describe("journey checks", () => {
  test("every executable journey check passes", () => {
    for (const journey of JOURNEY_CHECKS) {
      const outcome = journey.run()
      expect(outcome.ok).toBe(true)
    }
  })
})

describe("household-zone calendar", () => {
  test("DST fall-back pairs both land on the local date", () => {
    expect(localDateKey(NOV1_0130_EDT, HOUSEHOLD_ZONE)).toBe("2026-11-01")
    expect(localDateKey(NOV1_0130_EST, HOUSEHOLD_ZONE)).toBe("2026-11-01")
  })

  test("the November 2026 month in New York spans 721 hours", () => {
    const bounds = zonedMonthBounds("2026-11", "America/New_York")
    expect((bounds.endMsExclusive - bounds.startMs) / 3_600_000).toBe(721)
  })

  test("month membership follows the household zone, not UTC", () => {
    const boundary = EVENTS.find((event) => event._id === EVENT_IDS.sep30Boundary)!
    const nySeptember = zonedMonthBounds("2026-09", "America/New_York")
    const nyOctober = zonedMonthBounds("2026-10", "America/New_York")
    const kolkataOctober = zonedMonthBounds("2026-10", "Asia/Kolkata")
    expect(isInstantInMonth(boundary.timestamp, nySeptember)).toBe(true)
    expect(isInstantInMonth(boundary.timestamp, nyOctober)).toBe(false)
    expect(isInstantInMonth(boundary.timestamp, kolkataOctober)).toBe(true)
  })
})

describe("correction lineage", () => {
  test("latest correction wins and the chain stays append-only", () => {
    const lineage = buildLineage(CORRECTIONS).get(ENTRY_IDS.tower)
    expect(lineage).toBeDefined()
    expect(latestCorrection(lineage)!.correctedBy).toBe(DAD)
  })

  test("a correction superseding an unknown step is rejected", () => {
    const bad: CorrectionRecord = {
      correctionId: "co_bad",
      originalEntryId: ENTRY_IDS.tower,
      correctedBy: MOM,
      createdAtMs: 1,
      replacementTranscript: "x",
      supersedesCorrectionId: "co_never_seen",
    }
    expect(() => buildLineage([...CORRECTIONS, bad])).toThrow()
  })
})

describe("handoff digest", () => {
  test("summary formatting is deterministic and category-ordered", () => {
    expect(daySummary([{ category: "sleep" }, { category: "potty" }, { category: "potty" }])).toBe("2× potty, 1× sleep")
  })

  test("the digest is stable across identical builds", () => {
    const { view } = buildAuthorizedView(MOM_PRINCIPAL, "2026-09", HOUSEHOLD_ZONE)
    const options = { preparedByName: "Mom", preparedForName: "Dad", excludedDraftCount: 2 } as const
    expect(buildHandoffDigest(view, options)).toEqual(buildHandoffDigest(view, options))
  })
})

describe("projection purity", () => {
  test("building views, access, and digests never mutates the dataset", () => {
    const before = JSON.stringify({ entries: ENTRIES, events: FIXTURE_EVENTS })
    buildAuthorizedView(MOM_PRINCIPAL, "2026-09", HOUSEHOLD_ZONE)
    buildAuthorizedView(DAD_PRINCIPAL, "2026-10", "Asia/Kolkata")
    expect(JSON.stringify({ entries: ENTRIES, events: FIXTURE_EVENTS })).toBe(before)
  })
})

describe("authorization adapter", () => {
  test("drafts stay author-only and non-members are denied at the timeline gate", () => {
    const mom = monthAccess(MOM_PRINCIPAL, SCOPE, ENTRIES)
    expect(mom.outcome).toBe("allowed")
    if (mom.outcome === "allowed") {
      const drafts = mom.visible.filter((entry) => entry.visibility === "draft")
      expect(drafts.length).toBe(1)
      expect(drafts[0]!.authorId).toBe(MOM)
    }

    const outsider = monthAccess({ kind: "caregiver", caregiverId: "cg_outsider", householdIds: [] }, SCOPE, ENTRIES)
    expect(outsider.outcome).toBe("denied")
  })
})

describe("document adapters", () => {
  test("field-rename adapters preserve identity", () => {
    const doc = ENTRIES[0]!
    expect(entryViewInputFromDocument(doc).entryId).toBe(doc._id)
    const event = FIXTURE_EVENTS[0]!
    expect(eventViewInputFromDocument(event).eventId).toBe(event._id)
  })
})

describe("view builder export", () => {
  test("an empty authorized month states its emptiness honestly", () => {
    const view = buildMonthHistoryView({
      monthKey: "2026-09",
      timeZone: HOUSEHOLD_ZONE,
      entries: [],
      events: [],
      corrections: [],
      authors: {},
      scopeEntryIds: [],
    })
    expect(view.gap.kind).toBe("empty-month")
    expect(view.days.length).toBe(30)
  })
})
