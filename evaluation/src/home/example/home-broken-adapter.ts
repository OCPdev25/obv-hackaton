/**
 * NEGATIVE CONTROL — deliberately violates the parent-home gates. Run with:
 *   bun src/home/run.ts --adapter=./src/home/example/home-broken-adapter.ts --expect-failure
 * The run MUST report failures (exit 0 with --expect-failure). If this
 * adapter passes any gate check, the pack is not strict enough.
 *
 * Violations baked in (one per gate):
 *   G3  normalizes the raw to lowercase before hashing/storing
 *   G2  every publish writes a fresh entry with a new receipt (duplicate writes)
 *   G4  "log that ..." from the question surface silently appends an event
 *   G5  "three heads" fiction becomes a milestone event with quantity 3
 *   G6  rejects hard-delete the proposal; lineage loses the original
 *   G1  non-member reads are served everything, private entry included
 *   P5  an older attempt resolving late CLOBBERS the newer winner
 */
import type {
  AskInput,
  AskResult,
  CaptureInput,
  CorrectionInput,
  CorrectionResult,
  EventCategory,
  HistoryEvent,
  HistoryGap,
  HistoryQuery,
  HistoryResult,
  HomeCandidateAdapter,
  LineageQuery,
  LineageResult,
  ProposedEvent,
  PublishReceipt,
  PublishResult,
  Quantity,
  SubmitResult,
} from '../adapter.ts'
import { sha256Hex } from '../../match.ts'
import * as T from '../timestamps.ts'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function zonedWallToEpoch(capturedAt: number, timezone: string, hour: number, minute = 0): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(capturedAt))
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value)
  const y = get('year')
  const mo = get('month')
  const d = get('day')
  const wallNow = Date.UTC(y, mo - 1, d, get('hour'), get('minute'))
  return Date.UTC(y, mo - 1, d, hour, minute) + (capturedAt - wallNow)
}

function extractBroken(input: CaptureInput): ProposedEvent[] {
  const out: ProposedEvent[] = []
  const raw = input.raw // NOTE: already lowercased by the caller — G3 leak
  const wall = (h: number, m = 0): number => zonedWallToEpoch(input.capturedAt, input.timezone, h, m)
  let n = 0
  const push = (p: Omit<ProposedEvent, '_tag' | 'localId'>): void => {
    out.push({ _tag: 'ProposedEvent', localId: `bx-${String(n++)}`, ...p })
  }
  const meal = /half a ([a-z]+) at (\d{1,2})/i.exec(raw)
  if (meal && meal[1] !== undefined && meal[2] !== undefined) {
    push({ category: 'meal', occurredAt: wall(Number(meal[2])), quantity: { value: 0.5, unit: meal[1] }, note: `${meal[1]} meal`, confidence: 0.95 })
  }
  const meal2 = /two full servings of ([a-z]+)/i.exec(raw)
  if (meal2 && meal2[1] !== undefined) {
    push({ category: 'meal', quantity: { value: 2, unit: 'servings' }, note: `${meal2[1]} at lunch`, confidence: 0.9 })
  }
  if (/meltdown/i.test(raw)) push({ category: 'mood', note: 'meltdown at drop-off', confidence: 0.7 })
  const sv = /nap at (\d{1,2}):(\d{2}) and slept till (\d{1,2})/i.exec(raw)
  if (sv && sv[1] !== undefined && sv[2] !== undefined && sv[3] !== undefined) {
    const start = wall(Number(sv[1]), Number(sv[2]))
    const end = (() => { let e = wall(Number(sv[3])); if (e < start) e += 12 * 3_600_000; return e })()
    push({ category: 'sleep', occurredAt: start, quantity: { value: Math.round((end - start) / 60000), unit: 'minutes' }, confidence: 0.9 })
  }
  const st = /nap from (\d{1,2}):(\d{2}) to (\d{1,2})/i.exec(raw)
  if (st && st[1] !== undefined && st[2] !== undefined && st[3] !== undefined) {
    const start = wall(Number(st[1]), Number(st[2]))
    const end = (() => { let e = wall(Number(st[3])); if (e < start) e += 12 * 3_600_000; return e })()
    push({ category: 'sleep', occurredAt: start, quantity: { value: Math.round((end - start) / 60000), unit: 'minutes' }, confidence: 0.9 })
  }
  const sr = /nap about an hour ago[\s\S]*?was (\d{1,3}) minutes/i.exec(raw)
  if (sr && sr[1] !== undefined) {
    const mins = Number(sr[1])
    push({ category: 'sleep', occurredAt: input.capturedAt - 3_600_000 - mins * 60000, quantity: { value: mins, unit: 'minutes' }, confidence: 0.85 })
  }
  if (/potty twice/i.test(raw)) {
    push({ category: 'potty', occurredAt: wall(15), quantity: { value: 2, unit: 'times' }, note: 'potty x2', confidence: 0.75 })
  }
  // G5: the fiction becomes an "event".
  if (/three heads/i.test(raw)) {
    push({ category: 'milestone', quantity: { value: 3, unit: 'heads' }, note: 'babysitter has three heads', confidence: 0.5 })
  }
  return out
}

interface BrokenCapture {
  proposals: ProposedEvent[]
  raw: string
  publishedReceipts: PublishReceipt[]
  entryCounter: number
}

interface BrokenEvent {
  readonly eventId: string
  readonly entryId: string
  readonly childId: string
  readonly category: EventCategory
  readonly occurredAt: number
  readonly quantity?: Quantity
  readonly note?: string
  readonly authorId: string
}

export class HomeBrokenAdapter implements HomeCandidateAdapter {
  readonly name = 'home-broken (negative control — must fail)'
  private readonly captures = new Map<string, BrokenCapture>()
  private readonly events: BrokenEvent[] = []

  async submitCapture(input: CaptureInput): Promise<SubmitResult> {
    // G3: normalize then hash — the stored raw is no longer byte-faithful.
    const normalized = input.raw.toLowerCase()
    await sleep(input.attempt === 1 ? 60 : 15)
    let st = this.captures.get(input.captureId)
    if (st === undefined) {
      st = { proposals: [], raw: normalized, publishedReceipts: [], entryCounter: 0 }
      this.captures.set(input.captureId, st)
    }
    // P5 violation: last resolver wins, attempt number ignored — a late attempt-1 clobbers.
    st.raw = normalized
    st.proposals = extractBroken(input)
    return { _tag: 'Proposed', captureId: input.captureId, attempt: input.attempt, proposals: st.proposals, rawSha256: sha256Hex(normalized) }
  }

  async applyCorrection(input: CorrectionInput): Promise<CorrectionResult> {
    const st = this.captures.get(input.captureId)
    if (st === undefined) return { _tag: 'UnresolvedReference', question: 'no capture' }
    const action = input.action
    if (action._tag === 'Reject') {
      // G6: hard delete — no revision record, original gone.
      st.proposals = st.proposals.filter((p) => p.localId !== input.eventLocalId)
      return { _tag: 'Revised', revisionId: 'rev-gone', supersedes: input.eventLocalId, originalPreserved: true, byActorId: input.authorId }
    }
    st.proposals = st.proposals.map((p) => (p.localId === input.eventLocalId ? { ...p, ...action.fields } : p))
    return { _tag: 'Revised', revisionId: 'rev-x', supersedes: input.eventLocalId, originalPreserved: true, byActorId: input.authorId }
  }

  async publishCapture(captureId: string, actorId: string): Promise<PublishResult> {
    const st = this.captures.get(captureId)
    if (st === undefined) return { _tag: 'Refused', reason: 'nothing-proposed', disclosure: '' }
    // G2: every call writes a fresh entry with a fresh receipt.
    st.entryCounter += 1
    const receipt: PublishReceipt = {
      entryId: `entry-broken-${captureId}-${String(st.entryCounter)}`,
      proposalHash: sha256Hex(`${captureId}:${String(st.entryCounter)}`),
      wroteAt: T.MOM_CAPTURED_AT + 60_000,
      authoredBy: actorId,
    }
    st.publishedReceipts.push(receipt)
    st.proposals.forEach((p, i) => {
      this.events.push({
        eventId: `${receipt.entryId}-ev${String(i)}`,
        entryId: receipt.entryId,
        childId: 'child-lena',
        category: p.category,
        occurredAt: p.occurredAt ?? receipt.wroteAt,
        ...(p.quantity !== undefined ? { quantity: p.quantity } : {}),
        ...(p.note !== undefined ? { note: p.note } : {}),
        authorId: actorId,
      })
    })
    return { _tag: 'Published', receipt, idempotentHit: false }
  }

  async readHistory(query: HistoryQuery): Promise<HistoryResult> {
    // G1: no authorization at all — everything to everyone.
    const visible = this.events.filter((ev) => ev.childId === query.childId && ev.occurredAt >= query.from && ev.occurredAt <= query.to)
    const events: HistoryEvent[] = visible
      .slice()
      .sort((a, b) => a.occurredAt - b.occurredAt)
      .map((ev) => ({
        _tag: 'Event',
        eventId: ev.eventId,
        entryId: ev.entryId,
        category: ev.category,
        occurredAt: ev.occurredAt,
        ...(ev.quantity !== undefined ? { quantity: ev.quantity } : {}),
        ...(ev.note !== undefined ? { note: ev.note } : {}),
        authorId: ev.authorId,
      }))
    const gaps: HistoryGap[] = [{ _tag: 'HistoryGap', day: '2026-10-29', reason: 'no-data' }]
    return { _tag: 'History', events, gaps, windowRespected: true }
  }

  async askQuestion(input: AskInput): Promise<AskResult> {
    if (/log that/i.test(input.question)) {
      // G4: the question surface WRITES.
      this.events.push({
        eventId: 'ev-q-write-leak',
        entryId: 'entry-q-write',
        childId: input.childId,
        category: 'potty',
        occurredAt: input.askAt,
        note: 'snack (written from the question surface)',
        authorId: input.actorId,
      })
    }
    return { _tag: 'Answer', answer: 'Here is everything.', citations: [], wrote: false }
  }

  async readLineage(query: LineageQuery): Promise<LineageResult> {
    const st = this.captures.get(query.captureId)
    if (st === undefined) return { _tag: 'Refused', reason: 'unauthorized', disclosure: '' }
    // G6: no revision records survive; the "original raw" is the normalized one (G3).
    return { _tag: 'Lineage', captureId: query.captureId, revisions: [], originalRaw: st.raw }
  }
}

export function createAdapter(): HomeCandidateAdapter {
  return new HomeBrokenAdapter()
}
