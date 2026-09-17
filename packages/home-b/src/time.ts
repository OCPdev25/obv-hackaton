/**
 * Wall-clock time helpers, IANA-correct (offset taken at the target instant).
 * Same approach proven by evaluation/src/example/example-adapter.ts — reused
 * here so synthetic Sep 2026 timestamps and relative-time resolution in fresh
 * captures share one deterministic convention.
 */

export interface WallDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

function zoneOffsetMs(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type)
    if (part === undefined) throw new Error(`Intl returned no "${type}" part for zone "${zone}"`)
    return Number(part.value)
  }
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUTC - (utcMs - (utcMs % 1000))
}

/** Wall-clock time in `zone` -> Unix ms. Iterates until the offset at the target instant is stable. */
export function wallToUtc(zone: string, year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  let utc = guess - zoneOffsetMs(zone, guess)
  for (let i = 0; i < 3; i++) {
    const next = guess - zoneOffsetMs(zone, utc)
    if (next === utc) return utc
    utc = next
  }
  return utc
}

/** The capture's local (wall) calendar date in `zone`. */
export function wallDateOf(zone: string, utcMs: number): WallDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type)
    if (part === undefined) throw new Error(`Intl returned no "${type}" part for zone "${zone}"`)
    return Number(part.value)
  }
  return { year: get('year'), month: get('month'), day: get('day') }
}

export const HOUSEHOLD_TIMEZONE = 'America/New_York'

/** Demo clock for the prototype UI — keeps "Today" aligned with the Sep 2026 fixture history. */
export const DEMO_NOW = wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 16, 18, 30)
