/**
 * The harness core: runs each fixture kind against a CandidateAdapter with a
 * fixed protocol. The protocol is identical for every candidate; all
 * expectations come from fixture data. Adapter exceptions are recorded as
 * fixture failures, never swallowed and never fatal to the run.
 */
import type { CandidateAdapter, CreateEntryInput, WireEntry } from './adapter.ts'
import type { CaptureContext, EventExpectation, Fixture } from './fixtures.ts'
import { canonicalJson, deepEqual, eventMismatches, sha256Hex } from './match.ts'

export interface FixtureResult {
  readonly fixtureId: string
  readonly ok: boolean
  readonly failures: readonly string[]
  /** Human-readable context for the summary table (e.g. case counts). */
  readonly note?: string
}

export interface RunSummary {
  readonly adapterName: string
  readonly results: readonly FixtureResult[]
  readonly ok: boolean
  readonly passed: number
  readonly failed: number
}

function toInput(
  capture: CaptureContext,
  captureId: string,
  transcript: string,
): CreateEntryInput {
  return {
    captureId,
    transcript,
    authorId: capture.authorId,
    capturedAt: capture.capturedAt,
    timezone: capture.timezone,
  }
}

/** Contract-level checks applied to every entry an adapter hands back. */
function entryBasicsMismatches(entry: WireEntry, input: CreateEntryInput): readonly string[] {
  const bad: string[] = []
  if (entry._tag !== 'Entry') bad.push(`_tag must be "Entry", got ${JSON.stringify(entry._tag)}`)
  if (entry.captureId !== input.captureId) {
    bad.push(`captureId: expected "${input.captureId}", got ${JSON.stringify(entry.captureId)}`)
  }
  if (entry.status !== 'draft') {
    bad.push(`status right after creation must be "draft" (review/publish happens later), got ${JSON.stringify(entry.status)}`)
  }
  if (entry.authorId !== input.authorId) {
    bad.push(`entry.authorId: expected "${input.authorId}", got ${JSON.stringify(entry.authorId)}`)
  }
  if (typeof entry.createdAt !== 'number' || !Number.isFinite(entry.createdAt)) {
    bad.push(`createdAt must be a finite Unix-ms number, got ${JSON.stringify(entry.createdAt)}`)
  }
  return bad
}

/** Exact count + index-by-index comparison (transcript order). */
function checkEvents(
  observed: readonly unknown[],
  expected: readonly EventExpectation[],
  authorId: string,
  label: string,
): readonly string[] {
  const bad: string[] = []
  if (observed.length !== expected.length) {
    bad.push(`${label}: expected ${expected.length} event(s), got ${observed.length}`)
  }
  const pairs = expected.map((exp, i) => [i, exp, observed[i]] as const)
  for (const [i, exp, obs] of pairs) {
    if (obs === undefined) break // count mismatch already reported
    for (const m of eventMismatches(obs, exp, authorId)) {
      bad.push(`${label}: event[${i}] — ${m}`)
    }
  }
  return bad
}

function rawNotPreserved(input: string, stored: string): string | undefined {
  return input === stored ? undefined : 'raw transcript is not byte-equal to the input — transcripts must be preserved verbatim (no trim/normalize/re-encode)'
}

async function runMultiEvent(adapter: CandidateAdapter, fixture: Extract<Fixture, { kind: 'multi-event-narrative' }>): Promise<FixtureResult> {
  const failures: string[] = []
  const input = toInput(fixture.capture, `cap-${fixture.id}`, fixture.input.transcript)
  const result = await adapter.createEntry(input)
  if (result._tag !== 'Created') {
    failures.push(`expected Created, got ${result._tag}${result._tag === 'Rejected' ? `: "${result.reason}"` : ''}`)
  } else {
    failures.push(...entryBasicsMismatches(result.entry, input))
    const rawIssue = rawNotPreserved(input.transcript, result.entry.transcript)
    if (rawIssue) failures.push(rawIssue)
    failures.push(...checkEvents(result.entry.events, fixture.expected.events, input.authorId, fixture.id))
  }
  return { fixtureId: fixture.id, ok: failures.length === 0, failures, note: `${fixture.expected.events.length} events` }
}

async function runRelativeTime(adapter: CandidateAdapter, fixture: Extract<Fixture, { kind: 'relative-time' }>): Promise<FixtureResult> {
  const failures: string[] = []
  for (const c of fixture.cases) {
    const input: CreateEntryInput = {
      captureId: c.captureId,
      transcript: c.transcript,
      authorId: fixture.authorId,
      capturedAt: c.capturedAt,
      timezone: c.timezone,
    }
    const result = await adapter.createEntry(input)
    if (result._tag !== 'Created') {
      failures.push(`[${c.id}] expected Created, got ${result._tag}${result._tag === 'Rejected' ? `: "${result.reason}"` : ''}`)
      continue
    }
    failures.push(...entryBasicsMismatches(result.entry, input).map((m) => `[${c.id}] ${m}`))
    const rawIssue = rawNotPreserved(c.transcript, result.entry.transcript)
    if (rawIssue) failures.push(`[${c.id}] ${rawIssue}`)
    if (result.entry.events.length !== 1) {
      failures.push(`[${c.id}] expected exactly 1 event, got ${result.entry.events.length}`)
    } else {
      failures.push(...eventMismatches(result.entry.events[0], c.expected, input.authorId).map((m) => `[${c.id}] ${m}`))
    }
  }
  return { fixtureId: fixture.id, ok: failures.length === 0, failures, note: `${fixture.cases.length} cases` }
}

async function runMalformed(adapter: CandidateAdapter, fixture: Extract<Fixture, { kind: 'malformed-extraction' }>): Promise<FixtureResult> {
  const failures: string[] = []
  const input = toInput(fixture.capture, fixture.input.captureId, fixture.input.transcript)
  const result = await adapter.createEntry(input)
  // Contract (art_I2TCG08V): "May be empty — extraction failure never blocks capture."
  if (result._tag === 'Rejected') {
    failures.push(`capture was Rejected ("${result.reason}") but the contract forbids blocking capture on extraction failure`)
  } else {
    const entry = result.entry
    failures.push(...entryBasicsMismatches(entry, input))
    if (entry.events.length !== fixture.expected.events.length) {
      failures.push(`expected ${fixture.expected.events.length} persisted events (extraction must fail without persisting anything), got ${entry.events.length}`)
    }
    const rawIssue = rawNotPreserved(fixture.input.transcript, entry.transcript)
    if (rawIssue) failures.push(rawIssue)
  }
  return { fixtureId: fixture.id, ok: failures.length === 0, failures, note: 'failure path, raw preserved' }
}

async function runRetryDoubleSubmit(adapter: CandidateAdapter, fixture: Extract<Fixture, { kind: 'retry-double-submit' }>): Promise<FixtureResult> {
  const failures: string[] = []
  const input = toInput(fixture.capture, fixture.input.captureId, fixture.input.transcript)

  const first = await adapter.createEntry(input)
  if (first._tag !== 'Created') {
    failures.push(`first submission: expected Created, got ${first._tag}${first._tag === 'Rejected' ? `: "${first.reason}"` : ''}`)
  }
  const second = await adapter.createEntry(input) // identical retry
  if (second._tag !== 'IdempotentReplay') {
    failures.push(`second submission (same captureId): expected IdempotentReplay, got ${second._tag}`)
  }
  if (first._tag === 'Created' && second._tag === 'IdempotentReplay') {
    if (!deepEqual(first.entry, second.entry)) {
      failures.push('replayed entry differs from the originally created entry (must return the existing record)')
    }
    failures.push(...entryBasicsMismatches(first.entry, input))
    failures.push(...checkEvents(first.entry.events, fixture.expected.events, input.authorId, fixture.id))
    const rawIssue = rawNotPreserved(input.transcript, first.entry.transcript)
    if (rawIssue) failures.push(rawIssue)
  }

  const timeline = await adapter.readTimeline()
  const forCapture = timeline.filter((e) => e.captureId === fixture.input.captureId)
  if (forCapture.length !== 1) {
    failures.push(`timeline: expected exactly 1 entry for captureId "${fixture.input.captureId}", got ${forCapture.length} — duplicate protection failed`)
  } else {
    const storedEntry = forCapture[0]
    if (storedEntry !== undefined) {
      failures.push(...checkEvents(storedEntry.events, fixture.expected.events, input.authorId, `${fixture.id}/timeline`))
    }
  }
  return { fixtureId: fixture.id, ok: failures.length === 0, failures, note: 'exactly one entry, no duplicate events' }
}

async function runRawFidelity(adapter: CandidateAdapter, fixture: Extract<Fixture, { kind: 'raw-fidelity' }>): Promise<FixtureResult> {
  const failures: string[] = []
  for (const c of fixture.cases) {
    const input = toInput(fixture.capture, c.captureId, c.transcript)
    const first = await adapter.createEntry(input)
    if (c.expectCreated && first._tag !== 'Created') {
      failures.push(`[${c.id}] expected Created, got ${first._tag}${first._tag === 'Rejected' ? `: "${first.reason}"` : ''}`)
      continue
    }
    if (!c.expectCreated && first._tag !== 'Rejected') {
      failures.push(`[${c.id}] expected Rejected, got ${first._tag}`)
      continue
    }
    if (first._tag === 'Created') {
      failures.push(...checkEvents(first.entry.events, c.expectedEvents, input.authorId, `[${c.id}]`))
      const shaInput = sha256Hex(c.transcript)
      const shaCreated = sha256Hex(first.entry.transcript)
      if (shaInput !== shaCreated) failures.push(`[${c.id}] created entry transcript is not byte-equal to the input (sha256 ${shaInput} vs ${shaCreated})`)
    }
    const second = await adapter.createEntry(input) // retry after the failure
    if (second._tag !== 'IdempotentReplay') {
      failures.push(`[${c.id}] retry after failure: expected IdempotentReplay, got ${second._tag}`)
    } else if (sha256Hex(c.transcript) !== sha256Hex(second.entry.transcript)) {
      failures.push(`[${c.id}] replayed entry transcript is not byte-equal to the input`)
    }
    const stored = (await adapter.readTimeline()).find((e) => e.captureId === c.captureId)
    if (stored === undefined) {
      failures.push(`[${c.id}] timeline has no entry for captureId "${c.captureId}"`)
    } else if (sha256Hex(c.transcript) !== sha256Hex(stored.transcript)) {
      failures.push(`[${c.id}] timeline-read transcript is not byte-equal to the input`)
    }
  }
  return { fixtureId: fixture.id, ok: failures.length === 0, failures, note: `${fixture.cases.length} cases, sha256-checked` }
}

function sortEntries(entries: readonly WireEntry[]): readonly WireEntry[] {
  return [...entries].sort((a, b) => a.createdAt - b.createdAt || (a.captureId < b.captureId ? -1 : a.captureId > b.captureId ? 1 : 0))
}

async function runReload(adapter: CandidateAdapter, fixture: Extract<Fixture, { kind: 'reload-persistence' }>): Promise<FixtureResult> {
  const failures: string[] = []
  for (const input of fixture.inputs) {
    const entryInput = toInput(fixture.capture, input.captureId, input.transcript)
    const result = await adapter.createEntry(entryInput)
    if (result._tag !== 'Created') {
      failures.push(`[${input.captureId}] expected Created, got ${result._tag}${result._tag === 'Rejected' ? `: "${result.reason}"` : ''}`)
    } else {
      failures.push(...checkEvents(result.entry.events, input.expected.events, entryInput.authorId, `[${input.captureId}]`))
      const rawIssue = rawNotPreserved(input.transcript, result.entry.transcript)
      if (rawIssue) failures.push(`[${input.captureId}] ${rawIssue}`)
    }
  }

  const before = await adapter.readTimeline()
  await adapter.reload()
  const after = await adapter.readTimeline()

  const beforeCanon = canonicalJson(sortEntries(before))
  const afterCanon = canonicalJson(sortEntries(after))
  if (beforeCanon !== afterCanon) {
    const preview = (s: string) => (s.length > 240 ? `${s.slice(0, 240)}…` : s)
    failures.push(`timeline changed across reload — before: ${preview(beforeCanon)} / after: ${preview(afterCanon)}`)
  }
  for (const input of fixture.inputs) {
    const entry = after.find((e) => e.captureId === input.captureId)
    if (entry === undefined) {
      failures.push(`[${input.captureId}] entry lost after reload`)
    } else {
      failures.push(...checkEvents(entry.events, input.expected.events, fixture.capture.authorId, `[${input.captureId}]/after-reload`))
    }
  }
  return { fixtureId: fixture.id, ok: failures.length === 0, failures, note: `${fixture.inputs.length} entries, cold-start` }
}

async function runOne(adapter: CandidateAdapter, fixture: Fixture): Promise<FixtureResult> {
  try {
    switch (fixture.kind) {
      case 'multi-event-narrative':
        return await runMultiEvent(adapter, fixture)
      case 'relative-time':
        return await runRelativeTime(adapter, fixture)
      case 'malformed-extraction':
        return await runMalformed(adapter, fixture)
      case 'retry-double-submit':
        return await runRetryDoubleSubmit(adapter, fixture)
      case 'raw-fidelity':
        return await runRawFidelity(adapter, fixture)
      case 'reload-persistence':
        return await runReload(adapter, fixture)
    }
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return { fixtureId: fixture.id, ok: false, failures: [`adapter threw an unexpected error — ${message}`] }
  }
}

export async function runCorpus(adapter: CandidateAdapter, fixtures: readonly Fixture[]): Promise<RunSummary> {
  const results: FixtureResult[] = []
  for (const fixture of fixtures) {
    results.push(await runOne(adapter, fixture))
  }
  const failed = results.filter((r) => !r.ok).length
  return { adapterName: adapter.name, results, ok: failed === 0, passed: results.length - failed, failed }
}
