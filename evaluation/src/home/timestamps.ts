/**
 * Pinned epochs for the parent-home journey fixtures — SINGLE SOURCE OF TRUTH.
 *
 * Fixtures land on 2026-11-01, the US DST fall-back day (America/New_York):
 * 02:00 EDT becomes 01:00 EST, so all Nov 1 instants are EST (UTC-5) while
 * seed days Oct 28–31 are EDT (UTC-4). Every value below was derived by
 * machine (fixed-offset method: UTC = local + offset) — never by hand
 * arithmetic — and re-asserted at import time: importing this module with a
 * wrong constant aborts the run.
 *
 * Narrative timeline (all America/New_York):
 *   Oct 28–31  seed mini-history (published entries; Oct 29 has no data — the gap)
 *   Nov 1 08:00  breakfast (u1 narrates it in the evening)
 *   Nov 1 10:30–11:15  Lena's nap per dad (ended "about an hour" before his 11:15 log)
 *   Nov 1 12:15  dad logs u3 (pasta lunch around noon, three-heads fiction)
 *   Nov 1 20:00  mom's evening retrospective u1 (u2 is its text twin, same instant)
 *   Nov 1 20:15  mom's resumed interrupted capture u1b
 *   Nov 2 09:00  Ruth (grandma) asks her catch-up questions
 */
import { deepEqual } from '../match.ts'

// --- seed window (Oct, EDT = UTC-4) ------------------------------------
export const MINI_HISTORY_WINDOW = {
  from: 1793160000000, // Oct 28 00:00 EDT
  to: 1793505599999, // Oct 31 23:59:59.999 EDT
} as const

/** Local Nov 1 begins here (00:00 EDT = 04:00Z); seed events must stay below it. */
export const NOV_1_MIDNIGHT_EDT = 1793505600000

/** November 2026 local month window (Nov 1 00:00 local .. Nov 30 23:59:59.999 EST). */
export const MONTH_WINDOW_NOV = { from: 1793505600000, to: 1796101199999 } as const

// --- capture instants (Nov 1, EST = UTC-5) ------------------------------
export const MOM_CAPTURED_AT = 1793581200000 // Nov 1 20:00 EST — evening retrospective
export const U1B_CAPTURED_AT = 1793582100000 // Nov 1 20:15 EST — resume, 15 min later
export const DAD_CAPTURED_AT = 1793553300000 // Nov 1 12:15 EST — midday log
export const RUTH_ASK_AT = 1793628000000 // Nov 2 09:00 EST — next-morning catch-up

// --- u1/u2 event anchors (Nov 1, EST) -----------------------------------
export const U1_MEAL_AT_8 = 1793538000000 // 08:00 EST
export const U1_NAP_START = 1793554200000 // 12:30 EST
export const U1_NAP_END = 1793559600000 // 14:00 EST (90-minute nap, both EST — wall == elapsed)
export const U1_NAP_MINUTES = 90
export const U1_MOOD_WINDOW = { from: 1793538000000, to: 1793554200000 } as const // [breakfast, nap)
export const U1_POTTY_WINDOW = { from: 1793559600000, to: 1793574000000 } as const // [nap end, 18:00) — "this afternoon" follows the nap

// --- u3 event anchors (Nov 1, EST; corpus convention) -------------------
// "woke up from her nap about an hour ago; that nap was 45 minutes" pins:
//   nap end   = capturedAt - 1h
//   nap start = nap end - 45m
export const U3_NAP_END = 1793549700000 // 11:15 EST == DAD_CAPTURED_AT - 1h
export const U3_NAP_START = 1793547000000 // 10:30 EST == U3_NAP_END - 45m
export const U3_MEAL_WINDOW = { from: 1793547000000, to: 1793553300000 } as const // "lunch around noon"

// --- windows & cross-anchor ---------------------------------------------
/** End of the local capture day — P3's history window stops here (no Nov 2 bleed). */
export const HISTORY_WINDOW_NOV1_END = 1793595599999 // Nov 1 23:59:59.999 EST
/** Cross-anchor shared with the merged extraction corpus: Nov 1 18:00 EST. */
export const NOV1_18_00_EST = 1793574000000

// --- machine self-assertions (abort the run on any drift) ----------------
function assertEqual(actual: number, expected: number, label: string): void {
  if (actual !== expected) {
    throw new Error(`timestamps.ts: ${label} is ${actual}, expected ${expected}`)
  }
}

/** Offset of `timezone` at `epoch`, in minutes east of UTC (e.g. -300 for EST). */
function zonedOffsetMinutes(epoch: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(epoch))
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  return Math.round((asUtc - epoch) / 60000)
}

// Zone offsets: EST = -300 for every Nov 1 instant (fold is at 02:00, long past).
for (const [label, epoch] of [
  ['MOM_CAPTURED_AT offset', MOM_CAPTURED_AT],
  ['U1B_CAPTURED_AT offset', U1B_CAPTURED_AT],
  ['DAD_CAPTURED_AT offset', DAD_CAPTURED_AT],
  ['RUTH_ASK_AT offset', RUTH_ASK_AT],
  ['U1_MEAL_AT_8 offset', U1_MEAL_AT_8],
  ['U1_NAP_START offset', U1_NAP_START],
  ['U3_NAP_END offset', U3_NAP_END],
] as const) {
  assertEqual(zonedOffsetMinutes(epoch, 'America/New_York'), -300, `${label} (must be EST -300)`)
}
// Seed days are EDT = -240.
assertEqual(zonedOffsetMinutes(MINI_HISTORY_WINDOW.from, 'America/New_York'), -240, 'MINI_HISTORY_WINDOW.from offset (must be EDT -240)')

// Wall-clock mappings (fixed-offset derivation re-check).
assertEqual(U1_MEAL_AT_8, Date.UTC(2026, 10, 1, 8) + 300 * 60000, 'U1_MEAL_AT_8 (08:00 EST)')
assertEqual(U1_NAP_START, Date.UTC(2026, 10, 1, 12, 30) + 300 * 60000, 'U1_NAP_START (12:30 EST)')
assertEqual(U1_NAP_END, Date.UTC(2026, 10, 1, 14) + 300 * 60000, 'U1_NAP_END (14:00 EST)')
assertEqual(MOM_CAPTURED_AT, Date.UTC(2026, 10, 1, 20) + 300 * 60000, 'MOM_CAPTURED_AT (20:00 EST)')
assertEqual(U1B_CAPTURED_AT, Date.UTC(2026, 10, 1, 20, 15) + 300 * 60000, 'U1B_CAPTURED_AT (20:15 EST)')
assertEqual(DAD_CAPTURED_AT, Date.UTC(2026, 10, 1, 12, 15) + 300 * 60000, 'DAD_CAPTURED_AT (12:15 EST)')
assertEqual(RUTH_ASK_AT, Date.UTC(2026, 10, 2, 9) + 300 * 60000, 'RUTH_ASK_AT (Nov 2 09:00 EST)')
assertEqual(MINI_HISTORY_WINDOW.from, Date.UTC(2026, 9, 28) + 240 * 60000, 'MINI_HISTORY_WINDOW.from (Oct 28 00:00 EDT)')
assertEqual(MINI_HISTORY_WINDOW.to, Date.UTC(2026, 10, 1) + 240 * 60000 - 1, 'MINI_HISTORY_WINDOW.to (Oct 31 23:59:59.999 EDT)')
assertEqual(NOV_1_MIDNIGHT_EDT, Date.UTC(2026, 10, 1) + 240 * 60000, 'NOV_1_MIDNIGHT_EDT (Nov 1 00:00 local)')
assertEqual(MONTH_WINDOW_NOV.from, NOV_1_MIDNIGHT_EDT, 'MONTH_WINDOW_NOV.from (Nov 1 00:00 local)')
assertEqual(MONTH_WINDOW_NOV.to, Date.UTC(2026, 11, 1) + 300 * 60000 - 1, 'MONTH_WINDOW_NOV.to (Nov 30 23:59:59.999 EST)')
assertEqual(HISTORY_WINDOW_NOV1_END, Date.UTC(2026, 10, 2) + 300 * 60000 - 1, 'HISTORY_WINDOW_NOV1_END (Nov 1 23:59:59.999 EST)')

// Durations and the u3 corpus convention chain.
assertEqual(U1_NAP_END - U1_NAP_START, U1_NAP_MINUTES * 60000, 'u1 nap duration (90 min)')
assertEqual(U3_NAP_END, DAD_CAPTURED_AT - 3_600_000, 'U3 "an hour ago" convention')
assertEqual(U3_NAP_START, U3_NAP_END - 45 * 60000, 'u3 nap duration (45 min)')

// Ordering: narrative causality holds.
function assertTrue(cond: boolean, label: string): void {
  if (!cond) throw new Error(`timestamps.ts: ${label}`)
}
assertTrue(U1_MEAL_AT_8 < U1_MOOD_WINDOW.to, 'breakfast before mood window end')
assertTrue(U1_NAP_END < U1_POTTY_WINDOW.to, 'nap before potty window end')
assertEqual(U1_MOOD_WINDOW.to, U1_NAP_START, 'mood window ends at nap start')
assertTrue(U1_POTTY_WINDOW.from >= U1_NAP_END, 'potty window starts at/after nap end')
assertTrue(DAD_CAPTURED_AT < MOM_CAPTURED_AT, 'dad logs before mom')
assertTrue(MOM_CAPTURED_AT < U1B_CAPTURED_AT, 'resume after first capture')
assertEqual(U1B_CAPTURED_AT - MOM_CAPTURED_AT, 15 * 60000, 'resume is 15 minutes later')
assertTrue(RUTH_ASK_AT > U1B_CAPTURED_AT, 'Ruth asks the morning after the captures')
assertTrue(MINI_HISTORY_WINDOW.to < NOV_1_MIDNIGHT_EDT, 'seed window ends before capture day')

// Cross-anchor with the merged extraction corpus.
assertEqual(NOV1_18_00_EST, Date.UTC(2026, 10, 1, 18) + 300 * 60000, 'NOV1_18_00_EST (Nov 1 18:00 EST)')
if (!deepEqual(U1_MOOD_WINDOW, { from: U1_MEAL_AT_8, to: U1_NAP_START })) {
  throw new Error('timestamps.ts: U1_MOOD_WINDOW drift')
}
