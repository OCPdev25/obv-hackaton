/**
 * The month-history view builder: pure projection from authorized data to
 * what the month surface shows. Deterministic by construction — no clock
 * reads, no ambient state; the same (monthKey, timeZone, data) always
 * produces the same view.
 *
 * Placement rules (pinned by tests):
 * - Days are bucketed by the household-zone LOCAL calendar; the view contains
 *   every calendar day of the month, so gap days are explicit cells.
 * - Events belong to the day their care happened (Event.timestamp); entries
 *   are attributed with capture metadata ("Captured Sep 20 … about Sep 12").
 * - An entry whose extraction produced no events (failed/pending) appears on
 *   its capture day — capture is never blocked, so its honesty matters.
 * - A correction surfaces on the corrected entry's card with full lineage;
 *   the original text is preserved in the dataset and never destroyed.
 */
import {
  A11Y_ROLES,
  CORRECTION_ORIGINAL_PRESERVED_LABEL,
  DAY_CELL_A11Y_HINT,
  EXTRACTION_FAILED_LABEL,
  GAP_DISCLAIMER,
  captureLabel,
  dayCellA11yLabel,
  entryA11yLabel,
  eventA11yLabel,
  lateLabel,
  monthHeaderA11yLabel,
} from "./a11y.js"
import { buildLineage, latestCorrection } from "./corrections.js"
import type {
  BuildMonthHistoryInput,
  CorrectionLineageView,
  DayCellView,
  EntryCardView,
  EntryViewInput,
  EventCardView,
  EventViewInput,
  MonthGapStatement,
  MonthHistoryView,
} from "./types.js"
import { fullDayLabel, localDateKey, localDateKeysOfMonth, localTimeLabel, monthLabel, zonedMonthBounds } from "./zone.js"

export { entryA11yLabel, eventA11yLabel }

/** Adapt a canonical domain EntryDocument to the view input (field rename only). */
export function entryViewInputFromDocument(document: {
  readonly _id: string
  readonly householdId: string
  readonly childId: string
  readonly authorId: string
  readonly rawTranscript: string
  readonly structuredEventIds: readonly string[]
  readonly extractionStatus: "pending" | "structured" | "failed"
  readonly visibility: "draft" | "published"
  readonly createdAt: number
}): EntryViewInput {
  return {
    entryId: document._id,
    householdId: document.householdId,
    childId: document.childId,
    authorId: document.authorId,
    rawTranscript: document.rawTranscript,
    structuredEventIds: document.structuredEventIds,
    extractionStatus: document.extractionStatus,
    visibility: document.visibility,
    createdAt: document.createdAt,
  }
}

/** Adapt a canonical domain EventDocument to the view input (field rename only). */
export function eventViewInputFromDocument(document: {
  readonly _id: string
  readonly householdId: string
  readonly childId: string
  readonly category: EventViewInput["category"]
  readonly timestamp: number
  readonly payload?: Readonly<Record<string, number>>
  readonly confidence: number
}): EventViewInput {
  return {
    eventId: document._id,
    householdId: document.householdId,
    childId: document.childId,
    category: document.category,
    timestamp: document.timestamp,
    payload: document.payload,
    confidence: document.confidence,
  }
}

interface EntryCardCore {
  readonly entry: EntryViewInput
  readonly corrected: boolean
  readonly transcript: string
  readonly lineage?: CorrectionLineageView
}

export function buildMonthHistoryView(input: BuildMonthHistoryInput): MonthHistoryView {
  const { monthKey, timeZone } = input
  const bounds = zonedMonthBounds(monthKey, timeZone)
  const lineage = buildLineage(input.corrections ?? [])
  const authorName = (authorId: string): string => input.authors[authorId] ?? authorId

  const entryById = new Map<string, EntryViewInput>(input.entries.map((entry) => [entry.entryId, entry]))
  const entryIdByEventId = new Map<string, string>()
  for (const entry of input.entries) {
    for (const eventId of entry.structuredEventIds) entryIdByEventId.set(eventId, entry.entryId)
  }
  // Claim universe: every entry in scope (visible or not). Events claimed by
  // in-scope-but-invisible entries are excluded without counting as orphans.
  const scopeEntries = input.scopeEntries ?? input.entries
  const scopeClaimedEventIds = new Set<string>(scopeEntries.flatMap((entry) => entry.structuredEventIds))

  const cardFor = (entry: EntryViewInput): EntryCardCore => {
    const lin = lineage.get(entry.entryId)
    const latest = latestCorrection(lin)
    if (!lin || !latest) return { entry, corrected: false, transcript: entry.rawTranscript }
    return {
      entry,
      corrected: true,
      transcript: latest.replacementTranscript,
      lineage: {
        originalEntryId: entry.entryId,
        steps: lin.chain.map((correction) => ({
          correctionId: correction.correctionId,
          byName: authorName(correction.correctedBy),
          createdAtMs: correction.createdAtMs,
          createdAtLabel: `${fullDayLabel(localDateKey(correction.createdAtMs, timeZone))} at ${localTimeLabel(correction.createdAtMs, timeZone)}`,
          reason: correction.reason,
          supersedesCorrectionId: correction.supersedesCorrectionId,
        })),
        latestTranscript: latest.replacementTranscript,
        originalPreservedLabel: CORRECTION_ORIGINAL_PRESERVED_LABEL,
      },
    }
  }

  // Events of the month, bucketed by household-zone local date.
  const eventsInMonth = input.events
    .filter((event) => event.timestamp >= bounds.startMs && event.timestamp < bounds.endMsExclusive)
    .sort((a, b) => a.timestamp - b.timestamp || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0))
  const eventsByDay = new Map<string, EventViewInput[]>()
  let orphanEventCount = 0
  let hiddenEventCount = 0
  for (const event of eventsInMonth) {
    if (!scopeClaimedEventIds.has(event.eventId)) orphanEventCount += 1
    else if (!entryIdByEventId.has(event.eventId)) hiddenEventCount += 1
    const key = localDateKey(event.timestamp, timeZone)
    const bucket = eventsByDay.get(key) ?? []
    bucket.push(event)
    eventsByDay.set(key, bucket)
  }

  // Entries with in-month events appear on every day their care happened;
  // entries with no in-month events appear on their capture day (if in-month).
  const entryDays = new Map<string, Set<string>>()
  for (const event of eventsInMonth) {
    const entryId = entryIdByEventId.get(event.eventId)
    if (entryId === undefined) continue
    const days = entryDays.get(entryId) ?? new Set<string>()
    days.add(localDateKey(event.timestamp, timeZone))
    entryDays.set(entryId, days)
  }
  const dayKeySet = new Set(localDateKeysOfMonth(monthKey, timeZone))
  const entriesByDay = new Map<string, EntryCardCore[]>()
  const placeEntry = (core: EntryCardCore, dateKey: string): void => {
    const bucket = entriesByDay.get(dateKey) ?? []
    if (!bucket.some((existing) => existing.entry.entryId === core.entry.entryId)) bucket.push(core)
    entriesByDay.set(dateKey, bucket)
  }
  for (const entry of input.entries) {
    const days = entryDays.get(entry.entryId)
    if (days && days.size > 0) {
      for (const dateKey of days) placeEntry(cardFor(entry), dateKey)
      continue
    }
    const captureKey = localDateKey(entry.createdAt, timeZone)
    if (dayKeySet.has(captureKey)) placeEntry(cardFor(entry), captureKey)
  }

  const days: DayCellView[] = []
  const gapDays: string[] = []
  let lateEvents = 0
  for (const dateKey of localDateKeysOfMonth(monthKey, timeZone)) {
    const dayEvents: EventCardView[] = []
    for (const event of eventsByDay.get(dateKey) ?? []) {
      const entryId = entryIdByEventId.get(event.eventId)
      if (entryId === undefined) continue // orphan: counted, never silently dropped
      const entry = entryById.get(entryId)
      if (entry === undefined) continue // event of an entry this principal cannot see
      const core = cardFor(entry)
      const captureKey = localDateKey(entry.createdAt, timeZone)
      const isLate = captureKey !== dateKey
      if (isLate) lateEvents += 1
      const day = fullDayLabel(dateKey)
      const capturedAt = captureLabel(entry.createdAt, timeZone, fullDayLabel(captureKey))
      const time = localTimeLabel(event.timestamp, timeZone)
      dayEvents.push({
        eventId: event.eventId,
        category: event.category,
        occurredAtMs: event.timestamp,
        localDateKey: dateKey,
        localTimeLabel: time,
        payload: event.payload,
        confidence: event.confidence,
        authorId: entry.authorId,
        authorName: authorName(entry.authorId),
        entryId: entry.entryId,
        captureDateKey: captureKey,
        captureLabel: capturedAt,
        isLate,
        lateLabel: isLate ? lateLabel(fullDayLabel(captureKey), day) : undefined,
        corrected: core.corrected,
        a11yLabel: eventA11yLabel({
          category: event.category,
          localTimeLabel: time,
          authorName: authorName(entry.authorId),
          isLate,
          captureLabel: capturedAt,
          corrected: core.corrected,
        }),
      })
    }
    const dayEntries: EntryCardView[] = (entriesByDay.get(dateKey) ?? []).map((core) => {
      const captureKey = localDateKey(core.entry.createdAt, timeZone)
      const capturedAt = captureLabel(core.entry.createdAt, timeZone, fullDayLabel(captureKey))
      return {
        entryId: core.entry.entryId,
        authorId: core.entry.authorId,
        authorName: authorName(core.entry.authorId),
        visibility: core.entry.visibility,
        transcript: core.transcript,
        captureDateKey: captureKey,
        captureLabel: capturedAt,
        extractionStatus: core.entry.extractionStatus,
        extractionStatusLabel: core.entry.extractionStatus === "failed" ? EXTRACTION_FAILED_LABEL : undefined,
        corrected: core.corrected,
        correctionLineage: core.lineage,
        a11yLabel: entryA11yLabel({
          authorName: authorName(core.entry.authorId),
          captureLabel: capturedAt,
          transcript: core.transcript,
          corrected: core.corrected,
        }),
      }
    })
    const entryCount = dayEntries.length
    const eventCount = dayEvents.length
    const state = entryCount > 0 ? "has-entries" : "no-entries"
    if (state === "no-entries") gapDays.push(dateKey)
    const dayLabel = fullDayLabel(dateKey)
    days.push({
      dateKey,
      dayLabel,
      entryCount,
      eventCount,
      state,
      events: dayEvents,
      entries: dayEntries,
      a11yLabel: dayCellA11yLabel({
        dayLabel,
        entryCount,
        eventCount,
        correctedCount: dayEntries.filter((entry) => entry.corrected).length,
      }),
      a11yRole: A11Y_ROLES.dayCell,
      a11yHint: DAY_CELL_A11Y_HINT,
    })
  }

  // Month-scoped totals: only entries actually placed in a day cell count.
  const placedEntryIds = new Set<string>(days.flatMap((day) => day.entries.map((entry) => entry.entryId)))
  const correctedEntries = [...placedEntryIds].filter((entryId) => lineage.has(entryId)).length
  const totalEntries = placedEntryIds.size
  const totalEvents = eventsInMonth.length - orphanEventCount - hiddenEventCount
  const gap: MonthGapStatement =
    totalEntries === 0
      ? {
          kind: "empty-month",
          message: `No entries were recorded this month. ${GAP_DISCLAIMER}`,
          gapDays: [...dayKeySet],
          disclaimer: GAP_DISCLAIMER,
        }
      : gapDays.length === 0
        ? {
            kind: "no-gaps",
            message: "Every day this month has at least one entry recorded.",
            gapDays: [],
            disclaimer: GAP_DISCLAIMER,
          }
        : {
            kind: "gaps",
            message: `${gapDays.length} of ${days.length} days have no entries recorded. ${GAP_DISCLAIMER}`,
            gapDays,
            disclaimer: GAP_DISCLAIMER,
          }

  return {
    monthKey,
    timeZone,
    monthLabel: monthLabel(monthKey),
    headerA11yLabel: monthHeaderA11yLabel(monthLabel(monthKey)),
    bounds,
    days,
    totalEntries,
    totalEvents,
    lateEvents,
    correctedEntries,
    orphanEventCount,
    gap,
  }
}
