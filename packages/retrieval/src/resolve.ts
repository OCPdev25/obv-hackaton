import type { EventCategory } from "@journal/domain"

import type { JournalCorpus } from "./corpus.js"
import type { HistoryQueryInput, HistoryQueryPlan, QueryWindow } from "./queryContracts.js"

/**
 * Bounded natural-language question -> structured query plan.
 *
 * This is deliberately NOT an NLP layer: a fixed phrase inventory (four
 * question forms, a small activity lexicon, a handful of window phrases)
 * compiles deterministically to a `HistoryQueryPlan`. Anything outside the
 * inventory returns `clarify` instead of guessing — the slots 15/17 NL
 * layers would replace this compiler, not the plan schema it targets.
 */

/** Reason an answer asks the user to clarify instead of guessing. */
export type ClarifyReason = "unknown-activity" | "unresolved-person" | "missing-time-window"

export type CompiledQuery =
  | { readonly _tag: "plan"; readonly plan: HistoryQueryPlan }
  | { readonly _tag: "clarify"; readonly reason: ClarifyReason; readonly message: string }

/** Subject lookup result — tagged so call sites narrow on `_tag`, not `in`. */
export type SubjectResolution =
  | { readonly _tag: "resolved"; readonly childId: string | undefined }
  | { readonly _tag: "clarify"; readonly reason: ClarifyReason; readonly message: string }

// ---------------------------------------------------------------------------
// Zone-aware calendar math (asker's IANA timezone; two-pass offset
// convergence, DST-safe by construction).
// ---------------------------------------------------------------------------

interface ZonedParts {
  readonly year: number
  readonly month: number // 1-based
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

const zonedParts = (ms: number, timezone: string): ZonedParts => {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const parts: Record<string, string> = {}
  for (const part of dtf.formatToParts(ms)) {
    if (part.type !== "literal") parts[part.type] = part.value
  }
  const hour = parts["hour"]
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    hour: hour === "24" ? 0 : Number(hour),
    minute: Number(parts["minute"]),
    second: Number(parts["second"]),
  }
}

const zoneOffsetMs = (ms: number, timezone: string): number => {
  const p = zonedParts(ms, timezone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms
}

/** UTC instant of 00:00 local time on the day containing `ms`. */
export const localDayStartUtcMs = (ms: number, timezone: string): number => {
  const p = zonedParts(ms, timezone)
  const guess = Date.UTC(p.year, p.month - 1, p.day)
  const first = guess - zoneOffsetMs(guess, timezone)
  return guess - zoneOffsetMs(first, timezone)
}

const DAY_MS = 86_400_000

/** Local day start `days` days from the day containing `ms` (+/-). */
export const addLocalDays = (ms: number, days: number, timezone: string): number =>
  localDayStartUtcMs(ms + days * DAY_MS, timezone)

/** 0 = Monday … 6 = Sunday, in the asker's zone. */
const weekdayIndex = (ms: number, timezone: string): number => {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(ms)
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(wd)
  return index < 0 ? 0 : index
}

/** Local midnight of the Monday of the week containing `ms`. */
const mondayStartUtcMs = (ms: number, timezone: string): number =>
  localDayStartUtcMs(ms, timezone) - weekdayIndex(ms, timezone) * DAY_MS

const MONTHS: Readonly<Record<string, number>> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

interface MonthDay {
  readonly month: number // 0-based
  readonly day: number
}

const parseMonthDay = (phrase: string): MonthDay | undefined => {
  const match = /^([a-z]+) (\d{1,2})$/.exec(phrase.trim())
  const name = match?.[1]
  const dayNum = match?.[2]
  if (name === undefined || dayNum === undefined) return undefined
  const month = MONTHS[name]
  if (month === undefined) return undefined
  const day = Number(dayNum)
  if (!Number.isInteger(day) || day < 1 || day > 31) return undefined
  return { month, day }
}

/** Local midnight of a month/day in the asker's year (no year rollover in the inventory). */
const localDayStartFor = (md: MonthDay, askedAt: number, timezone: string): number => {
  const p = zonedParts(askedAt, timezone)
  const guess = Date.UTC(p.year, md.month, md.day)
  const first = guess - zoneOffsetMs(guess, timezone)
  return guess - zoneOffsetMs(first, timezone)
}

export interface ParsedWindow {
  readonly window: QueryWindow
  readonly phrase: string
}

/** Parse a supported window phrase against the asker's clock. `undefined` = unsupported. */
export const parseWindow = (phrase: string, askedAt: number, timezone: string): ParsedWindow | undefined => {
  const p = phrase.trim().toLowerCase()
  const dayStart = localDayStartUtcMs(askedAt, timezone)
  if (p === "today") return { window: { from: dayStart, to: addLocalDays(askedAt, 1, timezone) }, phrase: p }
  if (p === "yesterday") return { window: { from: addLocalDays(askedAt, -1, timezone), to: dayStart }, phrase: p }
  if (p === "this week") {
    const monday = mondayStartUtcMs(askedAt, timezone)
    return { window: { from: monday, to: monday + 7 * DAY_MS }, phrase: p }
  }
  if (p === "last week") {
    const monday = mondayStartUtcMs(askedAt, timezone)
    return { window: { from: monday - 7 * DAY_MS, to: monday }, phrase: p }
  }
  const on = /^on (.+)$/.exec(p)
  if (on !== null) {
    const md = parseMonthDay(on[1] ?? "")
    if (md === undefined) return undefined
    const from = localDayStartFor(md, askedAt, timezone)
    return { window: { from, to: from + DAY_MS }, phrase: p }
  }
  const between = /^between (.+) and (.+)$/.exec(p)
  if (between !== null) {
    const a = parseMonthDay(between[1] ?? "")
    const b = parseMonthDay(between[2] ?? "")
    if (a === undefined || b === undefined) return undefined
    const from = localDayStartFor(a, askedAt, timezone)
    const to = localDayStartFor(b, askedAt, timezone) + DAY_MS
    return { window: { from, to }, phrase: p }
  }
  const since = /^since (.+)$/.exec(p)
  if (since !== null) {
    const md = parseMonthDay(since[1] ?? "")
    if (md === undefined) return undefined
    return { window: { from: localDayStartFor(md, askedAt, timezone), to: askedAt }, phrase: p }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Activity lexicon
// ---------------------------------------------------------------------------

export interface ActivityRef {
  readonly category: EventCategory
  /** Case-insensitive transcript keyword narrowing a category (e.g. dinner vs meal). */
  readonly keyword?: string
  readonly noun: string
  readonly plural: string
}

const activityFor = (word: string): ActivityRef | undefined => {
  switch (word) {
    case "nap":
    case "napped":
    case "napping":
    case "sleep":
      return { category: "sleep", noun: "nap", plural: "naps" }
    case "breakfast":
    case "breakfasts":
      return { category: "meal", keyword: "breakfast", noun: "breakfast", plural: "breakfasts" }
    case "dinner":
    case "dinners":
      return { category: "meal", keyword: "dinner", noun: "dinner", plural: "dinners" }
    case "lunch":
    case "lunches":
      return { category: "meal", keyword: "lunch", noun: "lunch", plural: "lunches" }
    case "meal":
    case "meals":
    case "ate":
    case "eat":
    case "eating":
      return { category: "meal", noun: "meal", plural: "meals" }
    case "potty":
    case "poop":
    case "pooped":
    case "pee":
    case "peed":
      return { category: "potty", noun: "potty event", plural: "potty events" }
    case "mood":
    case "tantrum":
    case "meltdown":
    case "fussy":
    case "happy":
      return { category: "mood", noun: "mood note", plural: "mood notes" }
    case "tooth":
      return { category: "milestone", keyword: "tooth", noun: "milestone", plural: "milestones" }
    case "milestone":
    case "milestones":
      return { category: "milestone", noun: "milestone", plural: "milestones" }
    case "school":
    case "kindergarten":
      return { category: "school", noun: "school note", plural: "school notes" }
    default:
      return undefined
  }
}

const PRONOUNS: ReadonlySet<string> = new Set(["he", "she", "they"])

/** Plural-tolerant lookup: "tantrums"/"naps" fall back to their singular form. */
const activityForWord = (word: string): ActivityRef | undefined =>
  activityFor(word) ?? (word.endsWith("s") ? activityFor(word.slice(0, -1)) : undefined)

/** Flat clarify member — structurally assignable to both tagged unions above. */
const clarify = (
  reason: ClarifyReason,
  message: string,
): { readonly _tag: "clarify"; readonly reason: ClarifyReason; readonly message: string } => ({
  _tag: "clarify",
  reason,
  message,
})

/** Resolve a subject word to a childId — undefined = intentionally unpinned. */
const resolveSubject = (
  word: string | undefined,
  input: HistoryQueryInput,
  corpus: JournalCorpus,
): SubjectResolution => {
  if (word === undefined) return { _tag: "resolved", childId: undefined }
  if (PRONOUNS.has(word)) {
    if (input.childId !== undefined) return { _tag: "resolved", childId: input.childId }
    return clarify(
      "unresolved-person",
      `I can't tell who "${word}" refers to — ask with a child's name (or ask from a view scoped to one child).`,
    )
  }
  const child = corpus.children.find((c) => c.name.toLowerCase() === word)
  return child === undefined
    ? clarify("unresolved-person", `I don't know "${word}" in this household — known children: ${corpus.children.map((c) => c.name.toLowerCase()).join(", ")}.`)
    : { _tag: "resolved", childId: child.childId }
}

/** Omit optional keys when absent (optionalKey rejects explicit undefined). */
const planWith = <T extends object>(base: T, subjectChildId: string | undefined): T =>
  subjectChildId === undefined ? base : { ...base, subjectChildId }

const withKeyword = <T extends object>(base: T, activity: ActivityRef): T =>
  activity.keyword === undefined ? base : { ...base, keyword: activity.keyword }

// ---------------------------------------------------------------------------
// Question grammar (bounded)
// ---------------------------------------------------------------------------

export const compilePlan = (input: HistoryQueryInput, corpus: JournalCorpus): CompiledQuery => {
  const question = input.question.trim().toLowerCase().replace(/[?.!]+$/, "")
  const { askedAt, timezone } = input
  const windowHelp = "I couldn't tell which time window you mean — try 'on August 19', 'yesterday', 'last week', or 'between September 1 and September 5'."
  const categoryHelp = (word: string): string =>
    `I couldn't map "${word}" to a recorded care event (potty, meal, sleep, mood, milestone, school).`

  // "when did ada last nap?" / "when did she last nap?"
  let match = /^when did ([a-z]+) last ([a-z]+)$/.exec(question)
  if (match !== null) {
    const subject = resolveSubject(match[1], input, corpus)
    if (subject._tag === "clarify") return clarify(subject.reason, subject.message)
    const activity = activityForWord(match[2] ?? "")
    if (activity === undefined) return clarify("unknown-activity", categoryHelp(match[2] ?? ""))
    return {
      _tag: "plan",
      plan: planWith(
        withKeyword({ _tag: "last-event", category: activity.category } as HistoryQueryPlan & { _tag: "last-event" }, activity),
        subject.childId,
      ),
    }
  }

  // "when was the last dinner?"
  match = /^when was the last ([a-z]+)$/.exec(question)
  if (match !== null) {
    const activity = activityForWord(match[1] ?? "")
    if (activity === undefined) return clarify("unknown-activity", categoryHelp(match[1] ?? ""))
    return {
      _tag: "plan",
      plan: withKeyword({ _tag: "last-event", category: activity.category } as HistoryQueryPlan & { _tag: "last-event" }, activity),
    }
  }

  // "how many breakfasts did milo have last week?" / "how many tantrums did ada have"
  match = /^how many ([a-z]+) did ([a-z]+) have(?: (.+))?$/.exec(question)
  if (match !== null) {
    const activity = activityForWord(match[1] ?? "")
    if (activity === undefined) return clarify("unknown-activity", categoryHelp(match[1] ?? ""))
    const subject = resolveSubject(match[2], input, corpus)
    if (subject._tag === "clarify") return clarify(subject.reason, subject.message)
    const tail = match[3]
    if (tail === undefined) return clarify("missing-time-window", "I can count over a time window — try '…last week', '…yesterday', or '…between September 1 and September 5'.")
    const parsed = parseWindow(tail, askedAt, timezone)
    if (parsed === undefined) return clarify("missing-time-window", windowHelp)
    return {
      _tag: "plan",
      plan: planWith(
        withKeyword({ _tag: "count-events", category: activity.category, window: parsed.window } as HistoryQueryPlan & { _tag: "count-events" }, activity),
        subject.childId,
      ),
    }
  }

  // "how much pasta did ada eat on august 17?"
  match = /^how much ([a-z]+) did ([a-z]+) eat (.+)$/.exec(question)
  if (match !== null) {
    const subject = resolveSubject(match[2], input, corpus)
    if (subject._tag === "clarify") return clarify(subject.reason, subject.message)
    const parsed = parseWindow(match[3] ?? "", askedAt, timezone)
    if (parsed === undefined) return clarify("missing-time-window", windowHelp)
    return {
      _tag: "plan",
      plan: planWith(
        {
          _tag: "probe-events",
          category: "meal",
          keyword: match[1] ?? "",
          window: parsed.window,
        } as HistoryQueryPlan & { _tag: "probe-events" },
        subject.childId,
      ),
    }
  }

  // "did ada nap on august 19?" / "did ada nap between august 21 and august 25?" / "did she nap yesterday?"
  match = /^did ([a-z]+) (.+)$/.exec(question)
  if (match !== null) {
    const subject = resolveSubject(match[1], input, corpus)
    if (subject._tag === "clarify") return clarify(subject.reason, subject.message)
    const rest = match[2] ?? ""
    // Longest window tail first: "between A and B", then "on <md>", then bare words.
    const between = /^(.*?) between ([a-z]+ \d+) and ([a-z]+ \d+)$/.exec(rest)
    const on = /^(.*?) on ([a-z]+ \d+)$/.exec(rest)
    const bare = /^(.*?) (today|yesterday|this week|last week)$/.exec(rest)
    let activityPhrase: string
    let parsed: ParsedWindow | undefined
    if (between !== null) {
      activityPhrase = between[1] ?? ""
      parsed = parseWindow(`between ${between[2]} and ${between[3] ?? ""}`, askedAt, timezone)
    } else if (on !== null) {
      activityPhrase = on[1] ?? ""
      parsed = parseWindow(`on ${on[2] ?? ""}`, askedAt, timezone)
    } else if (bare !== null) {
      activityPhrase = bare[1] ?? ""
      parsed = parseWindow(bare[2] ?? "", askedAt, timezone)
    } else {
      activityPhrase = rest
    }
    const activity = activityPhrase.trim() === "" ? undefined : activityForWord(activityPhrase.trim())
    if (activity === undefined) return clarify("unknown-activity", categoryHelp(rest))
    if (parsed === undefined) return clarify("missing-time-window", windowHelp)
    return {
      _tag: "plan",
      plan: planWith(
        withKeyword({ _tag: "probe-events", category: activity.category, window: parsed.window } as HistoryQueryPlan & { _tag: "probe-events" }, activity),
        subject.childId,
      ),
    }
  }

  // "what happened with ada on september 5?"
  match = /^what happened (?:with|for) ([a-z]+) (.+)$/.exec(question)
  if (match !== null) {
    const subject = resolveSubject(match[1], input, corpus)
    if (subject._tag === "clarify") return clarify(subject.reason, subject.message)
    const parsed = parseWindow(match[2] ?? "", askedAt, timezone)
    if (parsed === undefined) return clarify("missing-time-window", windowHelp)
    return { _tag: "plan", plan: planWith({ _tag: "day-summary", window: parsed.window } as HistoryQueryPlan & { _tag: "day-summary" }, subject.childId) }
  }

  return clarify(
    "unknown-activity",
    "I can answer questions about recorded care events — try 'when did ada last nap?', 'how many breakfasts did milo have last week?', or 'what happened with ada on september 5?'.",
  )
}
