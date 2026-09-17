import { Schema } from "effect"

import { EventCategory, EventFields } from "./event.js"
import { convexId } from "./ids.js"
import type { EntryDocument } from "./entry.js"
import type { Event, EventDocument } from "./event.js"

/**
 * Since-last-seen caregiver catch-up — contract delta v0.1 (additive).
 *
 * Design, rationale, and acceptance cases: art_6qhBut41 ("Since-Last-Seen
 * Catch-Up — Design, Contract Delta v0.1, Acceptance Cases v1"). This file
 * implements the published delta; no existing schema file changes.
 *
 * Conventions (merged codebase): unix-ms numbers on the wire, convexId(table)
 * annotations for the Convex adapter, Schema.optionalKey for absent-key
 * optionals, types inferred via Schema.Schema.Type. Domain code never imports
 * Convex validators and never reads the wall clock — `now` is injected.
 */

// --- reader read state (watermark) -----------------------------------------

export const CaregiverReadStateFields = {
  caregiverId: Schema.NonEmptyString, // external identity (flat model — no members table until slot 19)
  childId: convexId("children"),
  lastSeenAt: Schema.Number, // unix ms; monotonic, never decreases
} satisfies Schema.Struct.Fields

// --- query ------------------------------------------------------------------

export const CatchUpQueryInput = Schema.Struct({
  childId: convexId("children"),
  readerId: Schema.NonEmptyString,
  now: Schema.Number, // injected clock — no Date.now() inside the reducer
  horizonDays: Schema.optionalKey(Schema.Int), // default 14, max 30
})
export type CatchUpQueryInput = typeof CatchUpQueryInput["Type"]

// --- report -----------------------------------------------------------------

export type CatchUpItemKind = "new" | "late" | "corrected"

export const CatchUpSource = Schema.Struct({
  entryId: convexId("entries"),
  rawTranscript: Schema.NonEmptyString, // verbatim, preserved
  photoId: Schema.optionalKey(Schema.String),
  eventIds: Schema.Array(convexId("events")),
  revisionIds: Schema.Array(convexId("eventRevisions")), // empty except kind "corrected"
  authorId: Schema.String,
})
export type CatchUpSource = typeof CatchUpSource["Type"]

export const CatchUpItem = Schema.Struct({
  kind: Schema.Literals(["new", "late", "corrected"]),
  entryId: convexId("entries"),
  entryCreatedAt: Schema.Number, // = recordedAt on the wire
  occurredAt: Schema.optionalKey(Schema.Number), // earliest event timestamp in the entry; absent for eventless entries
  daysLate: Schema.optionalKey(Schema.Int), // present iff kind "late" (local-day difference)
  originalEventId: Schema.optionalKey(convexId("events")), // present iff kind "corrected"
  revisionIds: Schema.Array(convexId("eventRevisions")),
  correctedBy: Schema.optionalKey(Schema.String), // actorId of the supersession
  events: Schema.Array(Schema.Struct(EventFields)), // decoded canonical events as they stand now
  source: CatchUpSource,
})
export type CatchUpItem = typeof CatchUpItem["Type"]

export const CoverageDay = Schema.Struct({
  day: Schema.String, // "YYYY-MM-DD" local-day key
  publishedEntryCount: Schema.Number,
})
export type CoverageDay = typeof CoverageDay["Type"]

export const CatchUpReport = Schema.Struct({
  childId: convexId("children"),
  readerId: Schema.NonEmptyString,
  generatedAt: Schema.Number,
  windowStart: Schema.Number, // max(watermark, now − horizon)
  windowEnd: Schema.Number, // now
  watermark: Schema.Number, // the lastSeenAt the report was computed from (0 for a first-time reader)
  allCaughtUp: Schema.Boolean,
  items: Schema.Array(CatchUpItem),
  coverageDays: Schema.Array(CoverageDay), // every local day in window, zero-entry days included
  gapDays: Schema.Number, // count of coverageDays with publishedEntryCount === 0
  horizonClipped: Schema.Boolean,
  confirmation: Schema.Struct({
    confirmedEvents: Schema.Number, // confidence === 1 (caregiver-confirmed per contract v0.2)
    inferredEvents: Schema.Number, // confidence < 1 (extractor guess)
  }),
})
export type CatchUpReport = typeof CatchUpReport["Type"]

// --- watermark advance --------------------------------------------------------

export const AdvanceReadStateInput = Schema.Struct({
  caregiverId: Schema.NonEmptyString,
  childId: convexId("children"),
  at: Schema.Number,
})
export type AdvanceReadStateInput = typeof AdvanceReadStateInput["Type"]

// --- EventRevision (proposal, coordinated — not landed as a table here) ------

/**
 * PROPOSAL for the v0.3-fold owner (slot 10) to reconcile — fixtures and the
 * reducer consume this shape in this slice; there is NO eventRevisions table
 * and no Convex persistence. Corrected-item persistence waits for that fold
 * (see the TODO in backend/convex/convex/catchup.ts).
 */
export const EventRevisionFields = {
  householdId: convexId("households"),
  childId: convexId("children"),
  supersedesEventId: convexId("events"),
  category: EventCategory,
  timestamp: Schema.Number,
  payload: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  actorId: Schema.String, // who corrected (attribution)
  note: Schema.optionalKey(Schema.NonEmptyString),
  createdAt: Schema.Number,
} satisfies Schema.Struct.Fields
export const EventRevisionStruct = Schema.Struct(EventRevisionFields)
export type EventRevision = typeof EventRevisionStruct["Type"]

// --- deterministic reducer ------------------------------------------------------

const DEFAULT_HORIZON_DAYS = 14
const MAX_HORIZON_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/** Local-day policy injected by the caller; the default is the UTC day key. */
export type DayKeyOf = (epochMs: number) => string

export const utcDayKey: DayKeyOf = (epochMs) => new Date(epochMs).toISOString().slice(0, 10)

/** Calendar-day difference between two "YYYY-MM-DD" keys (offset-independent). */
const dayKeyDiff = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)

const nextDayKey = (day: string): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)

/** One entry plus the event documents linked to it (its structuredEventIds resolved). */
export interface CatchUpEntry {
  entry: EntryDocument
  events: EventDocument[]
}

/**
 * Fixture/reducer-level revision record: the EventRevision proposal plus its
 * table id (which only exists once the eventRevisions table lands at the fold).
 */
export type CatchUpRevision = EventRevision & { id: string }

export interface CatchUpHistory {
  /** The child's householdId — scope of the fail-closed grant check (history may span households defensively). */
  householdId: string
  /** The reader's stored watermark for this child; undefined for a first-time reader (treated as 0). */
  readerLastSeenAt: number | undefined
  entries: CatchUpEntry[]
  /** Supersession proposals — no backend table in this slice (v0.3 fold / slot 10 owns it). */
  revisions: CatchUpRevision[]
}

export interface CatchUpGrants {
  canRead: (readerId: string, householdId: string) => boolean
}

/** Fail-closed typed errors: no partial output rides on either tag. */
export type CatchUpError = { _tag: "UnauthorizedReader" } | { _tag: "HorizonExceeded" }

/** Canonical event value — system fields stripped to the EventFields contract. */
const eventValueOf = (doc: EventDocument): Event => {
  const { _id: _eventId, _creationTime: _eventCreationTime, ...value } = doc
  return value
}

/** The original entry's citations: verbatim transcript, events, photo, author. */
const sourceOf = (entry: EntryDocument, events: EventDocument[], revisionIds: string[]): CatchUpSource => ({
  entryId: entry._id,
  rawTranscript: entry.rawTranscript,
  ...(entry.photoId !== undefined ? { photoId: entry.photoId } : {}),
  eventIds: events.map((event) => event._id),
  revisionIds,
  authorId: entry.authorId,
})

/** New / late item: a published unseen entry with its events as they stand now. */
const seenItemFor = (entry: EntryDocument, events: EventDocument[], dayKeyOf: DayKeyOf): CatchUpItem => {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
  const earliest = sorted[0]
  const occurredAt = earliest?.timestamp
  // Late: the earliest event's local day is before the capture day (AC-03).
  const isLate = occurredAt !== undefined && dayKeyOf(occurredAt) < dayKeyOf(entry.createdAt)
  return {
    kind: isLate ? "late" : "new",
    entryId: entry._id,
    entryCreatedAt: entry.createdAt,
    ...(occurredAt !== undefined ? { occurredAt } : {}),
    ...(isLate && occurredAt !== undefined
      ? { daysLate: dayKeyDiff(dayKeyOf(occurredAt), dayKeyOf(entry.createdAt)) }
      : {}),
    revisionIds: [],
    events: sorted.map(eventValueOf),
    source: sourceOf(entry, sorted, []),
  }
}

/**
 * Corrected item: an in-window supersession of an event the reader already
 * saw. `event` is the current canonical (post-revision) value as stored; the
 * v0.3 fold (slot 10) owns applying revisions to stored events.
 */
const correctedItemFor = (
  entry: EntryDocument,
  entryEvents: EventDocument[],
  event: EventDocument,
  revisions: CatchUpRevision[],
): CatchUpItem => {
  const ordered = [...revisions].sort((a, b) => a.createdAt - b.createdAt)
  const latest = ordered[ordered.length - 1]
  if (latest === undefined) throw new Error("corrected item requires at least one revision")
  return {
    kind: "corrected",
    entryId: entry._id,
    entryCreatedAt: entry.createdAt,
    occurredAt: event.timestamp,
    originalEventId: event._id,
    revisionIds: ordered.map((revision) => revision.id),
    correctedBy: latest.actorId,
    events: [eventValueOf(event)],
    source: sourceOf(entry, entryEvents, ordered.map((revision) => revision.id)),
  }
}

/**
 * Deterministic catch-up reducer. Pure: no clock, no randomness, no I/O.
 * Item order: new/late by entryCreatedAt ascending, then corrected items by
 * entryCreatedAt ascending — a pure function of the input sets.
 */
export function computeCatchUp(
  input: CatchUpQueryInput,
  history: CatchUpHistory,
  grants: CatchUpGrants,
  dayKeyOf: DayKeyOf = utcDayKey,
): CatchUpReport | CatchUpError {
  // Fail closed FIRST: a reader without grants gets nothing at all — no items,
  // no coverage, no shape that could leak household activity (AC-07, A8).
  if (!grants.canRead(input.readerId, history.householdId)) {
    return { _tag: "UnauthorizedReader" }
  }

  const horizonDays = input.horizonDays ?? DEFAULT_HORIZON_DAYS
  if (horizonDays > MAX_HORIZON_DAYS) {
    return { _tag: "HorizonExceeded" }
  }

  const now = input.now
  const horizonStart = now - horizonDays * DAY_MS
  const watermark = history.readerLastSeenAt ?? 0
  const windowStart = Math.max(watermark, horizonStart)

  // This child's rows only — cross-household entries are excluded everywhere,
  // including the clip check and coverage (AC-08).
  const childEntries = history.entries.filter(
    ({ entry }) => entry.householdId === history.householdId && entry.childId === input.childId,
  )

  // Clipped: an existing watermark pushed before the horizon, or (first-time)
  // history that reaches past the horizon (AC-01, AC-13).
  const horizonClipped =
    history.readerLastSeenAt === undefined
      ? childEntries.some(({ entry }) => entry.createdAt < windowStart)
      : history.readerLastSeenAt < windowStart

  const publishedEntries = childEntries.filter(({ entry }) => entry.visibility === "published")

  // New / late: published entries strictly after the watermark, inside the
  // window [windowStart, now] (AC-01, AC-02 — boundary at exactly W excluded).
  const seenItems = publishedEntries
    .filter(
      ({ entry }) =>
        entry.createdAt > watermark && entry.createdAt >= windowStart && entry.createdAt <= now,
    )
    .sort((a, b) => a.entry.createdAt - b.entry.createdAt)
    .map(({ entry, events }) => seenItemFor(entry, events, dayKeyOf))

  // Corrected: supersessions that landed inside the window on events the
  // reader already saw (their entry existed at/before the watermark and is
  // visible). The horizon clips corrections exactly as it clips new entries:
  // pre-window revisions never surface (AC-04, AC-05, AC-13).
  const byEventId = new Map<string, { entry: EntryDocument; events: EventDocument[]; event: EventDocument }>()
  for (const { entry, events } of childEntries) {
    for (const event of events) {
      byEventId.set(event._id, { entry, events, event })
    }
  }
  const revisionsByEventId = new Map<string, CatchUpRevision[]>()
  for (const revision of history.revisions) {
    if (revision.createdAt < windowStart || revision.createdAt > now) continue
    const group = revisionsByEventId.get(revision.supersedesEventId)
    if (group === undefined) {
      revisionsByEventId.set(revision.supersedesEventId, [revision])
    } else {
      group.push(revision)
    }
  }
  const correctedItems: CatchUpItem[] = []
  for (const [supersededEventId, revisions] of [...revisionsByEventId].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const found = byEventId.get(supersededEventId)
    if (found === undefined) continue // superseded event not in this child's history
    const { entry, events, event } = found
    if (entry.createdAt > watermark) continue // reader has not seen the original yet
    if (entry.visibility !== "published") continue // drafts never surface
    correctedItems.push(correctedItemFor(entry, events, event, revisions))
  }
  correctedItems.sort(
    (a, b) =>
      a.entryCreatedAt - b.entryCreatedAt ||
      (a.originalEventId ?? "").localeCompare(b.originalEventId ?? ""),
  )

  // Coverage: every local day from windowStart through now. Late events count
  // on their CAPTURE day — coverage measures recording activity, not occurrence.
  const publishedCountByDay = new Map<string, number>()
  for (const { entry } of publishedEntries) {
    if (entry.createdAt < windowStart || entry.createdAt > now) continue
    const day = dayKeyOf(entry.createdAt)
    publishedCountByDay.set(day, (publishedCountByDay.get(day) ?? 0) + 1)
  }
  const coverageDays: CoverageDay[] = []
  const lastDay = dayKeyOf(now)
  for (let day = dayKeyOf(windowStart); day <= lastDay; day = nextDayKey(day)) {
    coverageDays.push({ day, publishedEntryCount: publishedCountByDay.get(day) ?? 0 })
  }
  const gapDays = coverageDays.filter((day) => day.publishedEntryCount === 0).length

  // T2 disclosure: confidence split across the events that made the report.
  let confirmedEvents = 0
  let inferredEvents = 0
  for (const item of [...seenItems, ...correctedItems]) {
    for (const event of item.events) {
      if (event.confidence === 1) confirmedEvents += 1
      else inferredEvents += 1
    }
  }

  return {
    childId: input.childId,
    readerId: input.readerId,
    generatedAt: now,
    windowStart,
    windowEnd: now,
    watermark,
    allCaughtUp: seenItems.length === 0 && correctedItems.length === 0,
    items: [...seenItems, ...correctedItems],
    coverageDays,
    gapDays,
    horizonClipped,
    confirmation: { confirmedEvents, inferredEvents },
  }
}

/**
 * Exact disclosure string for zero-entry days (AC-09): "No entries recorded
 * for " + the day list. Absence is phrased only as missing recordings — never
 * as "nothing happened" and never as a welfare conclusion. Empty string when
 * every day in the window has content.
 */
export function gapDisclosure(coverageDays: ReadonlyArray<CoverageDay>): string {
  const gaps = coverageDays.filter((day) => day.publishedEntryCount === 0).map((day) => day.day)
  return gaps.length === 0 ? "" : `No entries recorded for ${gaps.join(", ")}`
}

/** Monotonic watermark advance: max(prev, at); undefined (first-time) -> at. Idempotent by construction (AC-12). */
export function advanceReadState(prev: number | undefined, at: number): number {
  return prev === undefined ? at : Math.max(prev, at)
}
