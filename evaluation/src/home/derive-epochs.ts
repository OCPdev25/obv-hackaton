/**
 * Epoch derivation for the Nov 1 2026 (DST fall-back) fixtures.
 * Rule: local wall time -> UTC via FIXED offsets (Oct 28-31 = EDT = UTC-4, Nov 1 = EST = UTC-5).
 * Prints every constant; timestamps.ts must match this output exactly.
 */
const EST = 5 * 3600_000 // UTC-5 -> add to local wall
const EDT = 4 * 3600_000 // UTC-4 -> add to local wall

// Nov 1 2026, all EST
const nov1 = (h: number, m = 0): number => Date.UTC(2026, 10, 1, h, m) + EST
// Oct days 2026, all EDT
const oct = (day: number, h: number, m = 0): number => Date.UTC(2026, 9, day, h, m) + EDT

const show = (label: string, v: number | [number, number]): void => {
  if (Array.isArray(v)) {
    console.log(`${label} = [${v[0]}, ${v[1]}]  // local ${new Date(v[0]).toISOString()} .. ${new Date(v[1]).toISOString()}`)
  } else {
    console.log(`${label} = ${v}  // ${new Date(v).toISOString()}`)
  }
}

console.log('--- windows ---')
show('MINI_HISTORY_WINDOW.from', oct(28, 0, 0))
show('MINI_HISTORY_WINDOW.to', oct(31, 23, 59) + 59_999 - 60_000) // 23:59:59.999
show('HISTORY_WINDOW_NOV1_END', nov1(23, 59) + 59_999 - 60_000)
console.log('--- capture day (Nov 1, EST) ---')
show('NOV_1_MIDNIGHT_EDT (Nov 1 00:00 local)', nov1(0, 0))
show('MOM_CAPTURED_AT (20:00)', nov1(20, 0))
show('U1B_CAPTURED_AT (20:15)', nov1(20, 15))
show('DAD_CAPTURED_AT (11:15)', nov1(11, 15))
show('RUTH_ASK_AT (Nov 2 09:00 EST)', Date.UTC(2026, 10, 2, 9, 0) + EST)
show('U1_MEAL_AT_8 (08:00)', nov1(8, 0))
show('U1_NAP_START (12:30)', nov1(12, 30))
show('U1_NAP_END (14:00)', nov1(14, 0))
show('U1_MOOD_WINDOW', [nov1(8, 0), nov1(12, 30)])
show('U1_POTTY_WINDOW', [nov1(12, 0), nov1(18, 0)])
show('U3_NAP_START (09:30 = end 10:15 minus 45m)', nov1(9, 30))
show('U3_NAP_END (capturedAt - 1h = 10:15)', nov1(11, 15) - 3600_000)
show('U3_MEAL_WINDOW (snack around 10)', [nov1(9, 30), nov1(10, 30)])
console.log('--- cross-anchor ---')
show('NOV1_18_00_EST', nov1(18, 0))
console.log('--- seed events (Oct, EDT) ---')
show('ev-o28-meal 08:00', oct(28, 8, 0))
show('ev-o28-sleep 19:15', oct(28, 19, 15))
show('ev-o29-school 08:30', oct(29, 8, 30))
show('ev-o29-pm-nap 13:00', oct(29, 13, 0))
show('ev-o29-dinner 17:45', oct(29, 17, 45))
show('ev-o29-bath 19:00', oct(29, 19, 0))
show('ev-o30-meal 12:30', oct(30, 12, 30))
show('ev-o30-snack 15:30', oct(30, 15, 30))
show('ev-o30-bed 19:30', oct(30, 19, 30))
show('ev-o31-meal 08:15', oct(31, 8, 15))
show('ev-o31-park-mood 10:30', oct(31, 10, 30))
show('ev-o31-lunch 12:15', oct(31, 12, 15))
show('entry-o28 createdAt (07:55)', oct(28, 7, 55))
show('entry-o29 createdAt (18:30)', oct(29, 18, 30))
show('entry-o30 createdAt (12:40)', oct(30, 12, 40))
show('entry-o30b createdAt (19:35)', oct(30, 19, 35))
show('entry-o31 createdAt (20:00)', oct(31, 20, 0))
console.log('--- sanity: convention chain ---')
console.log(`DAD - 1h == U3_NAP_END: ${nov1(11, 15) - 3600_000 === nov1(10, 15)}`)
console.log(`U3_NAP_END - 45m == U3_NAP_START: ${nov1(10, 15) - 45 * 60_000 === nov1(9, 30)}`)
console.log(`Nov2 09:00 > MOM publish (20:05): ${Date.UTC(2026, 10, 2, 9, 0) + EST > nov1(20, 0) + 5 * 60_000}`)
console.log(`Nov1 23:59:59.999 EST > u1b publish (20:20): ${nov1(23, 59) - 60_000 + 59_999 > nov1(20, 15) + 5 * 60_000}`)
console.log(`MINI.to is last ms of Oct 31 local: ${oct(31, 23, 59) + 59_999 - 60_000 === Date.UTC(2026, 11, 1, 3, 59, 59, 999)}`)
