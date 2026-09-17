/**
 * Timezone-correct, deterministic calendar-month bucketing.
 *
 * Month history is bucketed by the household's LOCAL calendar — never by UTC,
 * never by the viewer's device zone. Every function here is a pure function
 * of its arguments: no `Date.now()`, no ambient timezone reads. Same inputs,
 * same outputs, on every machine and every run.
 *
 * Implementation is Intl-based (full ICU). Formatters are cached per
 * (locale, timeZone) and the locale is pinned to en-US so label strings are
 * deterministic. Pinned values in test/zone.test.ts were computed and
 * verified against bun 1.3.14 / node 20 full-ICU on 2026-09-17.
 */

export const LABEL_LOCALE = "en-US"

export interface ZonedMonthBounds {
  /** First instant (Unix ms) whose local date is the 1st of the month. */
  readonly startMs: number
  /** First instant (Unix ms) whose local date is the 1st of the NEXT month. */
  readonly endMsExclusive: number
}

export interface LocalParts {
  readonly year: string
  readonly month: string
  readonly day: string
  readonly hour: string
  readonly minute: string
  readonly second: string
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cacheKey = `${LABEL_LOCALE}|${timeZone}`
  const cached = formatterCache.get(cacheKey)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat(LABEL_LOCALE, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
  formatterCache.set(cacheKey, formatter)
  return formatter
}

function partsAt(instantMs: number, timeZone: string): LocalParts {
  const collected = new Map<string, string>()
  for (const part of partsFormatter(timeZone).formatToParts(instantMs)) {
    if (part.type !== "literal") collected.set(part.type, part.value)
  }
  const get = (kind: string): string => {
    const value = collected.get(kind)
    if (value === undefined) throw new Error(`Intl formatToParts missing "${kind}" for ${timeZone}`)
    return value
  }
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  }
}

function utcMsFromParts(parts: LocalParts): number {
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
}

/** "YYYY-MM-DD" — the household-zone local calendar date of an instant. */
export function localDateKey(instantMs: number, timeZone: string): string {
  const parts = partsAt(instantMs, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

const MONTH_KEY_PATTERN = /^\d{4}-\d{2}$/

export function parseMonthKey(monthKey: string): { readonly year: number; readonly month: number } {
  if (!MONTH_KEY_PATTERN.test(monthKey)) {
    throw new Error(`monthKey must be "YYYY-MM", got ${JSON.stringify(monthKey)}`)
  }
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(5, 7))
  if (month < 1 || month > 12) throw new Error(`monthKey month out of range: ${monthKey}`)
  return { year, month }
}

function parseDateKey(dateKey: string): { readonly year: number; readonly month: number; readonly day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`dateKey must be "YYYY-MM-DD", got ${JSON.stringify(dateKey)}`)
  }
  return { year: Number(dateKey.slice(0, 4)), month: Number(dateKey.slice(5, 7)), day: Number(dateKey.slice(8, 10)) }
}

export function nextMonthKey(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey)
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`
}

const STEP_MS = 15 * 60_000
const MAX_STEPS = 96 // > one day of walking; a correct zone resolves in a handful

/**
 * First instant whose local date is `year-month-day` in `timeZone`.
 *
 * Converges by shifting a UTC-midnight guess by the wall-clock offset it
 * reads, then handles midnight-skipped DST days (e.g. America/Havana springs
 * forward at 00:00): walk forward to the first instant that exists on the
 * target local date, then back up to the earliest such instant. Defined
 * semantics: a local date begins at the earliest instant that exists on it.
 */
function firstInstantOfLocalDate(year: number, month: number, day: number, timeZone: string): number {
  const dateKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  const utcMidnight = Date.UTC(year, month - 1, day)
  let guess = utcMidnight
  for (let i = 0; i < 6; i += 1) {
    const diff = utcMidnight - utcMsFromParts(partsAt(guess, timeZone))
    if (diff === 0) break
    guess += diff
  }
  let steps = 0
  while (localDateKey(guess, timeZone) !== dateKey) {
    guess += STEP_MS
    steps += 1
    if (steps > MAX_STEPS) throw new Error(`could not resolve local date ${dateKey} in ${timeZone}`)
  }
  while (localDateKey(guess - STEP_MS, timeZone) === dateKey) {
    guess -= STEP_MS
    steps += 1
    if (steps > MAX_STEPS) throw new Error(`could not resolve earliest instant of ${dateKey} in ${timeZone}`)
  }
  return guess
}

/** Half-open [startMs, endMsExclusive) bounds of the calendar month in the zone. */
export function zonedMonthBounds(monthKey: string, timeZone: string): ZonedMonthBounds {
  const { year, month } = parseMonthKey(monthKey)
  const startMs = firstInstantOfLocalDate(year, month, 1, timeZone)
  const next = nextMonthKey(monthKey)
  const endMsExclusive = firstInstantOfLocalDate(Number(next.slice(0, 4)), Number(next.slice(5, 7)), 1, timeZone)
  if (endMsExclusive <= startMs) throw new Error(`degenerate month bounds for ${monthKey} in ${timeZone}`)
  return { startMs, endMsExclusive }
}

export function isInstantInMonth(instantMs: number, bounds: ZonedMonthBounds): boolean {
  return instantMs >= bounds.startMs && instantMs < bounds.endMsExclusive
}

/**
 * Every local calendar date key of the month, in order, each exactly once.
 * Walks in 12h steps (a step can never jump over a local midnight) and
 * asserts completeness against the bounds-derived day count, which stays
 * correct across 23h/25h DST days via rounding.
 */
export function localDateKeysOfMonth(monthKey: string, timeZone: string): readonly string[] {
  const bounds = zonedMonthBounds(monthKey, timeZone)
  const keys: string[] = []
  for (let instant = bounds.startMs; instant < bounds.endMsExclusive; instant += 12 * 60 * 60_000) {
    const key = localDateKey(instant, timeZone)
    if (keys[keys.length - 1] !== key) keys.push(key)
  }
  const expectedDays = Math.round((bounds.endMsExclusive - bounds.startMs) / (24 * 60 * 60_000))
  if (keys.length !== expectedDays) {
    throw new Error(`expected ${expectedDays} calendar days for ${monthKey} in ${timeZone}, enumerated ${keys.length}`)
  }
  return keys
}

const dayLabelFormatter = new Intl.DateTimeFormat(LABEL_LOCALE, {
  timeZone: "UTC",
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
})
const monthLabelFormatter = new Intl.DateTimeFormat(LABEL_LOCALE, { timeZone: "UTC", month: "long", year: "numeric" })
const timeFormatterCache = new Map<string, Intl.DateTimeFormat>()

/** "Wednesday, September 30, 2026" — pinned en-US, formatted at UTC noon (DST-safe). */
export function fullDayLabel(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey)
  return dayLabelFormatter.format(Date.UTC(year, month - 1, day, 12))
}

/** "September 2026". */
export function monthLabel(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey)
  return monthLabelFormatter.format(Date.UTC(year, month - 1, 1, 12))
}

/** "11:50 PM" — household-zone wall-clock time of an instant. */
export function localTimeLabel(instantMs: number, timeZone: string): string {
  const cached = timeFormatterCache.get(timeZone)
  if (cached) return cached.format(instantMs)
  const formatter = new Intl.DateTimeFormat(LABEL_LOCALE, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  timeFormatterCache.set(timeZone, formatter)
  return formatter.format(instantMs)
}
