/**
 * CLI entry: `bun src/home/run.ts [--adapter=<path>] [--expect-failure]`
 *
 * Parent-home journey protocols P1-P6 (rubric art_uWsp80Fg §8), executed
 * against a HomeCandidateAdapter. Mirrors the merged harness CLI:
 *
 *  --adapter=<path>   Module exporting `createAdapter(): HomeCandidateAdapter`.
 *                     Defaults to the worked example adapter.
 *  --expect-failure   Invert the exit code: exit 0 iff the run found failures
 *                     (used by the broken-adapter negative control).
 *
 * Evidence label for every run: DETERMINISTIC TEST DOUBLE — no live LLM, no
 * device, no cloud. Pinned instants come from timestamps.ts and are asserted
 * at import.
 */
import { readFileSync } from 'node:fs'
import type { AskInput, AskResult, CaptureInput, HistoryQuery, HistoryResult, HomeCandidateAdapter, ProposedEvent, SubmitResult } from './adapter.ts'
import { deepEqual, sha256Hex } from '../match.ts'
import { expectedSetMismatches, pottyCoverageMismatches, type ExpectedBlock } from './match.ts'
import * as T from './timestamps.ts'

interface UtteranceFixture {
  readonly captureId: string
  readonly mode: 'voice-transcript' | 'text'
  readonly actorId: string
  readonly childId: string
  readonly capturedAt: number
  readonly timezone: string
  readonly raw: string
  readonly expected?: { readonly events: readonly never[] } & ExpectedBlock
  readonly parityWith?: string
  readonly stale?: {
    readonly fragmentRaw: string
    readonly fragmentAttempt: number
    readonly resumedRaw: string
    readonly resumedAttempt: number
    readonly expectedWinnerEvents: number
  }
}

interface UtterancesFixture {
  readonly captures: Readonly<Record<string, UtteranceFixture>>
  readonly corrections: {
    readonly u4: { readonly viaStatement: string; readonly targetCaptureId: string; readonly targetCategory: string; readonly expectPatch: { readonly quantity: { readonly value: number; readonly unit: string } }; readonly byActorId: string }
    readonly noTargetStatement: string
    readonly rejectFromCaptureId: string
    readonly rejectTargetCategory: string
    readonly rejectByActorId: string
  }
  readonly questions: {
    readonly q1: AskInput & { readonly text: string }
    readonly q2: AskInput & { readonly text: string }
    readonly q3WriteAttempt: AskInput & { readonly text: string }
    readonly privateEntryId: string
    readonly askAt: number
  }
  readonly authorization: { readonly nonMemberActorId: string; readonly outOfScopeChildId: string }
}

interface Check {
  readonly protocol: string
  readonly ok: boolean
  readonly failures: readonly string[]
}

function loadFixture(): UtterancesFixture {
  const url = new URL('../../fixtures/home/utterances.json', import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as UtterancesFixture
}

function captureOf(u: UtteranceFixture, raw: string, attempt: number, capturedAt: number): CaptureInput {
  return {
    captureId: u.captureId,
    attempt,
    mode: u.mode,
    raw,
    actorId: u.actorId,
    childId: u.childId,
    capturedAt,
    timezone: u.timezone,
  }
}

function submitTag(r: SubmitResult): string {
  return r._tag
}

/** All refusals must disclose nothing — asserted on every Refused result. */
function disclosureFailures(tag: string, r: { readonly _tag: string; readonly disclosure?: string }): string[] {
  if (r._tag === 'Refused' && r.disclosure !== '') {
    return [`${tag}: Refused carried a non-empty disclosure (leak): ${JSON.stringify(r.disclosure ?? null)}`]
  }
  return []
}

export async function runProtocols(adapter: HomeCandidateAdapter): Promise<readonly Check[]> {
  const fixtures = loadFixture()
  const u1 = fixtures.captures['u1']
  const u2 = fixtures.captures['u2']
  const u1b = fixtures.captures['u1b']
  const u3 = fixtures.captures['u3']
  if (u1 === undefined || u2 === undefined || u1b === undefined || u3 === undefined || u1.expected === undefined) {
    throw new Error('utterances.json is missing u1/u2/u1b/u3 or u1.expected')
  }
  const expectedU1: ExpectedBlock = u1.expected
  const checks: Check[] = []

  // ---- P1: capture parity (voice u1 vs text u2) ----------------------------
  const p1Proposals = new Map<string, readonly ProposedEvent[]>()
  for (const [id, u, exp] of [
    ['P1/voice', u1, expectedU1],
    ['P1/text', u2, expectedU1], // parityWith: shared expected block
  ] as const) {
    const r = await adapter.submitCapture(captureOf(u, u.raw, 1, u.capturedAt))
    const failures: string[] = []
    if (r._tag !== 'Proposed') failures.push(`submit returned ${submitTag(r)}, expected Proposed`)
    if (r._tag === 'Proposed') {
      if (r.rawSha256 !== sha256Hex(u.raw)) failures.push('rawSha256 does not match the raw utterance — raw not stored byte-for-byte (G3)')
      failures.push(...expectedSetMismatches(r.proposals, exp))
      if (id === 'P1/voice') failures.push(...pottyCoverageMismatches(r.proposals))
      p1Proposals.set(u.captureId, r.proposals)
    }
    failures.push(...disclosureFailures(id, r))
    checks.push({ protocol: id, ok: failures.length === 0, failures })
  }

  // ---- P5: stale-result suppression (u1b interruption) ---------------------
  {
    const st = u1b.stale
    if (st === undefined) throw new Error('u1b.stale missing')
    // Both attempts in flight; attempt 1 must lose to attempt 2 when it
    // resolves late. A fully-synchronous adapter may resolve attempt 1 first
    // (nothing stale yet) — final-state equality still proves no clobber.
    const p1 = adapter.submitCapture(captureOf(u1b, st.fragmentRaw, st.fragmentAttempt, T.MOM_CAPTURED_AT))
    const p2 = adapter.submitCapture(captureOf(u1b, st.resumedRaw, st.resumedAttempt, T.U1B_CAPTURED_AT))
    const r2 = await p2
    const r1 = await p1
    const failures: string[] = []
    if (r2._tag !== 'Proposed') failures.push(`resumed attempt returned ${submitTag(r2)}, expected Proposed`)
    if (r1._tag === 'Proposed' && r2._tag === 'Proposed') {
      failures.push('older attempt resolved as Proposed after the newer attempt was submitted — expected Superseded (P5)')
    }
    if (r1._tag === 'Superseded' && r1.winnerAttempt !== st.resumedAttempt) {
      failures.push(`Superseded names winnerAttempt ${String(r1.winnerAttempt)}, expected ${String(st.resumedAttempt)}`)
    }
    // The winner's proposals stand; the fragment produced none.
    if (r2._tag === 'Proposed' && r2.proposals.length !== st.expectedWinnerEvents) {
      failures.push(`winner proposals: expected ${String(st.expectedWinnerEvents)} events, got ${String(r2.proposals.length)}`)
    }
    // Publish the interrupted capture: zero events must persist; nothing from the fragment.
    const pub = await adapter.publishCapture(u1b.captureId, u1b.actorId)
    if (pub._tag !== 'Published' && pub._tag !== 'AlreadyPublished') {
      failures.push(`publish of zero-proposal capture returned ${pub._tag} — extraction must never block capture`)
    }
    const hist = await adapter.readHistory({ actorId: u1b.actorId, childId: u1b.childId, from: T.MONTH_WINDOW_NOV.from, to: T.MONTH_WINDOW_NOV.to })
    if (hist._tag === 'History') {
      for (const ev of hist.events) {
        const hay = `${ev.note ?? ''}`.toLowerCase()
        if (hay.includes('wore her')) failures.push(`fragment leak in history: event ${ev.eventId} note ${JSON.stringify(ev.note)}`)
      }
    }
    checks.push({ protocol: 'P5/stale', ok: failures.length === 0, failures })
  }

  // ---- P2: idempotent publish (u1) -----------------------------------------
  {
    const proposals = p1Proposals.get(u1.captureId)
    const r1 = await adapter.publishCapture(u1.captureId, u1.actorId)
    const r2 = await adapter.publishCapture(u1.captureId, u1.actorId)
    const failures: string[] = []
    if (r1._tag !== 'Published') failures.push(`first publish returned ${r1._tag}, expected Published`)
    if (r2._tag !== 'AlreadyPublished') failures.push(`second publish returned ${r2._tag}, expected AlreadyPublished (G2)`)
    if (r1._tag === 'Published' && r2._tag === 'AlreadyPublished') {
      if (!deepEqual(r1.receipt, r2.receipt)) failures.push('receipts differ across replays — idempotent path returned a different receipt (G2)')
    }
    const hist = await adapter.readHistory({ actorId: u1.actorId, childId: u1.childId, from: T.MONTH_WINDOW_NOV.from, to: T.MONTH_WINDOW_NOV.to })
    if (hist._tag === 'History' && r1._tag === 'Published' && proposals !== undefined) {
      const entryEvents = hist.events.filter((e) => e.entryId === r1.receipt.entryId)
      if (entryEvents.length !== proposals.length) {
        failures.push(`history has ${String(entryEvents.length)} events for the entry, expected ${String(proposals.length)} — duplicate write (G2)`)
      }
      for (const ev of entryEvents) {
        if (ev.authorId !== u1.actorId) failures.push(`event ${ev.eventId} author ${ev.authorId}, expected ${u1.actorId}`)
      }
    }
    failures.push(...disclosureFailures('P2', r1), ...disclosureFailures('P2', r2))
    checks.push({ protocol: 'P2/idempotent-publish', ok: failures.length === 0, failures })
  }

  // ---- P3: no-write proof + audience (ruth) --------------------------------
  {
    const q = fixtures.questions
    const window: HistoryQuery = { actorId: 'actor-ruth', childId: u1.childId, from: T.MINI_HISTORY_WINDOW.from, to: T.MONTH_WINDOW_NOV.to }
    const before: HistoryResult = await adapter.readHistory(window)
    const failures: string[] = []
    if (before._tag !== 'History') failures.push(`ruth readHistory returned ${before._tag} — granted caregiver must read`)
    if (before._tag === 'History') {
      if (before.windowRespected !== true) failures.push('windowRespected not asserted')
      if (!before.gaps.some((g) => g.day === '2026-10-29')) failures.push(`missed day 2026-10-29 not disclosed as a gap, gaps: ${JSON.stringify(before.gaps)}`)
      for (const ev of before.events) {
        if (ev.occurredAt < window.from || ev.occurredAt > window.to) failures.push(`event ${ev.eventId} outside window (G7)`)
        if (ev.entryId === q.privateEntryId) failures.push(`private entry ${q.privateEntryId} visible to ruth (G1)`)
      }
      // Ruth (caregiver) may correct/see household events but the private-audience
      // event must be absent entirely — no leak surface.
      if (before.events.some((e) => e.eventId === 'ev-o31-private-note')) {
        failures.push('private-audience event present in ruth history (G1)')
      }
    }
    for (const [tag, question] of [['P3/q1', q.q1], ['P3/q2', q.q2], ['P3/q3-write', q.q3WriteAttempt]] as const) {
      const a: AskResult = await adapter.askQuestion({ ...question, askAt: q.askAt })
      if (a._tag === 'Answer') {
        if (a.wrote !== false) failures.push(`${tag}: answer surface declared a write (G4)`)
        if (tag !== 'P3/q3-write' && a.citations.length === 0) failures.push(`${tag}: answer has no source citations`)
        for (const c of a.citations) {
          if (c.entryId === q.privateEntryId) failures.push(`${tag}: citation leaks private entry (G1)`)
        }
      }
      failures.push(...disclosureFailures(tag, a))
    }
    const after: HistoryResult = await adapter.readHistory(window)
    if (!deepEqual(before, after)) {
      failures.push('history state changed across questions — the question surface wrote (G4)')
    }
    // Author visibility control: mom sees her own private entry.
    const momHist = await adapter.readHistory({ actorId: 'actor-mom', childId: u1.childId, from: T.MINI_HISTORY_WINDOW.from, to: T.MONTH_WINDOW_NOV.to })
    if (momHist._tag === 'History' && !momHist.events.some((e) => e.entryId === q.privateEntryId)) {
      failures.push('private entry invisible even to its author — audience filter is over-blocking')
    }
    checks.push({ protocol: 'P3/no-write+audience', ok: failures.length === 0, failures })
  }

  // ---- P4: correction lineage (u4 patch, reject, unresolved) ---------------
  {
    const corr = fixtures.corrections
    const failures: string[] = []
    // Submit u3 (dad) for the NL-correction target.
    const r3 = await adapter.submitCapture(captureOf(u3, u3.raw, 1, u3.capturedAt))
    if (r3._tag !== 'Proposed') failures.push(`u3 submit returned ${submitTag(r3)}, expected Proposed`)
    if (r3._tag === 'Proposed') {
      const sleep = r3.proposals.find((p) => p.category === corr.u4.targetCategory)
      if (sleep === undefined) failures.push('u3 has no sleep proposal to correct')
      else {
        const patched = await adapter.applyCorrection({
          captureId: corr.u4.targetCaptureId,
          eventLocalId: sleep.localId,
          action: { _tag: 'Patch', fields: { quantity: corr.u4.expectPatch.quantity } },
          authorId: corr.u4.byActorId,
          viaStatement: corr.u4.viaStatement,
        })
        if (patched._tag !== 'Revised') failures.push(`u4 patch returned ${patched._tag}, expected Revised`)
        if (patched._tag === 'Revised') {
          if (patched.originalPreserved !== true) failures.push('patch did not preserve the original (G6)')
          if (patched.supersedes !== sleep.localId) failures.push(`patch supersedes ${patched.supersedes}, expected ${sleep.localId}`)
          if (patched.byActorId !== corr.u4.byActorId) failures.push(`reviser attribution ${patched.byActorId}, expected ${corr.u4.byActorId}`)
        }
        const lineage = await adapter.readLineage({ captureId: corr.u4.targetCaptureId, actorId: corr.u4.byActorId })
        if (lineage._tag !== 'Lineage') failures.push(`readLineage returned ${lineage._tag}, expected Lineage`)
        if (lineage._tag === 'Lineage') {
          if (lineage.originalRaw !== u3.raw) failures.push('lineage originalRaw differs from the raw utterance — raw not preserved verbatim (G3)')
          const rev = lineage.revisions.find((rv) => rv.supersedes === sleep.localId)
          if (rev === undefined) failures.push('patch revision missing from lineage')
          else if (rev.original.quantity?.value !== 45) {
            failures.push(`lineage original quantity ${JSON.stringify(rev.original.quantity ?? null)}, expected the original 45 minutes (G6)`)
          }
        }
      }
      // Reject the u1 potty (dad, non-author) — revision, not hard delete.
      const u1Props = p1Proposals.get(u1.captureId)
      const potty = u1Props?.find((p) => p.category === corr.rejectTargetCategory)
      if (potty === undefined) failures.push('u1 has no potty proposal to reject')
      else {
        const rej = await adapter.applyCorrection({
          captureId: corr.rejectFromCaptureId,
          eventLocalId: potty.localId,
          action: { _tag: 'Reject' },
          authorId: corr.rejectByActorId,
        })
        if (rej._tag !== 'Revised') failures.push(`reject returned ${rej._tag}, expected Revised (rejection is a revision, G6)`)
        const lineage1 = await adapter.readLineage({ captureId: corr.rejectFromCaptureId, actorId: corr.rejectByActorId })
        if (lineage1._tag === 'Lineage') {
          const rev = lineage1.revisions.find((rv) => rv.eventLocalId === potty.localId)
          if (rev === undefined) failures.push('rejected event left no revision record — hard delete (G6)')
          else if (rev.original.category !== corr.rejectTargetCategory) failures.push('revision original does not hold the rejected record')
        }
      }
      // Unresolved reference must come back as a question, never a guess.
      const noTarget = await adapter.applyCorrection({
        captureId: corr.rejectFromCaptureId,
        eventLocalId: 'no-such-event',
        action: { _tag: 'Patch', fields: { note: 'three waffles' } },
        authorId: corr.u4.byActorId,
        viaStatement: corr.noTargetStatement,
      })
      if (noTarget._tag !== 'UnresolvedReference') failures.push(`bogus-target correction returned ${noTarget._tag}, expected UnresolvedReference (no invented targets)`)
    }
    checks.push({ protocol: 'P4/lineage', ok: failures.length === 0, failures })
  }

  // ---- P6: authorization boundary ------------------------------------------
  {
    const authz = fixtures.authorization
    const failures: string[] = []
    const marcusCapture = await adapter.submitCapture({
      captureId: 'cap-marcus-probe',
      attempt: 1,
      mode: 'text',
      raw: 'anything',
      actorId: authz.nonMemberActorId,
      childId: u1.childId,
      capturedAt: T.MOM_CAPTURED_AT,
      timezone: 'America/New_York',
    })
    if (marcusCapture._tag !== 'Refused') failures.push(`non-member submit returned ${marcusCapture._tag}, expected Refused (G1)`)
    const marcusHist = await adapter.readHistory({ actorId: authz.nonMemberActorId, childId: u1.childId, from: T.MINI_HISTORY_WINDOW.from, to: T.MONTH_WINDOW_NOV.to })
    if (marcusHist._tag !== 'Refused') failures.push(`non-member readHistory returned ${marcusHist._tag}, expected Refused (G1)`)
    const marcusAsk = await adapter.askQuestion({ actorId: authz.nonMemberActorId, childId: u1.childId, question: 'What did she eat today?', askAt: T.MOM_CAPTURED_AT })
    if (marcusAsk._tag !== 'Refused') failures.push(`non-member ask returned ${marcusAsk._tag}, expected Refused (G1)`)
    const marcusCorr = await adapter.applyCorrection({ captureId: u1.captureId, eventLocalId: 'any', action: { _tag: 'Reject' }, authorId: authz.nonMemberActorId })
    if (marcusCorr._tag !== 'Refused') failures.push(`non-member correction returned ${marcusCorr._tag}, expected Refused (G1)`)
    const theo = await adapter.readHistory({ actorId: 'actor-ruth', childId: authz.outOfScopeChildId, from: T.MINI_HISTORY_WINDOW.from, to: T.MONTH_WINDOW_NOV.to })
    if (theo._tag !== 'Refused') failures.push(`out-of-scope child read returned ${theo._tag}, expected Refused (G1)`)
    // Positive control: authorized reads still work after the refusals.
    const dad = await adapter.readHistory({ actorId: 'actor-dad', childId: u1.childId, from: T.MINI_HISTORY_WINDOW.from, to: T.MONTH_WINDOW_NOV.to })
    if (dad._tag !== 'History') failures.push(`authorized dad readHistory returned ${dad._tag} — adapter must not refuse everyone`)
    for (const [tag, r] of [
      ['P6/submit', marcusCapture],
      ['P6/history', marcusHist],
      ['P6/ask', marcusAsk],
      ['P6/correct', marcusCorr],
      ['P6/scope', theo],
    ] as const) {
      failures.push(...disclosureFailures(tag, r))
    }
    checks.push({ protocol: 'P6/authorization', ok: failures.length === 0, failures })
  }

  return checks
}

async function loadHomeAdapter(adapterArg: string | undefined): Promise<HomeCandidateAdapter> {
  if (adapterArg === undefined) {
    const mod = await import('./example/home-example-adapter.ts')
    return mod.createAdapter()
  }
  const { pathToFileURL, fileURLToPath } = await import('node:url')
  const { resolve } = await import('node:path')
  const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
  const modulePath = pathToFileURL(resolve(packageRoot, adapterArg)).href
  const mod = (await import(modulePath)) as { createAdapter?: unknown }
  if (typeof mod.createAdapter !== 'function') {
    throw new Error(`adapter module ${adapterArg} must export a named factory: createAdapter(): HomeCandidateAdapter`)
  }
  const adapter = (mod.createAdapter as () => HomeCandidateAdapter)()
  if (typeof adapter?.name !== 'string' || adapter.name.length === 0) {
    throw new Error(`adapter factory in ${adapterArg} returned an object without a non-empty "name"`)
  }
  return adapter
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const adapterArg = args.find((a) => a.startsWith('--adapter='))?.slice('--adapter='.length)
  const expectFailure = args.includes('--expect-failure')

  const adapter = await loadHomeAdapter(adapterArg)
  const checks = await runProtocols(adapter)

  console.log(`\nParent-home journey protocols — adapter: ${adapter.name}`)
  console.log('Evidence label: DETERMINISTIC TEST DOUBLE (no live LLM, no device, no cloud)')
  console.log('='.repeat(72))
  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.protocol}`)
    for (const f of c.failures) console.log(`         - ${f}`)
  }
  console.log('='.repeat(72))
  const failed = checks.filter((c) => !c.ok).length
  console.log(`${String(checks.length - failed)}/${String(checks.length)} protocols passed`)
  if (expectFailure) {
    console.log(failed > 0 ? 'Negative control: failures detected as expected.' : 'Negative control: adapter passed unexpectedly — it should violate the gates.')
    return failed > 0 ? 0 : 1
  }
  return failed === 0 ? 0 : 1
}

process.exitCode = await main()
