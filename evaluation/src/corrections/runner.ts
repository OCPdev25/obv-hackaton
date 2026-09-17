/**
 * Deterministic runner for the conversational correction challenge corpus.
 * Candidate-agnostic: drives any CorrectionCandidateAdapter through setup,
 * challenge turns, replay probes, and final-state assertions. Every check
 * produces a failure string; a case passes only with zero failures.
 */
import type { CorrectionCandidateAdapter, HouseholdEnv, JournalEntry, JournalEvent, UtteranceTurn } from './adapter.ts'
import type {
  CorrectionCaseFixture,
  EventExpectationFixture,
  NewEntryExpectationFixture,
} from './fixture-types.ts'

export interface CorrectionResult {
  caseId: string
  ok: boolean
  failures: string[]
}

export interface CorrectionSummary {
  adapterName: string
  results: CorrectionResult[]
  passed: number
  ok: boolean
}

/** Stable JSON for state-equality snapshots (sorted keys, deterministic). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

interface KnownEntryState {
  transcript: string
  authorId: string
  status: string
  childId: string
}

function failInto(failures: string[], message: string): void {
  failures.push(message)
}

function matchEvents(
  events: readonly JournalEvent[],
  expectations: readonly EventExpectationFixture[],
  ctx: string,
  failures: string[],
): void {
  const byCategory = new Map<string, JournalEvent[]>()
  for (const e of events) {
    const list = byCategory.get(e.category) ?? []
    list.push(e)
    byCategory.set(e.category, list)
  }
  const wantByCategory = new Map<string, EventExpectationFixture[]>()
  for (const x of expectations) {
    const list = wantByCategory.get(x.category) ?? []
    list.push(x)
    wantByCategory.set(x.category, list)
  }
  for (const [cat, wants] of wantByCategory) {
    const have = byCategory.get(cat) ?? []
    if (have.length !== wants.length) {
      failInto(failures, `${ctx}: ${have.length} ${cat} event(s) present, expected ${wants.length}`)
      continue
    }
    wants.forEach((w, i) => {
      const ev = have[i]
      if (ev === undefined) return
      const tolerance = w.toleranceMs ?? 0
      if (Math.abs(ev.occurredAt - w.occurredAt) > tolerance) {
        failInto(failures, `${ctx}: ${cat} event occurredAt ${ev.occurredAt}, expected ${w.occurredAt} (+/-${tolerance}ms)`)
      }
      if (w.quantity === null) {
        if (ev.quantity !== undefined) {
          failInto(failures, `${ctx}: ${cat} event must not carry a quantity (zero-care representation)`)
        }
      } else if (w.quantity !== undefined) {
        if (ev.quantity?.value !== w.quantity.value || ev.quantity?.unit !== w.quantity.unit) {
          failInto(failures, `${ctx}: ${cat} event quantity mismatch`)
        }
      }
      const note = (ev.note ?? '').toLowerCase()
      for (const needle of w.noteContains ?? []) {
        if (!note.includes(needle.toLowerCase())) {
          failInto(failures, `${ctx}: ${cat} event note missing "${needle}"`)
        }
      }
      for (const needle of w.noteNotContains ?? []) {
        if (note.includes(needle.toLowerCase())) {
          failInto(failures, `${ctx}: ${cat} event note must not contain "${needle}"`)
        }
      }
    })
  }
  for (const [cat, have] of byCategory) {
    if (!wantByCategory.has(cat) && have.length > 0) {
      failInto(failures, `${ctx}: unexpected ${cat} event(s) present`)
    }
  }
}

function checkNewEntry(
  n: NewEntryExpectationFixture,
  entry: JournalEntry,
  ctx: string,
  failures: string[],
  kinds: string[],
): void {
  if (entry.childId !== n.childId) failInto(failures, `${ctx}: childId ${entry.childId}, expected ${n.childId}`)
  if (entry.authorId !== n.authorId) failInto(failures, `${ctx}: authorId ${entry.authorId}, expected ${n.authorId}`)
  if (entry.status !== n.status) failInto(failures, `${ctx}: status ${entry.status}, expected ${n.status}`)
  matchEvents(entry.events, n.events, ctx, failures)
  if (n.revisionKinds !== undefined && kinds.join(',') !== n.revisionKinds.join(',')) {
    failInto(failures, `${ctx}: revision kinds [${kinds.join(',')}] expected [${n.revisionKinds.join(',')}]`)
  }
}

async function runCase(
  factory: (env: HouseholdEnv) => CorrectionCandidateAdapter,
  env: HouseholdEnv,
  testCase: CorrectionCaseFixture,
): Promise<CorrectionResult> {
  const failures: string[] = []
  const adapter = factory(env)
  const known = new Map<string, KnownEntryState>()
  let journal = await adapter.readJournal()
  const read = async (): Promise<void> => {
    journal = await adapter.readJournal()
  }
  const toUtterance = (t: {
    turnId: string
    speakerId: string
    capturedAt: number
    text: string
    correctionId?: string
    captureId?: string
    seedEvents?: unknown
  }): UtteranceTurn => {
    const u: UtteranceTurn = {
      turnId: t.turnId,
      speakerId: t.speakerId,
      text: t.text,
      capturedAt: t.capturedAt,
      ...(t.correctionId !== undefined ? { correctionId: t.correctionId } : {}),
      ...(t.captureId !== undefined ? { captureId: t.captureId } : {}),
      ...(t.seedEvents !== undefined ? { seedEvents: t.seedEvents as UtteranceTurn['seedEvents'] } : {}),
    }
    return u
  }

  // --- setup ---
  for (const t of testCase.setup.turns) {
    const outcome = await adapter.processTurn(toUtterance(t))
    if (outcome.responseClass !== 'applied') {
      failInto(failures, `setup turn ${t.turnId}: expected applied, got ${outcome.responseClass}${outcome.reason !== undefined ? ` (${outcome.reason})` : ''}`)
    }
    if (t.captureId !== undefined) {
      await read()
      const e = journal.entries.find((x) => x.captureId === t.captureId)
      if (e === undefined) {
        failInto(failures, `setup turn ${t.turnId}: expected entry ${t.captureId} to exist after capture`)
      } else {
        known.set(t.captureId, {
          transcript: e.rawTranscript,
          authorId: e.authorId,
          status: e.status,
          childId: e.childId,
        })
      }
    }
  }
  for (const captureId of testCase.setup.publish ?? []) {
    await adapter.publishEntry(captureId)
    await read()
    const e = journal.entries.find((x) => x.captureId === captureId)
    if (e === undefined) {
      failInto(failures, `publish: entry ${captureId} missing`)
    } else {
      const k = known.get(captureId)
      if (k !== undefined) k.status = e.status
      if (e.status !== 'published') failInto(failures, `publish: entry ${captureId} status ${e.status}, expected published`)
    }
  }

  await read()
  if (journal.entries.length !== testCase.setup.baseline.entryCount) {
    failInto(failures, `baseline: ${journal.entries.length} entries, expected ${testCase.setup.baseline.entryCount}`)
  }
  for (const chk of testCase.setup.baseline.entries ?? []) {
    const e = journal.entries.find((x) => x.captureId === chk.ofCaptureId)
    if (e === undefined) {
      failInto(failures, `baseline: entry ${chk.ofCaptureId} missing`)
      continue
    }
    if (chk.status !== undefined && e.status !== chk.status) {
      failInto(failures, `baseline ${chk.ofCaptureId}: status ${e.status}, expected ${chk.status}`)
    }
    if (chk.events !== undefined) matchEvents(e.events, chk.events, `baseline ${chk.ofCaptureId}`, failures)
  }
  for (const [cap, kinds] of Object.entries(testCase.setup.baseline.revisionKinds ?? {})) {
    const actual = journal.revisions.filter((r) => r.entryCaptureId === cap).map((r) => r.kind)
    if (actual.join(',') !== kinds.join(',')) {
      failInto(failures, `baseline ${cap}: revision kinds [${actual.join(',')}] expected [${kinds.join(',')}]`)
    }
  }

  let before = canonicalJson(journal)
  let prevCount = journal.entries.length
  const turnCreated: string[] = []
  const revCounts = new Map<string, number>()
  for (const r of journal.revisions) {
    revCounts.set(r.entryCaptureId, (revCounts.get(r.entryCaptureId) ?? 0) + 1)
  }

  // --- challenge turns ---
  for (const t of testCase.turns) {
    const outcome = await adapter.processTurn(toUtterance(t))
    if (outcome.responseClass !== t.expect.responseClass) {
      failInto(failures, `turn ${t.turnId}: expected ${t.expect.responseClass}, got ${outcome.responseClass}${outcome.reason !== undefined ? ` (${outcome.reason})` : ''}`)
    }
    await read()
    const after = canonicalJson(journal)
    const delta = t.expect.stateDelta
    if (delta === 'none') {
      if (after !== before) failInto(failures, `turn ${t.turnId}: state changed on a no-write turn`)
    } else {
      const newOnes = journal.entries.filter((e) => !known.has(e.captureId))
      const expectedCount = delta?.entryCountDelta !== undefined
        ? prevCount + delta.entryCountDelta
        : delta?.newEntries !== undefined
          ? prevCount + delta.newEntries.length
          : prevCount
      if (journal.entries.length !== expectedCount) {
        failInto(failures, `turn ${t.turnId}: ${journal.entries.length} entries after turn, expected ${expectedCount}`)
      }
      for (const [cap, k] of known) {
        const e = journal.entries.find((x) => x.captureId === cap)
        if (e === undefined) {
          failInto(failures, `turn ${t.turnId}: entry ${cap} disappeared`)
          continue
        }
        if (e.rawTranscript !== k.transcript) failInto(failures, `turn ${t.turnId}: raw transcript of ${cap} mutated`)
        if (e.authorId !== k.authorId) failInto(failures, `turn ${t.turnId}: original authorId of ${cap} rewritten`)
        if (e.status !== k.status) failInto(failures, `turn ${t.turnId}: status of ${cap} changed without publish (${k.status} -> ${e.status})`)
      }
      for (const ch of delta?.entryChanges ?? []) {
        const e = journal.entries.find((x) => x.captureId === ch.ofCaptureId)
        if (e === undefined) {
          failInto(failures, `turn ${t.turnId}: expected entry ${ch.ofCaptureId} present`)
          continue
        }
        if (ch.childId !== undefined && e.childId !== ch.childId) {
          failInto(failures, `turn ${t.turnId}: ${ch.ofCaptureId} childId ${e.childId}, expected ${ch.childId}`)
        }
        if (ch.status !== undefined && e.status !== ch.status) {
          failInto(failures, `turn ${t.turnId}: ${ch.ofCaptureId} status ${e.status}, expected ${ch.status}`)
        }
        if (ch.authorIdMustRemain !== undefined && e.authorId !== ch.authorIdMustRemain) {
          failInto(failures, `turn ${t.turnId}: ${ch.ofCaptureId} authorId ${e.authorId}, expected ${ch.authorIdMustRemain}`)
        }
        if (ch.transcriptUnchanged === true) {
          const k = known.get(ch.ofCaptureId)
          if (k !== undefined && e.rawTranscript !== k.transcript) {
            failInto(failures, `turn ${t.turnId}: ${ch.ofCaptureId} transcript changed`)
          }
        }
        if (ch.events !== undefined) matchEvents(e.events, ch.events, `turn ${t.turnId} ${ch.ofCaptureId}`, failures)
      }
      const expectedNew = delta?.newEntries ?? []
      if (newOnes.length !== expectedNew.length) {
        failInto(failures, `turn ${t.turnId}: ${newOnes.length} new entries, expected ${expectedNew.length}`)
      }
      for (let i = 0; i < Math.min(newOnes.length, expectedNew.length); i++) {
        const n = newOnes[i] as JournalEntry
        const x = expectedNew[i] as NewEntryExpectationFixture
        const kinds = journal.revisions.filter((r) => r.entryCaptureId === n.captureId).map((r) => r.kind)
        checkNewEntry(x, n, `turn ${t.turnId} new entry ${n.captureId}`, failures, kinds)
        known.set(n.captureId, {
          transcript: n.rawTranscript,
          authorId: n.authorId,
          status: n.status,
          childId: n.childId,
        })
        turnCreated.push(n.captureId)
        revCounts.set(n.captureId, kinds.length)
      }
      for (const ar of delta?.appendedRevisions ?? []) {
        const all = journal.revisions.filter((r) => r.entryCaptureId === ar.ofCaptureId)
        const prev = revCounts.get(ar.ofCaptureId) ?? 0
        const appended = all.slice(prev)
        const want = ar.count ?? 1
        if (appended.length !== want) {
          failInto(failures, `turn ${t.turnId}: expected ${want} new revision(s) on ${ar.ofCaptureId}, got ${appended.length}`)
        }
        for (const r of appended) {
          if (r.kind !== ar.kind) {
            failInto(failures, `turn ${t.turnId}: new revision on ${ar.ofCaptureId} kind ${r.kind}, expected ${ar.kind}`)
          }
          if (r.authorId !== ar.authorId) {
            failInto(failures, `turn ${t.turnId}: new revision on ${ar.ofCaptureId} author ${r.authorId}, expected ${ar.authorId}`)
          }
        }
        revCounts.set(ar.ofCaptureId, all.length)
      }
    }
    for (const e of journal.entries) {
      const k = known.get(e.captureId)
      if (k !== undefined) {
        k.transcript = e.rawTranscript
        k.authorId = e.authorId
        k.status = e.status
        k.childId = e.childId
      }
    }
    prevCount = journal.entries.length
    before = canonicalJson(journal)
  }

  // --- replay probe ---
  if (testCase.replay !== undefined) {
    const t = testCase.turns[testCase.replay.turnIndex]
    if (t === undefined) {
      failInto(failures, `replay: turnIndex ${testCase.replay.turnIndex} out of range`)
    } else {
      const outcome = await adapter.processTurn(toUtterance(t))
      const wantCls = testCase.replay.expectResponseClass ?? t.expect.responseClass
      if (outcome.responseClass !== wantCls) {
        failInto(failures, `replay: expected ${wantCls}, got ${outcome.responseClass}${outcome.reason !== undefined ? ` (${outcome.reason})` : ''}`)
      }
      await read()
      if (canonicalJson(journal) !== before) {
        failInto(failures, 'replay: journal mutated on a replayed turn (idempotency violation)')
      }
    }
  }

  // --- final state ---
  await read()
  if (journal.entries.length !== testCase.final.entryCount) {
    failInto(failures, `final: ${journal.entries.length} entries, expected ${testCase.final.entryCount}`)
  }
  for (const fe of testCase.final.entries ?? []) {
    const e = journal.entries.find((x) => x.captureId === fe.ofCaptureId)
    if (e === undefined) {
      failInto(failures, `final: entry ${fe.ofCaptureId} missing`)
      continue
    }
    if (e.childId !== fe.childId) failInto(failures, `final ${fe.ofCaptureId}: childId ${e.childId}, expected ${fe.childId}`)
    if (e.authorId !== fe.authorId) failInto(failures, `final ${fe.ofCaptureId}: authorId ${e.authorId}, expected ${fe.authorId}`)
    if (e.status !== fe.status) failInto(failures, `final ${fe.ofCaptureId}: status ${e.status}, expected ${fe.status}`)
    if (e.rawTranscript !== fe.transcriptByteEquals) {
      failInto(failures, `final ${fe.ofCaptureId}: raw transcript not byte-equal to the original capture`)
    }
    matchEvents(e.events, fe.events, `final ${fe.ofCaptureId}`, failures)
    const kinds = journal.revisions.filter((r) => r.entryCaptureId === fe.ofCaptureId).map((r) => r.kind)
    if (kinds.join(',') !== fe.revisionKinds.join(',')) {
      failInto(failures, `final ${fe.ofCaptureId}: revision kinds [${kinds.join(',')}] expected [${fe.revisionKinds.join(',')}]`)
    }
    if (fe.lastRevisionAuthorId !== undefined) {
      const last = journal.revisions.filter((r) => r.entryCaptureId === fe.ofCaptureId).at(-1)
      if (last === undefined || last.authorId !== fe.lastRevisionAuthorId) {
        failInto(failures, `final ${fe.ofCaptureId}: last revision author ${last?.authorId ?? 'none'}, expected ${fe.lastRevisionAuthorId}`)
      }
    }
  }
  const finalNew = testCase.final.newEntries ?? []
  if (turnCreated.length !== finalNew.length) {
    failInto(failures, `final: ${turnCreated.length} entries created during turns, expected ${finalNew.length}`)
  }
  for (let i = 0; i < Math.min(turnCreated.length, finalNew.length); i++) {
    const captureId = turnCreated[i] as string
    const x = finalNew[i] as NewEntryExpectationFixture
    const n = journal.entries.find((e) => e.captureId === captureId)
    if (n === undefined) {
      failInto(failures, `final: turn-created entry ${captureId} missing at final state`)
      continue
    }
    const kinds = journal.revisions.filter((r) => r.entryCaptureId === captureId).map((r) => r.kind)
    checkNewEntry(x, n, `final new entry ${captureId}`, failures, kinds)
  }

  return { caseId: testCase.id, ok: failures.length === 0, failures }
}

export async function runCorrectionCorpus(
  factory: (env: HouseholdEnv) => CorrectionCandidateAdapter,
  env: HouseholdEnv,
  cases: readonly CorrectionCaseFixture[],
): Promise<CorrectionSummary> {
  const probe = factory(env)
  const adapterName = probe.name
  const results: CorrectionResult[] = []
  for (const testCase of cases) {
    results.push(await runCase(factory, env, testCase))
  }
  const passed = results.filter((r) => r.ok).length
  return { adapterName, results, passed, ok: passed === results.length }
}
