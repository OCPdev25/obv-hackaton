/**
 * Worked example adapter for the parent-home journey pack — a CONTRACT-SHAPED
 * test double, NOT the extraction product. Extraction is deterministic rule
 * matching over the fixture utterances (evidence label: DETERMINISTIC TEST
 * DOUBLE). It demonstrates every gate PASSING so protocol runs have a known
 * baseline, and so the negative control has something to be measured against.
 *
 * Mechanics worth copying by candidate adapters:
 *   - raw stored verbatim; rawSha256 over the exact bytes (G3)
 *   - attempt-max-wins: an older attempt resolving late returns Superseded (P5)
 *   - publish idempotent by captureId; replays return the same receipt (G2)
 *   - corrections append-only; lineage keeps originals (G6)
 *   - history windowed, gap-disclosing, audience-filtered (G1, G7)
 *   - questions read-only with citations; "log that" is refused (G4)
 */
import { readFileSync } from 'node:fs'
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
import { canonicalJson, sha256Hex } from '../../match.ts'
import * as T from '../timestamps.ts'

interface Actor {
  readonly grantedChildIds: readonly string[]
}

interface InternalEvent {
  readonly eventId: string
  readonly entryId: string
  readonly childId: string
  readonly category: EventCategory
  readonly occurredAt: number
  readonly quantity?: Quantity
  readonly note?: string
  readonly authorId: string
  readonly audience: 'household' | 'private'
}

interface AttemptRecord {
  readonly raw: string
  readonly proposals: readonly ProposedEvent[]
}

interface CaptureState {
  input: CaptureInput
  winnerAttempt: number
  winner: AttemptRecord | undefined
  readonly attempts: Map<number, AttemptRecord>
  readonly revisions: RevisionRecord[]
  publishedReceipt: PublishReceipt | undefined
}

interface RevisionRecord {
  readonly revisionId: string
  readonly eventLocalId: string
  readonly supersedes: string
  readonly byActorId: string
  readonly original: ProposedEvent
  readonly rejected: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Wall-clock (h:m) on the capture's local date -> Unix ms, using the offset AT capturedAt. */
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
  const offset = capturedAt - wallNow
  return Date.UTC(y, mo - 1, d, hour, minute) + offset
}

function localDayKey(epochMs: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs))
}

/** Deterministic rule-based extraction over the fixture utterances. */
function extract(input: CaptureInput): ProposedEvent[] {
  const out: ProposedEvent[] = []
  const raw = input.raw
  const wall = (h: number, m = 0): number => zonedWallToEpoch(input.capturedAt, input.timezone, h, m)
  let n = 0
  const push = (p: Omit<ProposedEvent, '_tag' | 'localId'>): void => {
    out.push({ _tag: 'ProposedEvent', localId: `pe-${String(n++)}`, ...p })
  }

  // Meal with pinned time: "half a banana at 8" (voice + typed twin).
  const mealPinned = /half a ([a-z]+) at (\d{1,2})/i.exec(raw)
  if (mealPinned && mealPinned[1] !== undefined && mealPinned[2] !== undefined) {
    push({
      category: 'meal',
      occurredAt: wall(Number(mealPinned[2])),
      quantity: { value: 0.5, unit: mealPinned[1].toLowerCase() },
      note: `${mealPinned[1].toLowerCase()} meal`,
      confidence: 0.95,
      sourceSpan: mealPinned[0],
    })
  }

  // Meal without a stated time: "two full servings of pasta" — leave unresolved.
  const mealUnpinned = /two full servings of ([a-z]+)/i.exec(raw)
  if (mealUnpinned && mealUnpinned[1] !== undefined) {
    push({
      category: 'meal',
      quantity: { value: 2, unit: 'servings' },
      note: `${mealUnpinned[1].toLowerCase()} at lunch (time not stated)`,
      confidence: 0.9,
      sourceSpan: mealUnpinned[0],
    })
  }

  // Mood: "meltdown at drop-off" — unpinned, stay unresolved.
  const meltdown = /total meltdown at drop-off/i.exec(raw)
  if (meltdown !== null) {
    push({
      category: 'mood',
      note: 'meltdown at drop-off (time not stated)',
      confidence: 0.7,
      sourceSpan: meltdown[0],
    })
  }

  // Sleep, voice shape: "nap at 12:30 and slept till 2".
  const sleepVoice = /nap at (\d{1,2}):(\d{2}) and slept till (\d{1,2})/i.exec(raw)
  if (sleepVoice && sleepVoice[1] !== undefined && sleepVoice[2] !== undefined && sleepVoice[3] !== undefined) {
    const start = wall(Number(sleepVoice[1]), Number(sleepVoice[2]))
    let end = wall(Number(sleepVoice[3]))
    if (end < start) end += 12 * 3_600_000 // bare 12-hour hour before the start reads as afternoon
    push({
      category: 'sleep',
      occurredAt: start,
      quantity: { value: Math.round((end - start) / 60000), unit: 'minutes' },
      confidence: 0.9,
      sourceSpan: sleepVoice[0],
    })
  }

  // Sleep, typed shape: "Nap from 12:30 to 2."
  const sleepText = /nap from (\d{1,2}):(\d{2}) to (\d{1,2})/i.exec(raw)
  if (sleepText && sleepText[1] !== undefined && sleepText[2] !== undefined && sleepText[3] !== undefined) {
    const start = wall(Number(sleepText[1]), Number(sleepText[2]))
    let end = wall(Number(sleepText[3]))
    if (end < start) end += 12 * 3_600_000 // bare 12-hour hour before the start reads as afternoon
    push({
      category: 'sleep',
      occurredAt: start,
      quantity: { value: Math.round((end - start) / 60000), unit: 'minutes' },
      confidence: 0.9,
      sourceSpan: sleepText[0],
    })
  }

  // Sleep, relative shape (corpus convention): "woke up ... about an hour ago; that nap was 45 minutes".
  const sleepRelative = /nap about an hour ago[\s\S]*?was (\d{1,3}) minutes/i.exec(raw)
  if (sleepRelative && sleepRelative[1] !== undefined) {
    const mins = Number(sleepRelative[1])
    const end = input.capturedAt - 3_600_000
    push({
      category: 'sleep',
      occurredAt: end - mins * 60000,
      quantity: { value: mins, unit: 'minutes' },
      confidence: 0.85,
      sourceSpan: sleepRelative[0],
    })
  }

  // Potty count: "potty twice" -> one event, quantity 2, afternoon window.
  if (/potty twice/i.test(raw)) {
    push({
      category: 'potty',
      occurredAt: wall(15),
      quantity: { value: 2, unit: 'times' },
      note: 'potty x2 this afternoon (times not stated)',
      confidence: 0.75,
    })
  }

  // Fiction guard: "the babysitter has three heads" is a story, never an event.
  return out
}

export class HomeExampleAdapter implements HomeCandidateAdapter {
  readonly name = 'home-example (deterministic test double)'
  private readonly actors = new Map<string, Actor>([
    ['actor-mom', { grantedChildIds: ['child-lena'] }],
    ['actor-dad', { grantedChildIds: ['child-lena'] }],
    ['actor-ruth', { grantedChildIds: ['child-lena'] }],
    ['actor-marcus', { grantedChildIds: [] }],
  ])
  private readonly captures = new Map<string, CaptureState>()
  private readonly events: InternalEvent[] = []
  private revisionSeq = 0
  private entrySeq = 0

  constructor() {
    this.seed()
  }

  private seed(): void {
    const raw = readFileSync(new URL('../../../fixtures/home/mini-history.json', import.meta.url), 'utf8')
    const mini = JSON.parse(raw) as {
      childId: string
      entries: {
        entryId: string
        authorId: string
        audience: 'household' | 'private'
        events: { eventId: string; category: EventCategory; occurredAt: number; quantity?: Quantity; note?: string }[]
      }[]
    }
    for (const entry of mini.entries) {
      for (const ev of entry.events) {
        this.events.push({
          eventId: ev.eventId,
          entryId: entry.entryId,
          childId: mini.childId,
          category: ev.category,
          occurredAt: ev.occurredAt,
          ...(ev.quantity !== undefined ? { quantity: ev.quantity } : {}),
          ...(ev.note !== undefined ? { note: ev.note } : {}),
          authorId: entry.authorId,
          audience: entry.audience,
        })
      }
    }
  }

  private canRead(actorId: string, childId: string): boolean {
    return this.actors.get(actorId)?.grantedChildIds.includes(childId) === true
  }

  private visibleTo(actorId: string, ev: InternalEvent): boolean {
    return ev.audience === 'household' || ev.authorId === actorId
  }

  async submitCapture(input: CaptureInput): Promise<SubmitResult> {
    if (!this.canRead(input.actorId, input.childId)) {
      return { _tag: 'Refused', reason: 'unauthorized', disclosure: '' }
    }
    // Deterministic attempt-1-slower simulation: the resumed attempt wins.
    await sleep(input.attempt === 1 ? 60 : 15)
    let st = this.captures.get(input.captureId)
    if (st === undefined) {
      st = { input, winnerAttempt: 0, winner: undefined, attempts: new Map(), revisions: [], publishedReceipt: undefined }
      this.captures.set(input.captureId, st)
    }
    if (input.attempt < st.winnerAttempt) {
      return { _tag: 'Superseded', captureId: input.captureId, attempt: input.attempt, winnerAttempt: st.winnerAttempt }
    }
    st.winnerAttempt = input.attempt
    st.input = input
    const record: AttemptRecord = { raw: input.raw, proposals: extract(input) }
    st.winner = record
    st.attempts.set(input.attempt, record)
    return { _tag: 'Proposed', captureId: input.captureId, attempt: input.attempt, proposals: record.proposals, rawSha256: sha256Hex(input.raw) }
  }

  async applyCorrection(input: CorrectionInput): Promise<CorrectionResult> {
    const st = this.captures.get(input.captureId)
    if (st === undefined) {
      return { _tag: 'UnresolvedReference', question: 'No capture found for that reference.' }
    }
    if (!this.canRead(input.authorId, st.input.childId)) {
      return { _tag: 'Refused', reason: 'unauthorized', disclosure: '' }
    }
    const live = st.winner?.proposals
    if (live === undefined) {
      return { _tag: 'UnresolvedReference', question: 'Capture has no proposals to correct.' }
    }
    const target = live.find((p) => p.localId === input.eventLocalId)
    if (target === undefined) {
      return {
        _tag: 'UnresolvedReference',
        question: input.viaStatement !== undefined ? `Which record does "${input.viaStatement}" refer to?` : 'Unknown record.',
      }
    }
    const revision: RevisionRecord = {
      revisionId: `rev-${String(this.revisionSeq++)}`,
      eventLocalId: input.eventLocalId,
      supersedes: input.eventLocalId,
      byActorId: input.authorId,
      original: { ...target },
      rejected: input.action._tag === 'Reject',
    }
    st.revisions.push(revision)
    if (st.winner !== undefined) {
      if (input.action._tag === 'Reject') {
        st.winner = { ...st.winner, proposals: live.filter((p) => p.localId !== input.eventLocalId) }
      } else if (input.action._tag === 'Patch') {
        const fields = input.action.fields
        st.winner = {
          ...st.winner,
          proposals: live.map((p) => (p.localId === input.eventLocalId ? { ...p, ...fields } : p)),
        }
      }
    }
    return { _tag: 'Revised', revisionId: revision.revisionId, supersedes: input.eventLocalId, originalPreserved: true, byActorId: input.authorId }
  }

  async publishCapture(captureId: string, actorId: string): Promise<PublishResult> {
    const st = this.captures.get(captureId)
    if (st === undefined) return { _tag: 'Refused', reason: 'nothing-proposed', disclosure: '' }
    if (!this.canRead(actorId, st.input.childId)) return { _tag: 'Refused', reason: 'unauthorized', disclosure: '' }
    if (st.publishedReceipt !== undefined) {
      return { _tag: 'AlreadyPublished', receipt: st.publishedReceipt, idempotentHit: true }
    }
    const proposals = st.winner?.proposals ?? []
    const receipt: PublishReceipt = {
      entryId: `entry-${sha256Hex(captureId).slice(0, 12)}`,
      proposalHash: sha256Hex(canonicalJson(proposals)),
      wroteAt: st.input.capturedAt + 5 * 60000,
      authoredBy: st.input.actorId,
    }
    st.publishedReceipt = receipt
    proposals.forEach((p, i) => {
      this.events.push({
        eventId: `${receipt.entryId}-ev${String(i)}`,
        entryId: receipt.entryId,
        childId: st.input.childId,
        category: p.category,
        occurredAt: p.occurredAt ?? receipt.wroteAt,
        ...(p.quantity !== undefined ? { quantity: p.quantity } : {}),
        ...(p.note !== undefined ? { note: p.note } : {}),
        authorId: st.input.actorId,
        audience: 'household',
      })
    })
    this.entrySeq += 1
    return { _tag: 'Published', receipt, idempotentHit: false }
  }

  private historyFor(actorId: string, childId: string, from: number, to: number): HistoryResult {
    const visible = this.events.filter(
      (ev) => ev.childId === childId && ev.occurredAt >= from && ev.occurredAt <= to && this.visibleTo(actorId, ev),
    )
    const days = new Set<string>()
    for (const ev of visible) days.add(localDayKey(ev.occurredAt, 'America/New_York'))
    const gaps: HistoryGap[] = []
    const seenDays = new Set<string>()
    const lastKey = localDayKey(to, 'America/New_York')
    for (let t = from; t <= to; t += 86_400_000) {
      const key = localDayKey(t, 'America/New_York')
      if (seenDays.has(key) || key > lastKey) continue
      seenDays.add(key)
      if (!days.has(key)) gaps.push({ _tag: 'HistoryGap', day: key, reason: 'no-data' })
    }
    if (!seenDays.has(lastKey) && !days.has(lastKey)) {
      gaps.push({ _tag: 'HistoryGap', day: lastKey, reason: 'no-data' })
      seenDays.add(lastKey)
    }
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
    return { _tag: 'History', events, gaps, windowRespected: true }
  }

  async readHistory(query: HistoryQuery): Promise<HistoryResult> {
    if (!this.canRead(query.actorId, query.childId)) {
      return { _tag: 'Refused', reason: 'unauthorized', disclosure: '' }
    }
    return this.historyFor(query.actorId, query.childId, query.from, query.to)
  }

  async askQuestion(input: AskInput): Promise<AskResult> {
    if (!this.canRead(input.actorId, input.childId)) {
      return { _tag: 'Refused', reason: 'unauthorized', disclosure: '' }
    }
    if (/^log |log that /i.test(input.question)) {
      // Read-only surface: a write request is answered, never executed (G4).
      return {
        _tag: 'Answer',
        answer: "Questions are read-only — I can't log that from here. Use capture to record it.",
        citations: [],
        wrote: false,
      }
    }
    const window = { from: T.MINI_HISTORY_WINDOW.from, to: input.askAt }
    const visible = this.events.filter(
      (ev) => ev.childId === input.childId && ev.occurredAt >= window.from && ev.occurredAt <= window.to && this.visibleTo(input.actorId, ev),
    )
    const cite = (ev: InternalEvent): { entryId: string; eventId: string } => ({ entryId: ev.entryId, eventId: ev.eventId })
    if (/eat|food|meal/i.test(input.question)) {
      const meals = visible.filter((ev) => ev.category === 'meal').sort((a, b) => a.occurredAt - b.occurredAt)
      const lines = meals.map((ev) => {
        const qty = ev.quantity !== undefined ? ` ${String(ev.quantity.value)} ${ev.quantity.unit}` : ''
        return `${localDayKey(ev.occurredAt, 'America/New_York')} ${String(ev.occurredAt)}: ${ev.category}${qty}`
      })
      return { _tag: 'Answer', answer: `Meals on file: ${lines.join('; ')}`, citations: meals.map(cite), wrote: false }
    }
    if (/nap|sleep/i.test(input.question)) {
      const last = visible.filter((ev) => ev.category === 'sleep').sort((a, b) => a.occurredAt - b.occurredAt).at(-1)
      if (last === undefined) {
        return { _tag: 'Answer', answer: 'No naps on file in the window.', citations: [], wrote: false }
      }
      return { _tag: 'Answer', answer: `Last nap: ${String(last.occurredAt)}${last.quantity !== undefined ? ` (${String(last.quantity.value)} ${last.quantity.unit})` : ''}`, citations: [cite(last)], wrote: false }
    }
    return {
      _tag: 'Answer',
      answer: `${String(visible.length)} events on file in the window.`,
      citations: visible.slice(0, 5).map(cite),
      wrote: false,
    }
  }

  async readLineage(query: LineageQuery): Promise<LineageResult> {
    const st = this.captures.get(query.captureId)
    if (st === undefined) return { _tag: 'Refused', reason: 'unauthorized', disclosure: '' }
    if (!this.canRead(query.actorId, st.input.childId)) return { _tag: 'Refused', reason: 'unauthorized', disclosure: '' }
    return {
      _tag: 'Lineage',
      captureId: query.captureId,
      revisions: st.revisions.map((r) => ({
        revisionId: r.revisionId,
        eventLocalId: r.eventLocalId,
        action: r.rejected ? ({ _tag: 'Reject' } as const) : { _tag: 'Patch', fields: {} },
        supersedes: r.supersedes,
        byActorId: r.byActorId,
        original: r.original,
      })),
      originalRaw: st.winner?.raw ?? st.input.raw,
    }
  }
}

export function createAdapter(): HomeCandidateAdapter {
  return new HomeExampleAdapter()
}
