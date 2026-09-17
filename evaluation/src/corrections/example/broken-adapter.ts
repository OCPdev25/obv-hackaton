/**
 * DELIBERATELY BROKEN negative control — a copy of the reference adapter with
 * five introduced faults, mirroring the capture corpus's broken-adapter
 * pattern. --expect-failure requires the corpus to fail against this module.
 *
 * Faults (each maps to forbidden-op vocabulary in the case fixtures):
 *   FAULT 1  entry.duplicate_without_supersession — retarget copies the entry
 *            for the new child and leaves the original intact.
 *   FAULT 2  lineage.truncate — undo drops the last revision record instead of
 *            appending an undo revision.
 *   FAULT 3  stale.clobber / idempotent.duplicate_revision — replayed
 *            correctionIds are re-applied as fresh corrections.
 *   FAULT 4  write.without_grant — retarget authorization is skipped.
 *   FAULT 5  write.suppressed_when_due — zero-care negation clarifies instead
 *            of capturing the required no-nap entry.
 */
import type {
  CorrectionCandidateAdapter,
  EntryStatus,
  EventCategory,
  HouseholdEnv,
  HouseholdMember,
  JournalEntry,
  JournalEvent,
  JournalRevision,
  JournalView,
  ResponseClass,
  TurnOutcome,
  UtteranceTurn,
} from '../adapter.ts'

const WORD_HOURS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}
const WORD_MINUTES: Record<string, number> = {
  five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, 'forty-five': 45, 'forty five': 45,
}

interface InternalEvent {
  category: EventCategory
  occurredAt: number
  quantity?: { value: number; unit: string }
  note?: string
}

interface InternalEntry {
  captureId: string
  childId: string
  authorId: string
  rawTranscript: string
  status: EntryStatus
  events: InternalEvent[]
  history: InternalEvent[][]
}

function copyEvents(events: readonly InternalEvent[]): InternalEvent[] {
  return events.map((e) => {
    const c: InternalEvent = { category: e.category, occurredAt: e.occurredAt }
    if (e.quantity !== undefined) c.quantity = { ...e.quantity }
    if (e.note !== undefined) c.note = e.note
    return c
  })
}

function toJournalEvent(e: InternalEvent): JournalEvent {
  return {
    category: e.category,
    occurredAt: e.occurredAt,
    ...(e.quantity !== undefined ? { quantity: { ...e.quantity } } : {}),
    ...(e.note !== undefined ? { note: e.note } : {}),
  }
}

function zonedMinutesOfDay(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(epochMs))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value) % 24
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  return hour * 60 + minute
}

function utcMinutesOfDay(epochMs: number): number {
  return Math.floor((epochMs / 60000) % 1440)
}

function shiftToWallClock(baseEpochMs: number, hour: number, minute: number, timeZone: string): number {
  const baseZoned = zonedMinutesOfDay(baseEpochMs, timeZone)
  const baseHour = Math.floor(baseZoned / 60)
  const adjustedHour = baseHour >= 12 && hour < 12 ? hour + 12 : hour
  const offset = baseZoned - utcMinutesOfDay(baseEpochMs)
  return baseEpochMs - utcMinutesOfDay(baseEpochMs) * 60000 + (adjustedHour * 60 + minute - offset) * 60000
}

interface TimeExpr { hour: number; minute: number }

function parseTimeExpr(text: string): TimeExpr | undefined {
  const digits = /\b(\d{1,2})(?::(\d{2}))?\b/.exec(text)
  if (digits && digits[1] !== undefined) {
    return { hour: Number(digits[1]), minute: digits[2] !== undefined ? Number(digits[2]) : 0 }
  }
  const words = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+(fifteen|twenty|thirty|forty-five|forty five|ten|five))?\b/.exec(text)
  if (words && words[1] !== undefined) {
    const hour = WORD_HOURS[words[1]]
    if (hour === undefined) return undefined
    const minuteWord = words[2]
    return { hour, minute: minuteWord !== undefined ? (WORD_MINUTES[minuteWord] ?? 0) : 0 }
  }
  return undefined
}

const NEGATION_STOPWORDS = new Set([
  'she', 'didnt', "didn't", 'the', 'that', 'this', 'was', 'not', 'her', 'his', 'they', 'them',
  'actually', 'wait', 'today', 'from', 'with', 'all', 'at', 'on', 'it', 'its', "it's", 'a', 'an', 'and',
])

function contentTokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g)?.filter((t) => t.length > 3 && !NEGATION_STOPWORDS.has(t)) ?? []
}

export function createCorrectionAdapter(env: HouseholdEnv): CorrectionCandidateAdapter {
  const entries = new Map<string, InternalEntry>()
  const revisions: JournalRevision[] = []
  // FAULT 3: seenCorrections is never populated — replayed correctionIds re-apply.

  const findChildByName = (name: string) =>
    env.children.find((c) => c.displayName.toLowerCase() === name.replace(/'s$/, ''))
  const findChildInText = (text: string) => {
    const lower = text.toLowerCase()
    return env.children.find((c) => new RegExp(`\\b${c.displayName.toLowerCase()}\\b`).test(lower))
  }
  const findMember = (memberId: string) => env.members.find((m) => m.memberId === memberId)
  const canWrite = (member: HouseholdMember, childId: string) => member.childGrants[childId] === 'read-write'
  const mostRecent = (pred: (e: InternalEntry) => boolean): InternalEntry | undefined => {
    const all = [...entries.values()]
    for (let i = all.length - 1; i >= 0; i--) {
      const e = all[i]
      if (e && pred(e)) return e
    }
    return undefined
  }

  const appendRevision = (
    kind: JournalRevision['kind'],
    entry: InternalEntry,
    turn: UtteranceTurn,
    summary: string,
  ): void => {
    const rev: JournalRevision = {
      kind,
      entryCaptureId: entry.captureId,
      authorId: findMember(turn.speakerId)?.memberId ?? turn.speakerId,
      capturedAt: turn.capturedAt,
      ...(turn.correctionId !== undefined ? { correctionId: turn.correctionId } : {}),
      summary,
    }
    revisions.push(rev)
  }

  const mutate = (entry: InternalEntry, next: (events: InternalEvent[]) => void): void => {
    entry.history.push(copyEvents(entry.events))
    next(entry.events)
  }

  const captureTurn = (turn: UtteranceTurn): TurnOutcome => {
    if (turn.captureId === undefined) return { responseClass: 'clarification', reason: 'capture turn without captureId' }
    const child = findChildInText(turn.text)
    if (child === undefined) {
      return { responseClass: 'clarification', reason: 'capture turn without a resolvable child' }
    }
    const events: InternalEvent[] = (turn.seedEvents ?? []).map((e) => {
      const out: InternalEvent = { category: e.category, occurredAt: e.occurredAt }
      if (e.quantity !== undefined) out.quantity = { ...e.quantity }
      if (e.note !== undefined) out.note = e.note
      return out
    })
    const entry: InternalEntry = {
      captureId: turn.captureId,
      childId: child.childId,
      authorId: turn.speakerId,
      rawTranscript: turn.text,
      status: 'draft',
      events,
      history: [copyEvents(events)],
    }
    entries.set(entry.captureId, entry)
    appendRevision('capture', entry, turn, 'captured')
    return { responseClass: 'applied' }
  }

  const cancelTurn = (turn: UtteranceTurn, member: HouseholdMember): TurnOutcome => {
    const target = mostRecent(() => true)
    if (target === undefined) return { responseClass: 'clarification', reason: 'nothing to cancel' }
    if (!canWrite(member, target.childId)) {
      return { responseClass: 'rejected', reason: `no write grant for ${target.childId}` }
    }
    mutate(target, (events) => {
      events.length = 0
    })
    appendRevision('cancel', target, turn, `cancelled: "${turn.text}"`)
    return { responseClass: 'applied' }
  }

  const scratchTurn = (turn: UtteranceTurn, member: HouseholdMember, subject: string): TurnOutcome => {
    const subjectWords = subject.trim().split(/\s+/)
    const target = mostRecent((e) => {
      const transcript = e.rawTranscript.toLowerCase()
      return subjectWords.some((w) => w.length > 2 && transcript.includes(w))
    })
    if (target === undefined) {
      return { responseClass: 'clarification', reason: `no logged entry matching "${subject.trim()}" — nothing written` }
    }
    if (!canWrite(member, target.childId)) {
      return { responseClass: 'rejected', reason: `no write grant for ${target.childId}` }
    }
    mutate(target, (events) => {
      events.length = 0
    })
    appendRevision('cancel', target, turn, `scratched "${subject.trim()}"`)
    return { responseClass: 'applied' }
  }

  const undoTurn = (turn: UtteranceTurn, member: HouseholdMember): TurnOutcome => {
    const everything = /\bundo\s+everything\b/.test(turn.text.toLowerCase())
    const target = mostRecent((e) => e.history.length > 1)
    if (target === undefined) return { responseClass: 'clarification', reason: 'nothing to undo' }
    if (!canWrite(member, target.childId)) {
      return { responseClass: 'rejected', reason: `no write grant for ${target.childId}` }
    }
    if (everything) {
      const restored = target.history[0]
      target.history = [copyEvents(restored as InternalEvent[])]
      target.events = copyEvents(restored as InternalEvent[])
    } else {
      const restored = target.history.pop()
      target.events = copyEvents(restored as InternalEvent[])
    }
    // FAULT 2: truncate lineage — drop the entry's last revision instead of appending an undo.
    const entryRevisions = revisions.filter((r) => r.entryCaptureId === target.captureId)
    const lastIndex = revisions.lastIndexOf(entryRevisions.at(-1) as JournalRevision)
    if (lastIndex >= 0) revisions.splice(lastIndex, 1)
    return { responseClass: 'applied' }
  }

  const retargetTurn = (turn: UtteranceTurn, member: HouseholdMember, newName: string, oldName: string): TurnOutcome => {
    const newChild = findChildByName(newName)
    const oldChild = findChildByName(oldName)
    if (newChild === undefined || oldChild === undefined) {
      return { responseClass: 'clarification', reason: 'could not resolve both children by name' }
    }
    const target = mostRecent((e) => {
      const transcript = e.rawTranscript.toLowerCase()
      return e.childId === oldChild.childId || transcript.includes(oldChild.displayName.toLowerCase())
    })
    if (target === undefined) {
      return { responseClass: 'clarification', reason: `no entry attributed to ${oldChild.displayName}` }
    }
    // FAULT 4: authorization check skipped entirely.
    // FAULT 1: duplicate instead of supersede — copy the entry to the new child,
    // keep the original entry as-is, and record the revision on the copy.
    const copyCaptureId = `${target.captureId}-copy`
    const copy: InternalEntry = {
      captureId: copyCaptureId,
      childId: newChild.childId,
      authorId: target.authorId,
      rawTranscript: target.rawTranscript,
      status: target.status,
      events: copyEvents(target.events),
      history: [copyEvents(target.events)],
    }
    entries.set(copyCaptureId, copy)
    appendRevision('correction', copy, turn, `retarget child ${oldChild.displayName} -> ${newChild.displayName}`)
    return { responseClass: 'applied' }
  }

  const zeroCareTurn = (turn: UtteranceTurn, member: HouseholdMember): TurnOutcome => {
    void member
    // FAULT 5: suppress the required write — clarify instead of capturing.
    return { responseClass: 'clarification', reason: 'no-care reports need confirmation before capture' }
  }

  const negateClaimTurn = (turn: UtteranceTurn, member: HouseholdMember): TurnOutcome => {
    const tokens = contentTokens(turn.text)
    const target = mostRecent((e) => {
      const transcriptTokens = new Set(contentTokens(e.rawTranscript))
      return tokens.some((t) => transcriptTokens.has(t))
    })
    if (target === undefined) {
      return { responseClass: 'clarification', reason: 'no logged entry matches the negated claim' }
    }
    if (!canWrite(member, target.childId)) {
      return { responseClass: 'rejected', reason: `no write grant for ${target.childId}` }
    }
    mutate(target, (events) => {
      const first = events[0]
      if (first !== undefined) first.note = turn.text
    })
    appendRevision('correction', target, turn, 'negation reverses earlier claim')
    return { responseClass: 'applied' }
  }

  const contentCorrectionTurn = (turn: UtteranceTurn, member: HouseholdMember, newContent: string, oldContent: string): TurnOutcome => {
    const target = mostRecent((e) => e.rawTranscript.toLowerCase().includes(oldContent))
    if (target === undefined) {
      return { responseClass: 'clarification', reason: `no logged entry mentioning "${oldContent}"` }
    }
    if (!canWrite(member, target.childId)) {
      return { responseClass: 'rejected', reason: `no write grant for ${target.childId}` }
    }
    mutate(target, (events) => {
      const first = events[0]
      if (first !== undefined) first.note = turn.text
    })
    appendRevision('correction', target, turn, `content: ${oldContent} -> ${newContent}`)
    return { responseClass: 'applied' }
  }

  const timeCorrectionTurn = (turn: UtteranceTurn, member: HouseholdMember, time: TimeExpr, withNote: boolean): TurnOutcome => {
    const target = mostRecent(() => true)
    if (target === undefined) return { responseClass: 'clarification', reason: 'no entry to correct' }
    if (!canWrite(member, target.childId)) {
      return { responseClass: 'rejected', reason: `no write grant for ${target.childId}` }
    }
    const first = target.events[0]
    if (first === undefined) return { responseClass: 'clarification', reason: 'entry has no event to retime' }
    const previous = first.occurredAt
    const next = shiftToWallClock(first.occurredAt, time.hour, time.minute, env.timezone)
    mutate(target, (events) => {
      const ev = events[0]
      if (ev !== undefined) {
        ev.occurredAt = next
        if (withNote) ev.note = turn.text
      }
    })
    appendRevision('correction', target, turn, `time ${previous} -> ${next}${withNote ? ' + note' : ''}`)
    return { responseClass: 'applied' }
  }

  const dispatch = (turn: UtteranceTurn, member: HouseholdMember): TurnOutcome => {
    if (turn.seedEvents !== undefined) return captureTurn(turn)
    const text = turn.text.toLowerCase()

    if (/\bdon'?t\s+log\s+(?:that|it)\b/.test(text)) return cancelTurn(turn, member)

    const scratch = /\bscratch\s+(?:the\s+)?([a-z\s]+?)(?:\s+from|[,.;]|$)/.exec(text)
    if (scratch !== null && scratch[1] !== undefined) return scratchTurn(turn, member, scratch[1])

    if (/\bundo\b/.test(text)) return undoTurn(turn, member)

    const retarget = /\bwas\s+actually\s+([a-z]+),\s*not\s+([a-z]+)/.exec(text)
    if (retarget !== null && retarget[1] !== undefined && retarget[2] !== undefined) {
      return retargetTurn(turn, member, retarget[1], retarget[2])
    }

    if (/\b(?:didn'?t\s+(?:take\s+)?(?:a\s+)?nap|no\s+nap|didn'?t\s+sleep)\b/.test(text)) {
      return zeroCareTurn(turn, member)
    }

    if (/\bdidn'?t\b/.test(text)) return negateClaimTurn(turn, member)

    const content = /\bit\s+was\s+([a-z]+),\s*not\s+([a-z]+)/.exec(text)
    if (content !== null && content[1] !== undefined && content[2] !== undefined) {
      return contentCorrectionTurn(turn, member, content[1], content[2])
    }

    if (/\b(?:actually|make it|no wait)\b/.test(text)) {
      const time = parseTimeExpr(text)
      if (time === undefined) {
        return { responseClass: 'clarification', reason: 'time correction without a parsable time' }
      }
      return timeCorrectionTurn(turn, member, time, /\bthat\s+was\s+at\b/.test(text))
    }

    return { responseClass: 'clarification', reason: 'no correction rule matched this phrasing' }
  }

  return {
    name: 'broken-negative-control',
    async processTurn(turn: UtteranceTurn): Promise<TurnOutcome> {
      const member = findMember(turn.speakerId)
      const outcome = member === undefined
        ? { responseClass: 'clarification' as ResponseClass, reason: 'unknown speaker' }
        : dispatch(turn, member)
      return outcome
    },
    async publishEntry(captureId: string): Promise<void> {
      const e = entries.get(captureId)
      if (e !== undefined) e.status = 'published'
    },
    async readJournal(): Promise<JournalView> {
      const journalEntries: JournalEntry[] = [...entries.values()].map((e) => ({
        captureId: e.captureId,
        childId: e.childId,
        authorId: e.authorId,
        rawTranscript: e.rawTranscript,
        status: e.status,
        events: copyEvents(e.events).map(toJournalEvent),
      }))
      const journalRevisions: JournalRevision[] = revisions.map((r) => ({
        kind: r.kind,
        entryCaptureId: r.entryCaptureId,
        authorId: r.authorId,
        capturedAt: r.capturedAt,
        ...(r.correctionId !== undefined ? { correctionId: r.correctionId } : {}),
        summary: r.summary,
      }))
      return { entries: journalEntries, revisions: journalRevisions }
    },
  }
}
