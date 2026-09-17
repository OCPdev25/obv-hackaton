import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import {
  CatchUpQueryInput,
  CatchUpReport,
  ChildDocument,
  EntryDocument,
  EventDocument,
  EventRevisionStruct,
  advanceReadState,
  computeCatchUp,
  gapDisclosure,
  utcDayKey,
} from "../src/index.js"
import type {
  CatchUpEntry,
  CatchUpError,
  CatchUpGrants,
  CatchUpHistory,
  CatchUpItemKind,
  CatchUpRevision,
  DayKeyOf,
} from "../src/index.js"

/**
 * Since-last-seen catch-up acceptance cases (art_6qhBut41, AC-01…AC-14).
 *
 * Expectations live in evaluation/fixtures/agent-experience/catchup/ —
 * history.json (synthetic two-household history), grants.json (reader
 * memberships incl. one denied reader), cases.json (per-case inputs and
 * expected kinds/ids/counts/disclosure). All fixture times are Z-suffixed ISO
 * strings converted with Date.parse; no wall clock, no randomness.
 */

const fixturesDir = fileURLToPath(
  new URL("../../../evaluation/fixtures/agent-experience/catchup/", import.meta.url),
)

interface RawEntry {
  _id: string
  householdId: string
  childId: string
  authorId: string
  rawTranscript: string
  structuredEventIds: string[]
  extractionStatus: "pending" | "structured" | "failed"
  visibility: "draft" | "published"
  photoId?: string
  createdAt: string
  _creationTime: string
}

interface RawEvent {
  _id: string
  householdId: string
  childId: string
  category: string
  timestamp: string
  payload?: Record<string, number>
  confidence: number
  _creationTime: string
}

interface RawRevision {
  id: string
  householdId: string
  childId: string
  supersedesEventId: string
  category: string
  timestamp: string
  payload?: Record<string, number>
  confidence: number
  actorId: string
  note?: string
  createdAt: string
}

interface RawHistory {
  children: Array<{ _id: string; householdId: string; name: string; createdAt: string; _creationTime: string }>
  entries: RawEntry[]
  events: RawEvent[]
  revisions: RawRevision[]
}

interface RawGrants {
  memberships: Record<string, string[]>
}

interface CaseExpected {
  windowStartIso?: string
  horizonClipped?: boolean
  allCaughtUp?: boolean
  kinds?: CatchUpItemKind[]
  expectedItemEntryIds?: string[]
  boundaryExcludedEntryId?: string
  lateSpec?: { entryId: string; daysLate: number; occurredAtIso: string; recordedAtIso: string }
  correctedSpec?: {
    entryId: string
    originalEventId: string
    revisionIds: string[]
    correctedBy: string
    revisedPayload: Record<string, number>
    revisedConfidence: number
  }
  correctedItemCount?: number
  counts?: { gapDays: number; confirmedEvents: number; inferredEvents: number }
  gapDayCount?: number
  gapDayKeys?: string[]
  coverageDayCount?: number
  dayKeyPolicy?: string
  singleBucketDay?: string
  singleBucketCount?: number
  disclosure?: string
  errorTag?: "UnauthorizedReader" | "HorizonExceeded"
  absentFromOutput?: string[]
  draftEntryIds?: string[]
  advanceSpec?: { t1Iso: string; t2Iso: string }
}

interface CatchupCase {
  caseId: string
  readerId: string
  childId: string
  watermarkIso: string | null
  nowIso: string
  horizonDays: number
  expected: CaseExpected
}

const historyFixture = JSON.parse(readFileSync(join(fixturesDir, "history.json"), "utf8")) as RawHistory
const grantsFixture = JSON.parse(readFileSync(join(fixturesDir, "grants.json"), "utf8")) as RawGrants
const casesFixture = JSON.parse(readFileSync(join(fixturesDir, "cases.json"), "utf8")) as {
  cases: CatchupCase[]
}

/** Z-suffixed ISO only — anything else is a fixture bug, not a soft default. */
const isoMs = (iso: string): number => {
  if (!iso.endsWith("Z")) throw new Error(`fixture timestamp must be Z-suffixed ISO: ${iso}`)
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`fixture timestamp is not parseable: ${iso}`)
  return ms
}

// Convert fixture rows to contract documents — decoding through the domain
// schemas validates the fixtures against the real contract, not a hand-copy.
const entryDocOf = (raw: RawEntry) =>
  Schema.decodeUnknownSync(EntryDocument)({
    householdId: raw.householdId,
    childId: raw.childId,
    authorId: raw.authorId,
    rawTranscript: raw.rawTranscript,
    structuredEventIds: raw.structuredEventIds,
    extractionStatus: raw.extractionStatus,
    visibility: raw.visibility,
    ...(raw.photoId !== undefined ? { photoId: raw.photoId } : {}),
    createdAt: isoMs(raw.createdAt),
    _id: raw._id,
    _creationTime: isoMs(raw._creationTime),
  })

const eventDocOf = (raw: RawEvent) =>
  Schema.decodeUnknownSync(EventDocument)({
    householdId: raw.householdId,
    childId: raw.childId,
    category: raw.category,
    timestamp: isoMs(raw.timestamp),
    ...(raw.payload !== undefined ? { payload: raw.payload } : {}),
    confidence: raw.confidence,
    _id: raw._id,
    _creationTime: isoMs(raw._creationTime),
  })

const revisionDocOf = (raw: RawRevision): CatchUpRevision => ({
  ...Schema.decodeUnknownSync(EventRevisionStruct)({
    householdId: raw.householdId,
    childId: raw.childId,
    supersedesEventId: raw.supersedesEventId,
    category: raw.category,
    timestamp: isoMs(raw.timestamp),
    ...(raw.payload !== undefined ? { payload: raw.payload } : {}),
    confidence: raw.confidence,
    actorId: raw.actorId,
    ...(raw.note !== undefined ? { note: raw.note } : {}),
    createdAt: isoMs(raw.createdAt),
  }),
  id: raw.id,
})

const entryDocs = historyFixture.entries.map(entryDocOf)
const eventDocs = historyFixture.events.map(eventDocOf)
const revisionDocs = historyFixture.revisions.map(revisionDocOf)

// The child's householdId — scope of the fail-closed grant check.
const childDocs = historyFixture.children.map((child) =>
  Schema.decodeUnknownSync(ChildDocument)({
    householdId: child.householdId,
    name: child.name,
    createdAt: isoMs(child.createdAt),
    _id: child._id,
    _creationTime: isoMs(child._creationTime),
  }),
)
const householdByChildId = new Map<string, string>(
  childDocs.map((child) => [child._id, child.householdId]),
)

const eventsById = new Map(eventDocs.map((event) => [event._id, event]))

const catchUpEntries: CatchUpEntry[] = entryDocs.map((entry) => ({
  entry,
  events: entry.structuredEventIds.flatMap((eventId) => {
    const event = eventsById.get(eventId)
    if (event === undefined) throw new Error(`fixture event ${eventId} not found (entry ${entry._id})`)
    return [event]
  }),
}))

const grants: CatchUpGrants = {
  canRead: (readerId, householdId) => (grantsFixture.memberships[readerId] ?? []).includes(householdId),
}

// Verbatim source of truth for AC-01's raw-transcript assertion.
const transcriptByEntryId = new Map(
  historyFixture.entries.map((entry) => [entry._id, entry.rawTranscript]),
)

/** AC-10's injected policy: America/New_York fall-back via fixed offsets (no tz database). */
const dstFallbackDayKey: DayKeyOf = (epochMs) => {
  const offsetMinutes = epochMs < Date.parse("2026-11-01T06:00:00Z") ? -240 : -300
  return new Date(epochMs + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

const dayKeyOfFor = (fixtureCase: CatchupCase): DayKeyOf =>
  fixtureCase.expected.dayKeyPolicy === "america-new-york-fallback" ? dstFallbackDayKey : utcDayKey

const caseById = (caseId: string): CatchupCase => {
  const found = casesFixture.cases.find((fixtureCase) => fixtureCase.caseId === caseId)
  if (found === undefined) throw new Error(`fixture case ${caseId} not found in cases.json`)
  return found
}

/** Fixture expectations are heterogeneous per case — a referenced field must
 * be present; never assert against undefined. */
const req = <T>(value: T | undefined, caseId: string, field: string): T => {
  if (value === undefined) throw new Error(`${caseId} fixture is missing expected.${field}`)
  return value
}

const runCase = (fixtureCase: CatchupCase): CatchUpReport | CatchUpError => {
  const householdId = householdByChildId.get(fixtureCase.childId)
  if (householdId === undefined) throw new Error(`fixture child ${fixtureCase.childId} not found`)
  const input = Schema.decodeUnknownSync(CatchUpQueryInput)({
    childId: fixtureCase.childId,
    readerId: fixtureCase.readerId,
    now: isoMs(fixtureCase.nowIso),
    horizonDays: fixtureCase.horizonDays,
  })
  const history: CatchUpHistory = {
    householdId,
    readerLastSeenAt: fixtureCase.watermarkIso === null ? undefined : isoMs(fixtureCase.watermarkIso),
    entries: catchUpEntries,
    revisions: revisionDocs,
  }
  return computeCatchUp(input, history, grants, dayKeyOfFor(fixtureCase))
}

const isReport = (result: CatchUpReport | CatchUpError): result is CatchUpReport => !("_tag" in result)

const reportOf = (result: CatchUpReport | CatchUpError): CatchUpReport => {
  if (!isReport(result)) throw new Error(`expected a CatchUpReport, got ${JSON.stringify(result)}`)
  return result
}

const errorOf = (result: CatchUpReport | CatchUpError): CatchUpError => {
  if (isReport(result)) throw new Error("expected a CatchUpError, got a report")
  return result
}

const serializedOf = (value: unknown): string => JSON.stringify(value)

describe("AC-01 first-time reader over 20d history clips to the horizon", () => {
  test("windowStart = now−14d, clipped, all items new/late with verbatim sources, coverage + confirmation present", () => {
    const fixtureCase = caseById("AC-01")
    const report = reportOf(runCase(fixtureCase))
    expect(report.windowStart).toBe(isoMs(fixtureCase.expected.windowStartIso ?? ""))
    expect(report.horizonClipped).toBe(true)
    expect(report.allCaughtUp).toBe(false)
    expect(report.items.map((item) => item.kind)).toEqual(req(fixtureCase.expected.kinds, "AC-01", "kinds"))
    expect(report.items.map((item) => item.entryId)).toEqual(
      req(fixtureCase.expected.expectedItemEntryIds, "AC-01", "expectedItemEntryIds"),
    )
    for (const item of report.items) {
      expect(item.source.rawTranscript.length).toBeGreaterThan(0)
      // Verbatim: exactly the fixture transcript, never a paraphrase.
      const expectedTranscript = transcriptByEntryId.get(item.entryId)
      if (expectedTranscript === undefined) throw new Error(`no fixture transcript for ${item.entryId}`)
      expect(item.source.rawTranscript).toBe(expectedTranscript)
    }
    expect(report.coverageDays.length).toBeGreaterThan(0)
    const expectedCounts = req(fixtureCase.expected.counts, "AC-01", "counts")
    expect(report.confirmation).toEqual({
      confirmedEvents: expectedCounts.confirmedEvents,
      inferredEvents: expectedCounts.inferredEvents,
    })
    expect(report.gapDays).toBe(expectedCounts.gapDays)
  })
})

describe("AC-02 strictly-after watermark rule", () => {
  test("entries before/at W are not new items; the at-W boundary entry is excluded; after-W entries are included", () => {
    const fixtureCase = caseById("AC-02")
    const report = reportOf(runCase(fixtureCase))
    expect(report.items.map((item) => item.kind)).toEqual(req(fixtureCase.expected.kinds, "AC-02", "kinds"))
    expect(report.items.map((item) => item.entryId)).toEqual(
      req(fixtureCase.expected.expectedItemEntryIds, "AC-02", "expectedItemEntryIds"),
    )
    const watermarkMs = isoMs(fixtureCase.watermarkIso ?? "")
    for (const item of report.items) {
      if (item.kind === "new" || item.kind === "late") {
        expect(item.entryCreatedAt).toBeGreaterThan(watermarkMs)
      }
    }
    expect(report.items.some((item) => item.entryId === fixtureCase.expected.boundaryExcludedEntryId)).toBe(false)
  })
})

describe("AC-03 late recording detection", () => {
  test("event of Sep 8 recorded Sep 10: kind late, daysLate 2, occurredAt = Sep 8 event ts", () => {
    const fixtureCase = caseById("AC-03")
    const lateSpec = fixtureCase.expected.lateSpec
    if (lateSpec === undefined) throw new Error("AC-03 fixture is missing lateSpec")
    const report = reportOf(runCase(fixtureCase))
    const lateItem = report.items.find((item) => item.entryId === lateSpec.entryId)
    expect(lateItem?.kind).toBe("late")
    expect(lateItem?.daysLate).toBe(lateSpec.daysLate)
    expect(lateItem?.occurredAt).toBe(isoMs(lateSpec.occurredAtIso))
    expect(lateItem?.entryCreatedAt).toBe(isoMs(lateSpec.recordedAtIso))
  })
})

describe("AC-04 in-window correction surfaces on the original entry", () => {
  test("kind corrected, originalEventId/revisionIds/correctedBy set, events show revised values, source keeps transcript", () => {
    const fixtureCase = caseById("AC-04")
    const spec = fixtureCase.expected.correctedSpec
    if (spec === undefined) throw new Error("AC-04 fixture is missing correctedSpec")
    const report = reportOf(runCase(fixtureCase))
    const corrected = report.items.find((item) => item.kind === "corrected")
    expect(corrected?.entryId).toBe(spec.entryId)
    expect(corrected?.originalEventId).toBe(spec.originalEventId)
    expect(corrected?.revisionIds).toEqual(spec.revisionIds)
    expect(corrected?.correctedBy).toBe(spec.correctedBy)
    const revised = corrected?.events[0]
    expect(revised?.payload).toEqual(spec.revisedPayload)
    expect(revised?.confidence).toBe(spec.revisedConfidence)
    expect(corrected?.source.entryId).toBe(spec.entryId)
    expect(corrected?.source.rawTranscript).toBe(transcriptByEntryId.get(spec.entryId))
  })
})

describe("AC-05 pre-watermark correction stays silent", () => {
  test("same revision but R before W: no corrected item, referenced ids absent from output", () => {
    const fixtureCase = caseById("AC-05")
    const report = reportOf(runCase(fixtureCase))
    expect(report.items.filter((item) => item.kind === "corrected")).toHaveLength(
      fixtureCase.expected.correctedItemCount ?? 0,
    )
    expect(report.items.map((item) => item.entryId)).toEqual(
      req(fixtureCase.expected.expectedItemEntryIds, "AC-05", "expectedItemEntryIds"),
    )
    const serialized = serializedOf(report)
    for (const absent of fixtureCase.expected.absentFromOutput ?? []) {
      expect(serialized).not.toContain(absent)
    }
  })
})

describe("AC-06 drafts never surface", () => {
  test("draft entries inside the window appear nowhere in the report", () => {
    const fixtureCase = caseById("AC-06")
    const report = reportOf(runCase(fixtureCase))
    const serialized = serializedOf(report)
    for (const draftId of fixtureCase.expected.draftEntryIds ?? []) {
      expect(serialized).not.toContain(draftId)
    }
    // The published set is unaffected by the drafts' presence.
    expect(report.items.map((item) => item.kind)).toEqual(req(fixtureCase.expected.kinds, "AC-06", "kinds"))
  })
})

describe("AC-07 fail-closed authorization", () => {
  test("reader without a grant: { _tag: UnauthorizedReader } and NOTHING else", () => {
    const fixtureCase = caseById("AC-07")
    const error = errorOf(runCase(fixtureCase))
    expect(error._tag).toBe(req(fixtureCase.expected.errorTag, "AC-07", "errorTag"))
    expect(Object.keys(error)).toEqual(["_tag"])
  })
})

describe("AC-08 no cross-household leakage", () => {
  test("every source.entryId resolves under the reader's grants; the foreign entry appears nowhere", () => {
    const fixtureCase = caseById("AC-08")
    const report = reportOf(runCase(fixtureCase))
    const householdId = householdByChildId.get(fixtureCase.childId)
    if (householdId === undefined) throw new Error(`fixture child ${fixtureCase.childId} not found`)
    const visibleEntryIds = new Set(
      entryDocs
        .filter((entry) => entry.householdId === householdId && entry.visibility === "published")
        .map((entry) => entry._id),
    )
    for (const item of report.items) {
      expect(visibleEntryIds.has(item.source.entryId)).toBe(true)
    }
    const serialized = serializedOf(report)
    for (const absent of fixtureCase.expected.absentFromOutput ?? []) {
      expect(serialized).not.toContain(absent)
    }
  })
})

describe("AC-09 gap disclosure", () => {
  test("gapDays correct, coverageDays lists zero-entry days, exact disclosure string, no 'no care' phrasing", () => {
    const fixtureCase = caseById("AC-09")
    const report = reportOf(runCase(fixtureCase))
    expect(report.items.map((item) => item.entryId)).toEqual(
      req(fixtureCase.expected.expectedItemEntryIds, "AC-09", "expectedItemEntryIds"),
    )
    expect(report.gapDays).toBe(req(fixtureCase.expected.gapDayCount, "AC-09", "gapDayCount"))
    expect(report.coverageDays.length).toBe(req(fixtureCase.expected.coverageDayCount, "AC-09", "coverageDayCount"))
    for (const gapDay of fixtureCase.expected.gapDayKeys ?? []) {
      const bucket = report.coverageDays.find((day) => day.day === gapDay)
      expect(bucket?.publishedEntryCount).toBe(0)
    }
    expect(gapDisclosure(report.coverageDays)).toBe(req(fixtureCase.expected.disclosure, "AC-09", "disclosure"))
    // Absence of logs never reads as absence of care.
    const serialized = serializedOf(report).toLowerCase()
    expect(serialized).not.toContain("no care")
    expect(serialized).not.toContain("nothing happened")
  })
})

describe("AC-10 DST fall-back day bucketing", () => {
  test("05:00Z and 06:00Z both bucket to 2026-11-01; single bucket, no 23/25h skew", () => {
    const fixtureCase = caseById("AC-10")
    expect(fixtureCase.expected.singleBucketDay).toBeDefined()
    const singleBucketDay = req(fixtureCase.expected.singleBucketDay, "AC-10", "singleBucketDay")
    const report = reportOf(runCase(fixtureCase))
    expect(report.items.map((item) => item.entryId)).toEqual(
      req(fixtureCase.expected.expectedItemEntryIds, "AC-10", "expectedItemEntryIds"),
    )
    // The injected policy buckets both instants to the same local day.
    expect(dstFallbackDayKey(isoMs("2026-11-01T05:00:00Z"))).toBe(singleBucketDay)
    expect(dstFallbackDayKey(isoMs("2026-11-01T06:00:00Z"))).toBe(singleBucketDay)
    expect(report.coverageDays.length).toBe(req(fixtureCase.expected.coverageDayCount, "AC-10", "coverageDayCount"))
    const buckets = report.coverageDays.filter((day) => day.day === singleBucketDay)
    expect(buckets).toHaveLength(1)
    expect(buckets[0]?.publishedEntryCount).toBe(req(fixtureCase.expected.singleBucketCount, "AC-10", "singleBucketCount"))
  })
})

describe("AC-11 fully caught up", () => {
  test("items [], allCaughtUp true, coverageDays still non-empty", () => {
    const fixtureCase = caseById("AC-11")
    const report = reportOf(runCase(fixtureCase))
    expect(report.items).toHaveLength(0)
    expect(report.allCaughtUp).toBe(true)
    expect(report.coverageDays.length).toBe(req(fixtureCase.expected.coverageDayCount, "AC-11", "coverageDayCount"))
    expect(report.coverageDays.length).toBeGreaterThan(0)
  })
})

describe("AC-12 monotonic idempotent watermark advance", () => {
  test("advance(undefined, t2) = t2; advance(t2, t1<t2) stays t2; same-at advance is a no-op", () => {
    const spec = caseById("AC-12").expected.advanceSpec
    if (spec === undefined) throw new Error("AC-12 fixture is missing advanceSpec")
    const t1 = isoMs(spec.t1Iso)
    const t2 = isoMs(spec.t2Iso)
    const advanced = advanceReadState(undefined, t2)
    expect(advanced).toBe(t2)
    expect(advanceReadState(advanced, t1)).toBe(t2)
    expect(advanceReadState(t2, t2)).toBe(t2)
  })
})

describe("AC-13 horizon clip suppresses pre-window corrections", () => {
  test("windowStart = now−horizon (not the watermark), clipped, pre-window revisions absent", () => {
    const fixtureCase = caseById("AC-13")
    const expectedKinds = fixtureCase.expected.kinds
    const expectedEntryIds = fixtureCase.expected.expectedItemEntryIds
    if (expectedKinds === undefined || expectedEntryIds === undefined) {
      throw new Error("AC-13 fixture is missing kinds/expectedItemEntryIds")
    }
    const report = reportOf(runCase(fixtureCase))
    expect(report.windowStart).toBe(isoMs(fixtureCase.expected.windowStartIso ?? ""))
    expect(report.horizonClipped).toBe(true)
    expect(report.items.map((item) => item.kind)).toEqual(expectedKinds)
    expect(report.items.map((item) => item.entryId)).toEqual(expectedEntryIds)
    expect(report.items.some((item) => item.kind === "corrected")).toBe(false)
    const serialized = serializedOf(report)
    for (const absent of fixtureCase.expected.absentFromOutput ?? []) {
      expect(serialized).not.toContain(absent)
    }
  })
})

describe("AC-14 contract round-trip", () => {
  test("encodeSync(CatchUpReport) -> decodeUnknownSync -> deep-equal the original", () => {
    const report = reportOf(runCase(caseById("AC-14")))
    const encoded = Schema.encodeSync(CatchUpReport)(report)
    const decoded = Schema.decodeUnknownSync(CatchUpReport)(encoded)
    expect(decoded).toEqual(report)
  })
})
