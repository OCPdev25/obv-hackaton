/**
 * Deterministic relative-time resolution — the acceptance corpus's worked
 * example adapter conventions (art_I2TCG08V / PR #6 harness expectations),
 * grafted into the capture pipeline per the arena integration brief:
 * relative-time + quantity extraction is unsolved in all four candidates, so
 * the example adapter's conventions ARE the contract.
 *
 * All functions are pure; "local" always means the capture's IANA zone and the
 * UTC offset used is the one in force AT the resolved instant (DST-safe).
 */

const HOUR_MS = 3_600_000

/**
 * UTC offset (ms east of UTC) for `zone` at `instant`. Uses Intl.DateTimeFormat
 * with timeZoneName: "longOffset" (e.g. "GMT-04:00"); throws for zones Intl
 * does not know — malformed zones must fail loudly, not silently become UTC.
 */
export const zoneOffsetMs = (zone: string, instant: number): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(instant))
  const gmt = parts.find((part) => part.type === "timeZoneName")?.value ?? ""
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(gmt)
  if (match === null) {
    throw new Error(`Unrecognized timezone offset for zone "${zone}": "${gmt}"`)
  }
  const sign = match[1] === "+" ? 1 : -1
  const hours = Number(match[2])
  const minutes = Number(match[3])
  return sign * (hours * HOUR_MS + minutes * 60_000)
}

/**
 * Resolve a wall-clock time in `zone` to a UTC instant, using the offset at
 * the target instant itself (probe, then correct once) — DST-safe: a wall time
 * inside the spring-forward gap resolves to the offset of the instant it maps
 * to, matching the corpus convention.
 */
export const wallToUtc = (
  zone: string,
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
): number => {
  const guess = Date.UTC(year, month - 1, day, hours, minutes)
  const probeOffset = zoneOffsetMs(zone, guess)
  const target = guess - probeOffset
  const actualOffset = zoneOffsetMs(zone, target)
  return guess - actualOffset
}

/** Wall-clock Y/M/D of `instant` in `zone`. */
export const captureWallDate = (zone: string, instant: number): { year: number; month: number; day: number } => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant))
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value
    if (value === undefined) throw new Error(`Missing ${type} part for zone "${zone}"`)
    return Number(value)
  }
  return { year: get("year"), month: get("month"), day: get("day") }
}

/** "8:00 AM"/"6pm" style 12-hour clock to 24h. Midnight is 00, noon is 12. */
export const to24h = (hours: number, minutes: number, meridiem: string): { hours: number; minutes: number } => {
  const normalized = meridiem.toLowerCase()
  if (normalized === "am") {
    return { hours: hours === 12 ? 0 : hours, minutes }
  }
  return { hours: hours === 12 ? 12 : hours + 12, minutes }
}

export interface RelativeTimeInput {
  readonly transcript: string
  /** Capture instant (Unix ms) — the anchor for every relative expression. */
  readonly capturedAt: number
  readonly timezone: string
}

/**
 * Resolve the FIRST time expression in the sentence against the capture
 * instant and zone. Ordered most-specific first, mirroring the example
 * adapter; returns undefined when no expression resolves (convention: the
 * sentence yields no event rather than inventing an instant).
 */
export const resolveOccurredAt = (input: RelativeTimeInput): number | undefined => {
  const { transcript, capturedAt, timezone } = input

  const yesterdayClock = /\byesterday\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(transcript)
  if (yesterdayClock !== null) {
    const { year, month, day } = captureWallDate(timezone, capturedAt)
    const yesterday = new Date(wallToUtc(timezone, year, month, day, 12, 0) - 24 * HOUR_MS)
    const yesterdayWall = captureWallDate(timezone, yesterday.getTime())
    const { hours, minutes } = to24h(Number(yesterdayClock[1]!), Number(yesterdayClock[2] ?? 0), yesterdayClock[3]!)
    return wallToUtc(timezone, yesterdayWall.year, yesterdayWall.month, yesterdayWall.day, hours, minutes)
  }

  const clock = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(transcript)
  if (clock !== null) {
    const { year, month, day } = captureWallDate(timezone, capturedAt)
    const { hours, minutes } = to24h(Number(clock[1]!), Number(clock[2] ?? 0), clock[3]!)
    return wallToUtc(timezone, year, month, day, hours, minutes)
  }

  if (/\bthis morning\b/i.test(transcript)) {
    const { year, month, day } = captureWallDate(timezone, capturedAt)
    return wallToUtc(timezone, year, month, day, 8, 0)
  }

  if (/\ban hour ago\b/i.test(transcript)) {
    return capturedAt - HOUR_MS
  }

  if (/\bjust now\b/i.test(transcript)) {
    return capturedAt
  }

  return undefined
}
