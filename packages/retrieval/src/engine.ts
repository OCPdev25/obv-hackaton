import { Schema } from "effect"

import type { Entry, Event } from "@journal/domain"

import type { JournalCorpus } from "./corpus.js"
import {
  HistoryQueryAnswer,
  HistoryQueryInput,
  type AmbiguityCandidate,
  type AnswerCoverage,
  type AnswerCitation,
  type AnswerNotice,
  type ConflictClaim,
  type HistoryQueryInput as Input,
  type HistoryQueryPlan as Plan,
  type QueryWindow as Window,
} from "./queryContracts.js"
import { compilePlan, localDayStartUtcMs, addLocalDays } from "./resolve.js"

/**
 * Read-only query executor: plan in, contract-shaped answer out — over the
 * synthetic corpus only, with no write path of any kind. Answers cite their
 * sources and disclose corrections, author conflicts, and coverage gaps
 * rather than presenting an inferred story as complete.
 */

const DAY_MS = 86_400_000
const EXCERPT_LIMIT = 160
const MAX_GAP_SCAN_DAYS = 60

interface Match {
  readonly eventId: string
  readonly event: Event
  readonly record: CorpusRecordRef
}

interface CorpusRecordRef {
  readonly entryId: string
  readonly entry: Entry
  readonly events: readonly Event[]
}

interface CorpusIndex {
  /** eventId -> the record (entry + aligned events) containing it. */
  readonly byEventId: ReadonlyMap<string, Match>
}

const buildIndex = (corpus: JournalCorpus): CorpusIndex => {
  const byEventId = new Map<string, Match>()
  for (const record of corpus.records) {
    const ref: CorpusRecordRef = record
    const ids = record.entry.structuredEventIds
    if (ids.length !== record.events.length) {
      throw new Error(`engine: entry ${record.entryId} has ${ids.length} ids for ${record.events.length} events`)
    }
    for (let i = 0; i < ids.length; i++) {
      const eventId = ids[i]
      const event = record.events[i]
      if (eventId === undefined || event === undefined) {
        throw new Error(`engine: entry ${record.entryId} has misaligned events`)
      }
      byEventId.set(eventId, { eventId, event, record: ref })
    }
  }
  return { byEventId }
}

// ---------------------------------------------------------------------------
// Filtering helpers
// ---------------------------------------------------------------------------

const inWindow = (event: Event, window: Window | undefined): boolean =>
  window === undefined || (event.timestamp >= window.from && event.timestamp < window.to)

const subjectOk = (event: Event, subjectChildId: string | undefined): boolean =>
  subjectChildId === undefined || event.childId === subjectChildId

const keywordOk = (match: Match, keyword: string | undefined): boolean =>
  keyword === undefined || match.record.entry.rawTranscript.toLowerCase().includes(keyword.toLowerCase())

/** Events the plan asks about, superseded events excluded, deterministic order. */
const matchingEvents = (
  plan: Plan,
  corpus: JournalCorpus,
  index: CorpusIndex,
): readonly Match[] => {
  const superseded = new Set(corpus.corrections.map((c) => c.supersedesEventId))
  const window = plan._tag === "last-event" ? undefined : plan.window
  const category = plan._tag === "day-summary" ? undefined : plan.category
  const keyword = plan._tag === "day-summary" ? undefined : plan.keyword

  const matches: Match[] = []
  for (const [eventId, match] of index.byEventId) {
    if (superseded.has(eventId)) continue
    if (!inWindow(match.event, window)) continue
    if (!subjectOk(match.event, plan.subjectChildId)) continue
    if (category !== undefined && match.event.category !== category) continue
    if (!keywordOk(match, keyword)) continue
    matches.push(match)
  }
  matches.sort((a, b) => {
    if (a.event.timestamp !== b.event.timestamp) return a.event.timestamp - b.event.timestamp
    return a.eventId.localeCompare(b.eventId)
  })
  return matches
}

// ---------------------------------------------------------------------------
// Notices: gaps, corrections, conflicts
// ---------------------------------------------------------------------------

/** Local-day starts (asker's zone) that have at least one entry. */
const coveredDays = (corpus: JournalCorpus, timezone: string): ReadonlySet<number> => {
  const days = new Set<number>()
  for (const record of corpus.records) {
    days.add(localDayStartUtcMs(record.entry.createdAt, timezone))
  }
  return days
}

/**
 * Consecutive entry-less local days inside the window, merged into notices.
 * These are the "missing logs disclosed as gaps" — the answer states what
 * the journal does NOT cover instead of answering as if it were complete.
 */
const gapNotices = (window: Window | undefined, corpus: JournalCorpus, timezone: string): readonly AnswerNotice[] => {
  if (window === undefined) return []
  const covered = coveredDays(corpus, timezone)
  const notices: AnswerNotice[] = []
  let day = localDayStartUtcMs(window.from, timezone)
  let open: { from: number; days: number } | undefined
  let scanned = 0
  while (day < window.to && scanned < MAX_GAP_SCAN_DAYS) {
    if (covered.has(day)) {
      if (open !== undefined) {
        notices.push({ _tag: "gap", from: open.from, to: day, days: open.days })
        open = undefined
      }
    } else {
      open = open === undefined ? { from: day, days: 1 } : { from: open.from, days: open.days + 1 }
    }
    day = addLocalDays(day, 1, timezone)
    scanned += 1
  }
  if (open !== undefined) {
    notices.push({ _tag: "gap", from: open.from, to: day, days: open.days })
  }
  return notices
}

const eventTimestamp = (corpus: JournalCorpus, eventId: string): number | undefined => {
  for (const record of corpus.records) {
    const i = record.entry.structuredEventIds.indexOf(eventId)
    if (i >= 0) return record.events[i]?.timestamp
  }
  return undefined
}

/** Corrections whose superseded event falls inside the window affected this answer. */
const correctionNotices = (
  window: Window | undefined,
  matches: readonly Match[],
  corpus: JournalCorpus,
): readonly AnswerNotice[] => {
  if (window === undefined) return []
  const matchIds = new Set(matches.map((m) => m.eventId))
  const notices: AnswerNotice[] = []
  for (const correction of corpus.corrections) {
    const ts = eventTimestamp(corpus, correction.supersedesEventId)
    if (ts === undefined || ts < window.from || ts >= window.to) continue
    const replacementEventId = matchIds.has(correction.replacementEventId) ? correction.replacementEventId : undefined
    notices.push({
      _tag: "correction",
      supersedesEventId: correction.supersedesEventId,
      ...(replacementEventId !== undefined ? { replacementEventId } : {}),
      correctedBy: correction.correctedBy,
      reason: correction.reason,
    })
  }
  return notices
}

/**
 * Conflicting authors: matched events for the same child/category/local day
 * from different authors with a shared payload key holding different values.
 * Detected among the MATCHED events only (the slice the answer is about) —
 * global conflict modeling belongs to the append-only corrections proposal.
 */
const conflictNotices = (matches: readonly Match[], corpus: JournalCorpus): readonly AnswerNotice[] => {
  const groups = new Map<string, Match[]>()
  for (const match of matches) {
    const day = localDayStartUtcMs(match.event.timestamp, corpus.householdTimezone)
    const key = `${match.event.childId}|${match.event.category}|${day}`
    const group = groups.get(key)
    groups.set(key, group === undefined ? [match] : [...group, match])
  }

  const notices: AnswerNotice[] = []
  for (const group of groups.values()) {
    const first = group[0]
    if (first === undefined) continue
    const authors = new Set(group.map((m) => m.record.entry.authorId))
    if (authors.size < 2) continue
    const payloadKeys = new Set<string>()
    for (const match of group) {
      for (const k of Object.keys(match.event.payload ?? {})) payloadKeys.add(k)
    }
    const dayStart = localDayStartUtcMs(first.event.timestamp, corpus.householdTimezone)
    const localDay: Window = { from: dayStart, to: dayStart + DAY_MS }
    for (const payloadKey of payloadKeys) {
      const claims: ConflictClaim[] = group
        .filter((m) => m.event.payload?.[payloadKey] !== undefined)
        .map((m) => ({
          authorId: m.record.entry.authorId,
          eventIds: [m.eventId],
          payloadKey,
          payloadValue: m.event.payload?.[payloadKey] ?? 0,
        }))
        .sort((a, b) => a.authorId.localeCompare(b.authorId) || a.payloadValue - b.payloadValue)
      const values = new Set(claims.map((c) => c.payloadValue))
      if (claims.length < 2 || values.size < 2) continue
      notices.push({ _tag: "conflict", category: first.event.category, localDay, claims })
    }
  }
  return notices
}

// ---------------------------------------------------------------------------
// Citations, coverage, statements
// ---------------------------------------------------------------------------

const excerptOf = (transcript: string): string =>
  transcript.length <= EXCERPT_LIMIT ? transcript : `${transcript.slice(0, EXCERPT_LIMIT - 1)}…`

const citationFor = (match: Match): AnswerCitation => ({
  entryId: match.record.entryId,
  eventIds: [match.eventId],
  childId: match.event.childId,
  authorId: match.record.entry.authorId,
  excerpt: excerptOf(match.record.entry.rawTranscript),
  occurredAt: match.event.timestamp,
})

/** T2 (Gap 3/A7): confirmation breakdown over the events an answer rests on. */
const coverageOf = (matches: readonly Match[]): AnswerCoverage => {
  const confirmed = matches.filter((m) => m.event.confidence === 1).length
  return { confirmed, inferred: matches.length - confirmed, total: matches.length }
}

const fmtDate = (ms: number, timezone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "long", day: "numeric", year: "numeric" }).format(ms)

const fmtShort = (ms: number, timezone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(ms)

const fmtTime = (ms: number, timezone: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true }).format(ms)

/** "on September 5" for a one-local-day window, "between Sep 6 and Sep 8" otherwise. */
const windowPhrase = (window: Window | undefined, timezone: string): string => {
  if (window === undefined) return "in the recorded history"
  const singleDay = localDayStartUtcMs(window.from, timezone) === localDayStartUtcMs(window.to - 1, timezone)
  return singleDay
    ? `on ${fmtDate(window.from, timezone)}`
    : `between ${fmtShort(window.from, timezone)} and ${fmtShort(window.to - 1_000, timezone)}`
}

const payloadPhrase = (event: Event): string => {
  const payload = event.payload ?? {}
  if (payload["minutes"] !== undefined) {
    return event.category === "sleep" ? `napped ${payload["minutes"]} minutes` : `${payload["minutes"]} minutes`
  }
  if (payload["servings"] !== undefined) {
    const n = payload["servings"]
    return `ate ${n} serving${n === 1 ? "" : "s"}`
  }
  if (payload["count"] !== undefined) return `${payload["count"]} recorded`
  return event.category
}

const claimPhrase = (claim: ConflictClaim): string => {
  const unit = claim.payloadKey === "servings" ? `serving${claim.payloadValue === 1 ? "" : "s"}` : claim.payloadKey
  return `${claim.authorId} logged ${claim.payloadValue} ${unit}`
}

const childName = (corpus: JournalCorpus, childId: string | undefined): string =>
  corpus.children.find((c) => c.childId === childId)?.name ?? "The child"

const nounFor = (plan: Plan): string => {
  switch (plan._tag) {
    case "last-event":
      return plan.keyword === "dinner" ? "dinner"
        : plan.keyword === "breakfast" ? "breakfast"
        : plan.keyword === "lunch" ? "lunch"
        : plan.category === "sleep" ? "nap"
        : plan.category
    case "count-events":
    case "probe-events":
      return plan.keyword === "breakfast" ? "breakfast"
        : plan.keyword === "dinner" ? "dinner"
        : plan.keyword === "lunch" ? "lunch"
        : plan.category === "sleep" ? "nap"
        : plan.category
    case "day-summary":
      return "event"
  }
}

const pluralFor = (plan: Plan): string => {
  const singular = nounFor(plan)
  return singular === "meal" ? "meals" : singular === "event" ? "events" : `${singular}s`
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

const executePlan = (plan: Plan, input: Input, corpus: JournalCorpus): typeof HistoryQueryAnswer["Type"] => {
  const index = buildIndex(corpus)
  const window = plan._tag === "last-event" ? undefined : plan.window
  const matches = matchingEvents(plan, corpus, index)

  // Unpinned subject: one child with matches resolves implicitly; more than
  // one is ambiguous — the answer offers candidates instead of guessing.
  if (plan._tag !== "day-summary" && plan.subjectChildId === undefined) {
    const childIds = new Set(matches.map((m) => m.event.childId))
    if (childIds.size > 1) {
      const latestByChild = new Map<string, Match>()
      for (const match of matches) latestByChild.set(match.event.childId, match) // matches are time-sorted
      const candidates: AmbiguityCandidate[] = [...latestByChild.values()]
        .sort((a, b) => a.event.childId.localeCompare(b.event.childId))
        .map((match) => ({
          childId: match.event.childId,
          entryId: match.record.entryId,
          eventIds: [match.eventId],
          occurredAt: match.event.timestamp,
        }))
      return { _tag: "ambiguous", reason: "multiple-children-matched", candidates }
    }
  }

  const notices: AnswerNotice[] = [
    ...correctionNotices(window, matches, corpus),
    ...conflictNotices(matches, corpus),
    ...gapNotices(window, corpus, input.timezone),
  ]

  if (matches.length === 0) {
    return {
      _tag: "not-found",
      statement: `No matching ${nounFor(plan)} records were found ${windowPhrase(window, input.timezone)}.`,
      ...(window !== undefined ? { window } : {}), // optionalKey rejects explicit undefined
      notices,
    }
  }

  if (plan._tag === "last-event") {
    const latest = matches[matches.length - 1]
    if (latest === undefined) {
      return { _tag: "not-found", statement: "No matching records were found.", notices }
    }
    const name = childName(corpus, latest.event.childId)
    const payloadPart = latest.event.payload === undefined ? "" : ` — ${payloadPhrase(latest.event)}`
    return {
      _tag: "found",
      statement: `${name}'s last recorded ${nounFor(plan)} was on ${fmtDate(latest.event.timestamp, input.timezone)} at ${fmtTime(latest.event.timestamp, input.timezone)}${payloadPart}.`,
      citations: [citationFor(latest)],
      coverage: coverageOf(matches),
      notices,
    }
  }

  if (plan._tag === "count-events") {
    const name = childName(corpus, plan.subjectChildId ?? matches[0]?.event.childId)
    const coverage = coverageOf(matches)
    return {
      _tag: "found",
      statement: `${name} had ${matches.length} ${pluralFor(plan)} ${windowPhrase(window, input.timezone)} — ${coverage.confirmed} of ${coverage.total} caregiver-confirmed.`,
      citations: matches.map(citationFor),
      coverage,
      notices,
    }
  }

  if (plan._tag === "day-summary") {
    const name = childName(corpus, plan.subjectChildId ?? matches[0]?.event.childId)
    const categories = matches.map((m) => m.event.category).join(", ")
    const coverage = coverageOf(matches)
    return {
      _tag: "found",
      statement: `${name} had ${matches.length} recorded ${pluralFor(plan)} ${windowPhrase(window, input.timezone)}: ${categories} — ${coverage.confirmed} of ${coverage.total} caregiver-confirmed.`,
      citations: matches.map(citationFor),
      coverage,
      notices,
    }
  }

  // probe-events
  const name = childName(corpus, plan.subjectChildId ?? matches[0]?.event.childId)
  const conflict = notices.find((n): n is Extract<AnswerNotice, { _tag: "conflict" }> => n._tag === "conflict")
  if (conflict !== undefined) {
    return {
      _tag: "found",
      statement: `Conflicting records for ${name}'s ${nounFor(plan)} ${windowPhrase(window, input.timezone)}: ${conflict.claims.map(claimPhrase).join(", ")}.`,
      citations: matches.map(citationFor),
      coverage: coverageOf(matches),
      notices,
    }
  }
  return {
    _tag: "found",
    statement: `Yes — ${name}: ${matches.map((m) => payloadPhrase(m.event)).join("; ")}.`,
    citations: matches.map(citationFor),
    coverage: coverageOf(matches),
    notices,
  }
}

/**
 * Answer a history question. `input` is decoded through the input contract;
 * the returned answer satisfies `HistoryQueryAnswer` (tests re-decode it).
 */
export const answerQuery = (rawInput: Input, corpus: JournalCorpus): typeof HistoryQueryAnswer["Type"] => {
  const input = Schema.decodeUnknownSync(HistoryQueryInput)(rawInput)
  const compiled = compilePlan(input, corpus)
  if (compiled._tag === "clarify") {
    return { _tag: "clarify", reason: compiled.reason, message: compiled.message }
  }
  return executePlan(compiled.plan, input, corpus)
}

/** Source navigation: a citation's entryId back to the verbatim record. */
export const resolveEntrySource = (
  corpus: JournalCorpus,
  entryId: string,
): { readonly entryId: string; readonly entry: Entry; readonly events: readonly Event[] } | undefined => {
  const record = corpus.records.find((r) => r.entryId === entryId)
  return record === undefined ? undefined : { entryId: record.entryId, entry: record.entry, events: record.events }
}
