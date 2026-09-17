/**
 * Fail-fast loader/validator for the conversational correction challenge
 * corpus. Data lives in evaluation/corrections (household env + cases/*.json).
 * Every field is narrowed and cross-referenced here BEFORE the runner sees it:
 * a corpus that fails validation cannot run at all.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { HouseholdEnv } from './adapter.ts'
import {
  CASE_CATEGORIES,
  FORBIDDEN_OPS,
  RESPONSE_CLASSES,
} from './fixture-types.ts'
import type {
  BaselineEntryCheckFixture,
  CorrectionCaseFixture,
  CorrectionCorpus,
  EntryChangeFixture,
  EventExpectationFixture,
  FinalExpectationFixture,
  NewEntryExpectationFixture,
  ReplayFixture,
  SeedEventFixture,
  SetupTurnFixture,
  StateDeltaFixture,
  TurnExpectationFixture,
} from './fixture-types.ts'

const CASE_ID_PATTERN = /^CC-\d{2}-[a-z0-9-]+$/

class CorpusError extends Error {}

function fail(context: string, message: string): never {
  throw new CorpusError(`${context}: ${message}`)
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, context: string, field: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(context, `${field} must be a non-empty string`)
  return v
}

function int(v: unknown, context: string, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(context, `${field} must be an integer`)
  return v
}

function arr(v: unknown, context: string, field: string): unknown[] {
  if (!Array.isArray(v)) fail(context, `${field} must be an array`)
  return v
}

function optStr(v: unknown, context: string, field: string): string | undefined {
  if (v === undefined) return undefined
  return str(v, context, field)
}

function optStrArr(v: unknown, context: string, field: string): string[] | undefined {
  if (v === undefined) return undefined
  return arr(v, context, field).map((s) => str(s, context, `${field}[]`))
}

function validateQuantityObj(v: unknown, context: string, field: string): { value: number; unit: string } {
  if (!isObj(v)) fail(context, `${field} must be an object`)
  return { value: int(v.value, context, `${field}.value`), unit: str(v.unit, context, `${field}.unit`) }
}

function validateEventExpectation(v: unknown, context: string, field: string): EventExpectationFixture {
  if (!isObj(v)) fail(context, `${field} must be an object`)
  const out: Record<string, unknown> = {
    category: str(v.category, context, `${field}.category`),
    occurredAt: int(v.occurredAt, context, `${field}.occurredAt`),
  }
  if (v.toleranceMs !== undefined) out.toleranceMs = int(v.toleranceMs, context, `${field}.toleranceMs`)
  if (v.quantity !== undefined) {
    // Explicit null pins "no quantity"; an object pins an exact quantity.
    out.quantity = v.quantity === null ? null : validateQuantityObj(v.quantity, context, `${field}.quantity`)
  }
  const nc = optStrArr(v.noteContains, context, `${field}.noteContains`)
  if (nc !== undefined) out.noteContains = nc
  const nnc = optStrArr(v.noteNotContains, context, `${field}.noteNotContains`)
  if (nnc !== undefined) out.noteNotContains = nnc
  return out as unknown as EventExpectationFixture
}

function validateSeedEvent(v: unknown, context: string, field: string): SeedEventFixture {
  if (!isObj(v)) fail(context, `${field} must be an object`)
  const out: Record<string, unknown> = {
    category: str(v.category, context, `${field}.category`),
    occurredAt: int(v.occurredAt, context, `${field}.occurredAt`),
  }
  const note = optStr(v.note, context, `${field}.note`)
  if (note !== undefined) out.note = note
  if (v.quantity !== undefined) out.quantity = validateQuantityObj(v.quantity, context, `${field}.quantity`)
  return out as unknown as SeedEventFixture
}

function validateBaselineRevisionKinds(
  v: unknown,
  context: string,
  captureIds: Set<string>,
): Record<string, string[]> {
  if (!isObj(v)) fail(context, 'must be an object')
  const out: Record<string, string[]> = {}
  for (const [cap, kinds] of Object.entries(v)) {
    if (!captureIds.has(cap)) fail(context, `references unknown captureId ${cap}`)
    out[cap] = arr(kinds, context, `revisionKinds[${cap}]`).map((k, i) =>
      str(k, context, `revisionKinds[${cap}][${i}]`),
    )
  }
  return out
}

function readJson(url: URL, label: string): unknown {
  let raw: string
  try {
    raw = readFileSync(fileURLToPath(url), 'utf8')
  } catch (err) {
    throw new CorpusError(`${label}: cannot read ${fileURLToPath(url)} — ${String(err)}`)
  }
  try {
    return JSON.parse(raw) as unknown
  } catch (err) {
    throw new CorpusError(`${label}: invalid JSON — ${String(err)}`)
  }
}

function validateEnv(url: URL): HouseholdEnv {
  const raw = readJson(url, 'household-env')
  if (!isObj(raw) || !isObj(raw.household)) throw new CorpusError('household-env: missing household object')
  const h = raw.household
  const children = arr(h.children, 'household-env', 'household.children').map((c, i) => {
    const ctx = `household.children[${i}]`
    if (!isObj(c)) fail(ctx, 'must be an object')
    return { childId: str(c.childId, ctx, 'childId'), displayName: str(c.displayName, ctx, 'displayName') }
  })
  const childIds = new Set(children.map((c) => c.childId))
  if (childIds.size !== children.length) throw new CorpusError('household-env: duplicate childId')

  const memberIds = new Set<string>()
  const members = arr(h.members, 'household-env', 'household.members').map((m, i) => {
    const ctx = `household.members[${i}]`
    if (!isObj(m)) fail(ctx, 'must be an object')
    const memberId = str(m.memberId, ctx, 'memberId')
    if (memberIds.has(memberId)) fail(ctx, `duplicate memberId ${memberId}`)
    memberIds.add(memberId)
    const roleRaw = str(m.role, ctx, 'role')
    if (roleRaw !== 'parent' && roleRaw !== 'caregiver') fail(ctx, `invalid role ${roleRaw}`)
    const role: 'parent' | 'caregiver' = roleRaw
    if (!isObj(m.childGrants)) fail(ctx, 'childGrants must be an object')
    const grants: Record<string, 'read' | 'read-write'> = {}
    for (const [childId, grant] of Object.entries(m.childGrants)) {
      if (grant !== 'read' && grant !== 'read-write') fail(ctx, `invalid grant ${String(grant)} for ${childId}`)
      if (!childIds.has(childId)) fail(ctx, `grant references unknown child ${childId}`)
      grants[childId] = grant
    }
    return { memberId, displayName: str(m.displayName, ctx, 'displayName'), role, childGrants: grants }
  })
  if (members.length === 0) throw new CorpusError('household-env: no members')

  return {
    householdId: str(h.householdId, 'household-env', 'household.householdId'),
    timezone: str(h.timezone, 'household-env', 'household.timezone'),
    children,
    members,
  }
}

function validateCase(raw: unknown, file: string, seenIds: Set<string>, env: HouseholdEnv): CorrectionCaseFixture {
  if (!isObj(raw)) fail(file, 'case must be an object')
  const id = str(raw.id, file, 'id')
  if (!CASE_ID_PATTERN.test(id)) fail(id, `id must match ${CASE_ID_PATTERN}`)
  if (seenIds.has(id)) fail(id, 'duplicate case id')
  seenIds.add(id)
  const category = str(raw.category, id, 'category')
  if (!(CASE_CATEGORIES as readonly string[]).includes(category)) fail(id, `unknown category ${category}`)
  str(raw.description, id, 'description')
  arr(raw.exercises, id, 'exercises').forEach((e, i) => str(e, id, `exercises[${i}]`))

  const childIds = new Set(env.children.map((c) => c.childId))
  const memberIds = new Set(env.members.map((m) => m.memberId))

  if (!isObj(raw.setup)) fail(id, 'setup must be an object')
  const setupRaw = raw.setup
  const captureIds = new Set<string>()
  const setupTurns = arr(setupRaw.turns, id, 'setup.turns').map((t, i) => {
    const ctx = `${id}.setup.turns[${i}]`
    if (!isObj(t)) fail(ctx, 'must be an object')
    const turnId = str(t.turnId, ctx, 'turnId')
    const captureId = optStr(t.captureId, ctx, 'captureId')
    if (captureId !== undefined) {
      if (captureIds.has(captureId)) fail(id, `duplicate setup captureId ${captureId}`)
      captureIds.add(captureId)
    }
    const speakerId = str(t.speakerId, ctx, 'speakerId')
    if (!memberIds.has(speakerId)) fail(id, `unknown setup speaker ${speakerId}`)
    const seedEvents = t.seedEvents === undefined
      ? undefined
      : arr(t.seedEvents, ctx, 'seedEvents').map((e, j) => validateSeedEvent(e, ctx, `seedEvents[${j}]`))
    if (captureId === undefined && seedEvents !== undefined) fail(id, `${turnId}: capture turns must declare captureId`)
    return {
      turnId,
      captureId,
      speakerId,
      capturedAt: int(t.capturedAt, ctx, 'capturedAt'),
      text: str(t.text, ctx, 'text'),
      seedEvents,
    } satisfies SetupTurnFixture
  })

  const publish = setupRaw.publish === undefined
    ? undefined
    : arr(setupRaw.publish, id, 'setup.publish').map((p, i) => {
        const captureId = str(p, id, `setup.publish[${i}]`)
        if (!captureIds.has(captureId)) fail(id, `publish references unknown captureId ${captureId}`)
        return captureId
      })

  if (!isObj(setupRaw.baseline)) fail(id, 'setup.baseline must be an object')
  const baselineRaw = setupRaw.baseline
  const baseline = {
    entryCount: int(baselineRaw.entryCount, id, 'setup.baseline.entryCount'),
    entries: baselineRaw.entries === undefined
      ? undefined
      : arr(baselineRaw.entries, id, 'baseline.entries').map((e, i) => {
          const ctx = `${id}.baseline.entries[${i}]`
          if (!isObj(e)) fail(ctx, 'must be an object')
          const ofCaptureId = str(e.ofCaptureId, ctx, 'ofCaptureId')
          if (!captureIds.has(ofCaptureId)) fail(id, `baseline references unknown captureId ${ofCaptureId}`)
          return {
            ofCaptureId,
            status: optStr(e.status, ctx, 'status'),
            events: e.events === undefined
              ? undefined
              : arr(e.events, ctx, 'events').map((ev, j) => validateEventExpectation(ev, ctx, `events[${j}]`)),
          } satisfies BaselineEntryCheckFixture
        }),
    revisionKinds: baselineRaw.revisionKinds === undefined
      ? undefined
      : validateBaselineRevisionKinds(baselineRaw.revisionKinds, `${id}.baseline.revisionKinds`, captureIds),
  }

  const turns = arr(raw.turns, id, 'turns').map((t, i) => {
    const ctx = `${id}.turns[${i}]`
    if (!isObj(t)) fail(ctx, 'must be an object')
    const speakerId = str(t.speakerId, ctx, 'speakerId')
    if (!memberIds.has(speakerId)) fail(id, `unknown speaker ${speakerId}`)
    if (!isObj(t.expect)) fail(ctx, 'expect must be an object')
    const responseClass = str(t.expect.responseClass, ctx, 'expect.responseClass')
    if (!RESPONSE_CLASSES.includes(responseClass as (typeof RESPONSE_CLASSES)[number])) {
      fail(id, `unknown responseClass ${responseClass}`)
    }

    let stateDelta: TurnExpectationFixture['stateDelta']
    const rawDelta = t.expect.stateDelta
    if (rawDelta !== undefined) {
      if (rawDelta === 'none') {
        stateDelta = 'none'
      } else if (isObj(rawDelta)) {
        const sd = rawDelta
        const parsed: StateDeltaFixture = {}
        if (sd.entryCountDelta !== undefined) {
          parsed.entryCountDelta = int(sd.entryCountDelta, ctx, 'stateDelta.entryCountDelta')
        }
        if (sd.entryChanges !== undefined) {
          parsed.entryChanges = arr(sd.entryChanges, ctx, 'stateDelta.entryChanges').map((c, j) => {
            const cctx = `${ctx}.entryChanges[${j}]`
            if (!isObj(c)) fail(cctx, 'must be an object')
            const ofCaptureId = str(c.ofCaptureId, cctx, 'ofCaptureId')
            if (!captureIds.has(ofCaptureId)) fail(id, `entryChanges reference unknown captureId ${ofCaptureId}`)
            return {
              ofCaptureId,
              childId: optStr(c.childId, cctx, 'childId'),
              status: optStr(c.status, cctx, 'status'),
              authorIdMustRemain: optStr(c.authorIdMustRemain, cctx, 'authorIdMustRemain'),
              transcriptUnchanged: c.transcriptUnchanged === undefined ? undefined : Boolean(c.transcriptUnchanged),
              events: c.events === undefined
                ? undefined
                : arr(c.events, cctx, 'events').map((ev, k) => validateEventExpectation(ev, cctx, `events[${k}]`)),
            } satisfies EntryChangeFixture
          })
        }
        if (sd.newEntries !== undefined) {
          parsed.newEntries = arr(sd.newEntries, ctx, 'stateDelta.newEntries').map((n, j) => {
            const nctx = `${ctx}.newEntries[${j}]`
            if (!isObj(n)) fail(nctx, 'must be an object')
            const childId = str(n.childId, nctx, 'childId')
            if (!childIds.has(childId)) fail(id, `newEntries reference unknown child ${childId}`)
            return {
              childId,
              authorId: str(n.authorId, nctx, 'authorId'),
              status: str(n.status, nctx, 'status'),
              events: arr(n.events, nctx, 'events').map((ev, k) => validateEventExpectation(ev, nctx, `events[${k}]`)),
              revisionKinds: n.revisionKinds === undefined
                ? undefined
                : arr(n.revisionKinds, nctx, 'revisionKinds').map((k, ki) => str(k, nctx, `revisionKinds[${ki}]`)),
            } satisfies NewEntryExpectationFixture
          })
        }
        if (sd.appendedRevisions !== undefined) {
          parsed.appendedRevisions = arr(sd.appendedRevisions, ctx, 'stateDelta.appendedRevisions').map((r, j) => {
            const rctx = `${ctx}.appendedRevisions[${j}]`
            if (!isObj(r)) fail(rctx, 'must be an object')
            const ofCaptureId = str(r.ofCaptureId, rctx, 'ofCaptureId')
            if (!captureIds.has(ofCaptureId)) fail(id, `appendedRevisions reference unknown captureId ${ofCaptureId}`)
            return {
              ofCaptureId,
              kind: str(r.kind, rctx, 'kind'),
              authorId: str(r.authorId, rctx, 'authorId'),
              count: r.count === undefined ? undefined : int(r.count, rctx, 'count'),
            } satisfies import('./fixture-types.ts').AppendedRevisionFixture
          })
        }
        stateDelta = parsed
      } else {
        fail(id, 'stateDelta must be "none" or an object')
      }
    }
    return {
      turnId: str(t.turnId, ctx, 'turnId'),
      speakerId,
      capturedAt: int(t.capturedAt, ctx, 'capturedAt'),
      text: str(t.text, ctx, 'text'),
      correctionId: optStr(t.correctionId, ctx, 'correctionId'),
      expect: { responseClass, stateDelta } satisfies TurnExpectationFixture,
    } satisfies import('./fixture-types.ts').ChallengeTurnFixture
  })

  const replay = raw.replay === undefined
    ? undefined
    : (() => {
        if (!isObj(raw.replay)) fail(id, 'replay must be an object')
        const turnIndex = int(raw.replay.turnIndex, id, 'replay.turnIndex')
        if (turnIndex < 0 || turnIndex >= turns.length) fail(id, `replay.turnIndex ${turnIndex} out of range`)
        return {
          turnIndex,
          note: optStr(raw.replay.note, id, 'replay.note'),
          expectResponseClass: optStr(raw.replay.expectResponseClass, id, 'replay.expectResponseClass'),
        } satisfies ReplayFixture
      })()

  if (!isObj(raw.final)) fail(id, 'final must be an object')
  const finalRaw = raw.final
  const final: FinalExpectationFixture = {
    entryCount: int(finalRaw.entryCount, id, 'final.entryCount'),
    entries: finalRaw.entries === undefined
      ? undefined
      : arr(finalRaw.entries, id, 'final.entries').map((e, i) => {
          const ctx = `${id}.final.entries[${i}]`
          if (!isObj(e)) fail(ctx, 'must be an object')
          const ofCaptureId = str(e.ofCaptureId, ctx, 'ofCaptureId')
          if (!captureIds.has(ofCaptureId)) fail(id, `final entry references unknown captureId ${ofCaptureId}`)
          const childId = str(e.childId, ctx, 'childId')
          if (!childIds.has(childId)) fail(id, `final entry references unknown child ${childId}`)
          const authorId = str(e.authorId, ctx, 'authorId')
          if (!memberIds.has(authorId)) fail(id, `final entry references unknown author ${authorId}`)
          return {
            ofCaptureId,
            childId,
            authorId,
            status: str(e.status, ctx, 'status'),
            transcriptByteEquals: str(e.transcriptByteEquals, ctx, 'transcriptByteEquals'),
            events: arr(e.events, ctx, 'events').map((ev, j) => validateEventExpectation(ev, ctx, `events[${j}]`)),
            revisionKinds: arr(e.revisionKinds, ctx, 'revisionKinds').map((k, j) => str(k, ctx, `revisionKinds[${j}]`)),
            lastRevisionAuthorId: optStr(e.lastRevisionAuthorId, ctx, 'lastRevisionAuthorId'),
          } satisfies import('./fixture-types.ts').FinalEntryCheckFixture
        }),
    newEntries: finalRaw.newEntries === undefined
      ? undefined
      : arr(finalRaw.newEntries, id, 'final.newEntries').map((n, j) => {
          const nctx = `${id}.final.newEntries[${j}]`
          if (!isObj(n)) fail(nctx, 'must be an object')
          const childId = str(n.childId, nctx, 'childId')
          if (!childIds.has(childId)) fail(id, `final newEntry references unknown child ${childId}`)
          return {
            childId,
            authorId: str(n.authorId, nctx, 'authorId'),
            status: str(n.status, nctx, 'status'),
            events: arr(n.events, nctx, 'events').map((ev, k) => validateEventExpectation(ev, nctx, `events[${k}]`)),
            revisionKinds: n.revisionKinds === undefined
              ? undefined
              : arr(n.revisionKinds, nctx, 'revisionKinds').map((k, ki) => str(k, nctx, `revisionKinds[${ki}]`)),
          } satisfies NewEntryExpectationFixture
        }),
  }

  const forbidden = arr(raw.forbidden, id, 'forbidden').map((op, i) => {
    const opStr = str(op, id, `forbidden[${i}]`)
    if (!(FORBIDDEN_OPS as readonly string[]).includes(opStr)) fail(id, `unknown forbidden op ${opStr}`)
    return opStr
  })

  return {
    id,
    category,
    description: raw.description as string,
    exercises: raw.exercises as string[],
    setup: { turns: setupTurns, publish, baseline },
    turns,
    replay,
    final,
    forbidden,
  }
}

/** Load + validate the household env and every case file. Throws on any defect. */
export function loadCorrectionFixtures(correctionsDir: URL): CorrectionCorpus {
  const env = validateEnv(new URL('household-env.json', correctionsDir))
  const casesDir = new URL('cases/', correctionsDir)
  let names: string[]
  try {
    names = readdirSync(fileURLToPath(casesDir))
  } catch (err) {
    throw new CorpusError(`cannot list cases directory — ${String(err)}`)
  }
  const jsonFiles = names.filter((n) => n.endsWith('.json')).sort()
  if (jsonFiles.length === 0) throw new CorpusError('cases directory contains no case files')

  const seenIds = new Set<string>()
  const cases: CorrectionCaseFixture[] = []
  for (const name of jsonFiles) {
    const raw = readJson(new URL(name, casesDir), name)
    if (!isObj(raw) || !Array.isArray(raw.cases)) fail(name, 'must be an object with a cases array')
    for (const c of raw.cases) {
      cases.push(validateCase(c, name, seenIds, env))
    }
  }
  if (cases.length === 0) throw new CorpusError('no cases loaded')
  return { env, cases }
}
