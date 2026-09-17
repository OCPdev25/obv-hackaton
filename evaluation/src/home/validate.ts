/**
 * Structural validator for the parent-home journey fixtures.
 * `bun src/home/validate.ts` — exit 1 on any failure.
 *
 * Re-asserts every pinned epoch in the JSON fixtures against timestamps.ts
 * (the single source of truth), so a hand-edited fixture can never drift,
 * and checks structure: enums, occurrence kinds, references, window bounds,
 * and the deliberate fixture properties (one gap day, one private entry,
 * one pre-seeded correction chain, empty Nov 1).
 */
import { readFileSync } from 'node:fs'
import * as T from './timestamps.ts'
import { deepEqual } from '../match.ts'

interface Check {
  readonly label: string
  readonly ok: boolean
  readonly failures: readonly string[]
}

const CATEGORIES = new Set(['potty', 'meal', 'sleep', 'mood', 'milestone', 'school'])
const OCCURRENCES = new Set(['exactly-one', 'at-least-one'])
const GATES = new Set(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'])
const DIMS = new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'])
const PROTOCOLS = new Set(['P1', 'P2', 'P3', 'P4', 'P5', 'P6'])

function loadJson(rel: string): unknown {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as unknown
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Read a numeric field that must equal a pinned timestamp. */
function epochFailures(rec: Record<string, unknown>, field: string, expected: number, label: string): string[] {
  const actual = rec[field]
  if (typeof actual !== 'number' || actual !== expected) {
    return [`${label}.${field} is ${String(actual)}, pinned value is ${String(expected)} (timestamps.ts)`]
  }
  return []
}

function check(label: string, failures: readonly string[]): Check {
  return { label, ok: failures.length === 0, failures }
}

function validateUtterances(u: Record<string, unknown>): Check {
  const bad: string[] = []
  const captures = u.captures
  if (!isRecord(captures)) return check('utterances.captures', ['captures missing'])

  const u1 = captures['u1']
  const u2 = captures['u2']
  const u1b = captures['u1b']
  const u3 = captures['u3']
  for (const [k, v] of [['u1', u1], ['u2', u2], ['u1b', u1b], ['u3', u3]] as const) {
    if (!isRecord(v)) bad.push(`capture ${k} missing`)
  }
  if (!isRecord(u1) || !isRecord(u2) || !isRecord(u1b) || !isRecord(u3)) return check('utterances', bad)

  bad.push(...epochFailures(u1, 'capturedAt', T.MOM_CAPTURED_AT, 'u1'))
  bad.push(...epochFailures(u2, 'capturedAt', T.MOM_CAPTURED_AT, 'u2'))
  bad.push(...epochFailures(u1b, 'capturedAt', T.U1B_CAPTURED_AT, 'u1b'))
  bad.push(...epochFailures(u3, 'capturedAt', T.DAD_CAPTURED_AT, 'u3'))

  const u1Exp = u1['expected']
  if (!isRecord(u1Exp)) {
    bad.push('u1.expected missing')
  } else {
    const events = u1Exp['events']
    if (!Array.isArray(events)) bad.push('u1.expected.events must be an array')
    else {
      const meal = events.find((e) => isRecord(e) && e['category'] === 'meal')
      if (isRecord(meal)) bad.push(...epochFailures(meal, 'occurredAt', T.U1_MEAL_AT_8, 'u1.meal'))
      else bad.push('u1 meal expectation missing')
      const sleep = events.find((e) => isRecord(e) && e['category'] === 'sleep')
      if (isRecord(sleep)) bad.push(...epochFailures(sleep, 'occurredAt', T.U1_NAP_START, 'u1.sleep'))
      else bad.push('u1 sleep expectation missing')
      const mood = events.find((e) => isRecord(e) && e['category'] === 'mood')
      if (isRecord(mood)) {
        const w = mood['occurredAtWindow']
        if (!isRecord(w) || !deepEqual(w, T.U1_MOOD_WINDOW)) bad.push(`u1.mood window ${JSON.stringify(mood['occurredAtWindow'] ?? null)} != pinned`)
      } else bad.push('u1 mood expectation missing')
      const potty = events.find((e) => isRecord(e) && e['category'] === 'potty')
      if (isRecord(potty)) {
        const w = potty['occurredAtWindow']
        if (!isRecord(w) || !deepEqual(w, T.U1_POTTY_WINDOW)) bad.push(`u1.potty window ${JSON.stringify(potty['occurredAtWindow'] ?? null)} != pinned`)
      } else bad.push('u1 potty expectation missing')
      for (const e of events) {
        if (!isRecord(e)) continue
        if (typeof e['category'] !== 'string' || !CATEGORIES.has(e['category'])) bad.push(`unknown category ${JSON.stringify(e['category'] ?? null)}`)
        if (typeof e['occurrence'] !== 'string' || !OCCURRENCES.has(e['occurrence'])) bad.push(`unknown occurrence ${JSON.stringify(e['occurrence'] ?? null)}`)
      }
    }
  }

  const u3Exp = u3['expected']
  if (!isRecord(u3Exp)) bad.push('u3.expected missing')
  else {
    const events = u3Exp['events']
    if (!Array.isArray(events)) bad.push('u3.expected.events must be an array')
    else {
      const sleep = events.find((e) => isRecord(e) && e['category'] === 'sleep')
      if (isRecord(sleep)) {
        const w = sleep['occurredAtWindow']
        const pinned = { from: T.U3_NAP_START, to: T.U3_NAP_END }
        if (!isRecord(w) || !deepEqual(w, pinned)) bad.push(`u3.sleep window ${JSON.stringify(sleep['occurredAtWindow'] ?? null)} != pinned [${String(T.U3_NAP_START)}, ${String(T.U3_NAP_END)}]`)
      } else bad.push('u3 sleep expectation missing')
      const meal = events.find((e) => isRecord(e) && e['category'] === 'meal')
      if (isRecord(meal)) {
        const w = meal['occurredAtWindow']
        if (!isRecord(w) || !deepEqual(w, T.U3_MEAL_WINDOW)) bad.push(`u3.meal window != pinned`)
      } else bad.push('u3 meal expectation missing')
    }
  }

  const u1bStale = u1b['stale']
  if (!isRecord(u1bStale)) bad.push('u1b.stale missing')
  else {
    if (u1bStale['fragmentAttempt'] !== 1 || u1bStale['resumedAttempt'] !== 2) {
      bad.push('u1b stale attempts must be 1 (fragment) and 2 (resumed)')
    }
    if (u1bStale['expectedWinnerEvents'] !== 0) bad.push('u1b winner must yield zero events (extraction never blocks capture)')
  }

  // Parity: u2 must declare parityWith u1 and share semantic content.
  if (u2['parityWith'] !== 'u1') bad.push('u2.parityWith must be "u1"')
  if (typeof u1['raw'] !== 'string' || typeof u2['raw'] !== 'string') bad.push('u1/u2 raw must be strings')

  return check('utterances', bad)
}

function validateMiniHistory(m: Record<string, unknown>): Check {
  const bad: string[] = []
  const window = m['window']
  if (!isRecord(window) || !deepEqual(window, T.MINI_HISTORY_WINDOW)) {
    bad.push(`mini-history window ${JSON.stringify(window ?? null)} != pinned MINI_HISTORY_WINDOW`)
  }
  const entries = m['entries']
  if (!Array.isArray(entries)) return check('mini-history.entries', ['entries must be an array'])
  let sawPrivate = false
  let sawCorrectionChainEvent = false
  for (const entry of entries) {
    if (!isRecord(entry)) {
      bad.push('entry must be an object')
      continue
    }
    const createdAt = entry['createdAt']
    if (typeof createdAt !== 'number' || createdAt < T.MINI_HISTORY_WINDOW.from || createdAt > T.MINI_HISTORY_WINDOW.to) {
      bad.push(`entry ${String(entry['entryId'] ?? '?')} createdAt outside window`)
    }
    if (entry['audience'] === 'private') {
      sawPrivate = true
      if (entry['authorId'] !== 'actor-mom') bad.push('private entry must be authored by mom for the visibility control')
    }
    const events = entry['events']
    if (!Array.isArray(events)) {
      bad.push(`entry ${String(entry['entryId'] ?? '?')} events must be an array`)
      continue
    }
    for (const ev of events) {
      if (!isRecord(ev)) continue
      if (typeof ev['category'] !== 'string' || !CATEGORIES.has(ev['category'])) bad.push(`unknown category ${JSON.stringify(ev['category'] ?? null)}`)
      const at = ev['occurredAt']
      if (typeof at !== 'number' || at < T.MINI_HISTORY_WINDOW.from || at >= T.NOV_1_MIDNIGHT_EDT) {
        bad.push(`event ${String(ev['eventId'] ?? '?')} outside seed window or on capture day (Nov 1 must start empty)`)
      }
      if (ev['eventId'] === 'ev-o30-meal') sawCorrectionChainEvent = true
    }
  }
  if (!sawPrivate) bad.push('no private-audience entry (audience check needs one)')
  if (!sawCorrectionChainEvent) bad.push('correction-chain target event ev-o30-meal missing')

  const gaps = m['gaps']
  if (!Array.isArray(gaps) || !gaps.some((g) => isRecord(g) && g['day'] === '2026-10-29')) {
    bad.push('gap day 2026-10-29 missing (missed-day disclosure needs it)')
  }
  const corrections = m['corrections']
  if (!Array.isArray(corrections) || corrections.length === 0) {
    bad.push('pre-seeded correction chain missing')
  } else {
    const c0 = corrections[0]
    if (!isRecord(c0)) bad.push('correction[0] must be an object')
    else if (!isRecord(c0['supersedes']) || !isRecord(c0['patch'])) {
      bad.push('correction[0] must carry supersedes (original) and patch — original must stay retrievable (G6)')
    }
  }
  return check('mini-history', bad)
}

function validateJourneys(j: Record<string, unknown>): Check {
  const bad: string[] = []
  const journeys = j['journeys']
  if (!Array.isArray(journeys)) return check('journeys.journeys', ['journeys must be an array'])
  const actorIds = new Set(['actor-mom', 'actor-dad', 'actor-ruth', 'actor-marcus'])
  for (const jr of journeys) {
    if (!isRecord(jr)) continue
    const id = jr['id']
    if (typeof id !== 'string' || !/^J[1-5]$/.test(id)) bad.push(`journey id ${JSON.stringify(id ?? null)} invalid`)
    if (typeof jr['actorId'] !== 'string' || !actorIds.has(jr['actorId'])) bad.push(`journey ${String(id ?? '?')} actorId unknown`)
    const steps = jr['steps']
    if (!Array.isArray(steps) || steps.length === 0) bad.push(`journey ${String(id ?? '?')} has no steps`)
    else {
      let expectedStep = 1
      for (const st of steps) {
        if (!isRecord(st)) continue
        if (st['step'] !== expectedStep) bad.push(`journey ${String(id ?? '?')} steps not sequential`)
        expectedStep += 1
        if (typeof st['action'] !== 'string' || typeof st['expect'] !== 'string') bad.push(`journey ${String(id ?? '?')} step needs action + expect`)
        for (const key of ['protocols', 'gates', 'dims'] as const) {
          const arr = st[key]
          if (!Array.isArray(arr)) continue
          const known = key === 'protocols' ? PROTOCOLS : key === 'gates' ? GATES : DIMS
          for (const v of arr) {
            if (typeof v !== 'string' || !known.has(v)) bad.push(`journey ${String(id ?? '?')} step ${String(expectedStep - 1)}: unknown ${key} entry ${JSON.stringify(v ?? null)}`)
          }
        }
      }
    }
    const evidence = jr['evidence']
    if (!Array.isArray(evidence) || evidence.length === 0) bad.push(`journey ${String(id ?? '?')} must name its evidence`)
  }
  if (journeys.length !== 5) bad.push(`expected 5 journeys, got ${String(journeys.length)}`)
  return check('journeys', bad)
}

function main(): number {
  const checks: Check[] = []
  const utt = loadJson('../../fixtures/home/utterances.json')
  if (isRecord(utt)) checks.push(validateUtterances(utt))
  else checks.push(check('utterances', ['not an object']))

  const mini = loadJson('../../fixtures/home/mini-history.json')
  if (isRecord(mini)) checks.push(validateMiniHistory(mini))
  else checks.push(check('mini-history', ['not an object']))

  const journeys = loadJson('../../fixtures/home/journeys.json')
  if (isRecord(journeys)) checks.push(validateJourneys(journeys))
  else checks.push(check('journeys', ['not an object']))

  console.log('\nParent-home fixture validation (timestamps.ts assertions ran at import)')
  let failed = 0
  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}`)
    for (const f of c.failures) console.log(`         - ${f}`)
    if (!c.ok) failed += 1
  }
  console.log('='.repeat(72))
  return failed === 0 ? 0 : 1
}

process.exitCode = main()
