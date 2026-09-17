/**
 * Timezone-aware helpers for day bucketing and label rendering.
 * All outputs are deterministic functions of (ms, IANA zone) — fixtures pin
 * exact strings, so a platform Intl change surfaces as a test failure, not a
 * silent drift.
 */

const dayFormatterCache = new Map<string, Intl.DateTimeFormat>()
const timeFormatterCache = new Map<string, Intl.DateTimeFormat>()

const dayFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = dayFormatterCache.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  dayFormatterCache.set(timeZone, formatter)
  return formatter
}

const timeFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const cached = timeFormatterCache.get(timeZone)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
  timeFormatterCache.set(timeZone, formatter)
  return formatter
}

/** Local calendar day of an instant, YYYY-MM-DD (en-CA gives ISO-style output). */
export const dayKey = (ms: number, timeZone: string): string => dayFormatter(timeZone).format(new Date(ms))

/** "8:00 AM" style local clock label. */
export const timeLabel = (ms: number, timeZone: string): string => timeFormatter(timeZone).format(new Date(ms))

/**
 * Local calendar days touched by [since, until), in order. Steps hourly from
 * `since` (no fixed-24h assumption, so DST transitions are handled) and makes
 * sure a trailing partial day is not missed via the `until - 1` edge check.
 */
export const daysInWindow = (since: number, until: number, timeZone: string): string[] => {
  if (until <= since) throw new Error("handoff window is empty: generatedAt must be after lastSeenAt")
  const days: string[] = []
  for (let t = since; t < until; t += 3_600_000) {
    const day = dayKey(t, timeZone)
    if (days[days.length - 1] !== day) days.push(day)
  }
  const lastDay = dayKey(until - 1, timeZone)
  if (days[days.length - 1] !== lastDay) days.push(lastDay)
  return days
}
