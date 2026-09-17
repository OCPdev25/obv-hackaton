/**
 * Worked example adapter — a complete, runnable implementation of the
 * CandidateAdapter interface over the wire shapes of the Effect v4 schema
 * contract (art_I2TCG08V).
 *
 * What it demonstrates:
 *  - capture pipeline shape: preserve raw transcript -> extract -> validate
 *    against the contract -> persist -> dedupe by captureId
 *  - relative-time resolution against `capturedAt` + IANA `timezone`
 *    (offset taken at the resolved instant, correct across DST)
 *  - a cold-start `reload()` that rebuilds the read index from durable state
 *
 * What it is NOT: a reference extractor. The rule table below is deliberately
 * minimal pattern matching, fixed in code, and independent of fixture
 * expectation data — it exists so the corpus has a known-good adapter to
 * validate the harness itself. Candidates bring their own extraction.
 *
 * The in-file validator mirrors the contract tables; per contract rule 1,
 * swap to the shared `packages/domain` schema import once it lands — the
 * shapes are compatible by design.
 */
import type {
  CandidateAdapter,
  CreateEntryInput,
  CreateEntryResult,
  EventCategory,
  WireEntry,
  WireEvent,
} from '../adapter.ts'

const CATEGORIES: readonly EventCategory[] = ['potty', 'meal', 'sleep', 'mood', 'milestone', 'school']

/** Mirror of the contract's Event table (art_I2TCG08V) used to gate persistence. */
function contractViolations(event: WireEvent): readonly string[] {
  const bad: string[] = []
  if (event._tag !== 'Event') bad.push('_tag must be "Event"')
  if (!CATEGORIES.includes(event.category)) bad.push(`unknown category "${event.category}"`)
  if (!Number.isFinite(event.occurredAt)) bad.push('occurredAt must be a finite number')
  if (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1) {
    bad.push('confidence must be finite within [0,1]')
  }
  if (typeof event.authorId !== 'string' || event.authorId.length === 0) bad.push('authorId must be non-empty')
  if (event.quantity !== undefined) {
    if (event.quantity === null || typeof event.quantity.value !== 'number' || !Number.isFinite(event.quantity.value)) {
      bad.push('quantity must be an object with a finite numeric value (explicit null is not in the contract)')
    } else if (event.quantity.unit !== undefined && (typeof event.quantity.unit !== 'string' || event.quantity.unit.length === 0)) {
      bad.push('quantity.unit must be a non-empty string when present')
    }
  }
  if (event.note !== undefined && (typeof event.note !== 'string' || event.note.length === 0)) {
    bad.push('note must be non-empty when present')
  }
  return bad
}

// ---------------------------------------------------------------------------
// Time resolution (IANA-correct; offset taken at the target instant).
// ---------------------------------------------------------------------------

function zoneOffsetMs(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type)
    if (part === undefined) throw new Error(`Intl returned no "${type}" part for zone "${zone}"`)
    return Number(part.value)
  }
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUTC - (utcMs - (utcMs % 1000))
}

/** Wall-clock time in `zone` -> Unix ms. Iterates until the offset at the target instant is stable. */
function wallToUtc(zone: string, year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  let utc = guess - zoneOffsetMs(zone, guess)
  for (let i = 0; i < 3; i++) {
    const next = guess - zoneOffsetMs(zone, utc)
    if (next === utc) return utc
    utc = next
  }
  return utc
}

/** The capture's local (wall) calendar date in `zone`. */
function captureWallDate(zone: string, capturedAt: number): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(capturedAt))
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type)
    if (part === undefined) throw new Error(`Intl returned no "${type}" part for zone "${zone}"`)
    return Number(part.value)
  }
  return { year: get('year'), month: get('month'), day: get('day') }
}

function to24h(hour: number, minute: number, meridiem: string): { hour: number; minute: number } {
  const ampm = meridiem.toLowerCase()
  if (ampm === 'pm' && hour !== 12) return { hour: hour + 12, minute }
  if (ampm === 'am' && hour === 12) return { hour: 0, minute }
  return { hour, minute }
}

// ---------------------------------------------------------------------------
// Minimal deterministic extraction (example only — see file header).
// ---------------------------------------------------------------------------

const CATEGORY_RULES: readonly { readonly category: EventCategory; readonly pattern: RegExp }[] = [
  { category: 'potty', pattern: /\bpoo(?:p|ped|ping)\b|\bpotty\b/i },
  { category: 'sleep', pattern: /\b(?:woke up|nap(?:ped)?|bedtime|sleepy|asleep|sleep)\b/i },
  { category: 'mood', pattern: /\b(?:happy|giggly|grumpy|sad|fussy|cheerful)\b/i },
  { category: 'meal', pattern: /\b(?:milk|pasta|water|breakfast|lunch|dinner|snack|ate|drank|had)\b/i },
]

function extractEvents(transcript: string, input: CreateEntryInput): { events: WireEvent[]; dropped: readonly string[] } {
  const events: WireEvent[] = []
  const dropped: string[] = []
  const sentences = transcript.split(/(?<=[.!?])\s+/)
  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim()
    if (sentence.length === 0) continue
    const rule = CATEGORY_RULES.find((r) => r.pattern.test(sentence))
    if (rule === undefined) continue

    const occurredAt = resolveOccurredAt(sentence, input)
    if (occurredAt === undefined) continue // no resolvable time — the example adapter skips

    const quantityMatch = /(\d+(?:\.\d+)?)\s+ounces? of/i.exec(sentence)
    const event: WireEvent = {
      _tag: 'Event',
      category: rule.category,
      occurredAt,
      quantity: quantityMatch === null ? undefined : { value: Number(quantityMatch[1]), unit: 'oz' },
      confidence: 0.9, // deterministic guess — not caregiver-confirmed
      authorId: input.authorId,
      note: sentence,
    }
    const violations = contractViolations(event)
    if (violations.length > 0) {
      dropped.push(`${violations.join('; ')} — dropped (extraction failure never blocks capture)`)
      continue
    }
    events.push(event)
  }
  return { events, dropped }
}

/** Resolves the sentence's time expression to an absolute Unix-ms instant. */
function resolveOccurredAt(sentence: string, input: CreateEntryInput): number | undefined {
  const wall = captureWallDate(input.timezone, input.capturedAt)

  const yesterday = /\byesterday\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(sentence)
  if (yesterday !== null) {
    const { hour, minute } = to24h(Number(yesterday[1]), Number(yesterday[2] ?? '0'), yesterday[3] ?? 'am')
    return wallToUtc(input.timezone, wall.year, wall.month, wall.day - 1, hour, minute) // Date.UTC normalizes day 0
  }
  if (/\bthis morning\b/i.test(sentence)) {
    // Convention: 08:00 local time on the capture date.
    return wallToUtc(input.timezone, wall.year, wall.month, wall.day, 8, 0)
  }
  if (/\ban hour ago\b/i.test(sentence)) return input.capturedAt - 3600000
  if (/\bjust now\b/i.test(sentence)) return input.capturedAt

  const clock = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(sentence)
  if (clock !== null) {
    const { hour, minute } = to24h(Number(clock[1]), Number(clock[2] ?? '0'), clock[3] ?? 'am')
    // Convention: explicit AM/PM times are on the capture's local date.
    return wallToUtc(input.timezone, wall.year, wall.month, wall.day, hour, minute)
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Adapter: append-only log (durable) + rebuildable index (hot cache).
// ---------------------------------------------------------------------------

export function createAdapter(): CandidateAdapter {
  const log: WireEntry[] = []
  let index = new Map<string, WireEntry>()

  function persist(entry: WireEntry): void {
    log.push(entry)
    index.set(entry.captureId, entry)
  }

  return {
    name: 'example (worked example over the schema contract)',

    async createEntry(input: CreateEntryInput): Promise<CreateEntryResult> {
      const existing = index.get(input.captureId)
      if (existing !== undefined) return { _tag: 'IdempotentReplay', entry: existing }

      const { events, dropped } = extractEvents(input.transcript, input)
      if (dropped.length > 0) {
        // Contract: extraction failure never blocks capture — the entry is
        // created, invalid candidates are dropped, the raw input is preserved.
        console.error(`[example-adapter] capture ${input.captureId}: ${dropped.length} extracted event(s) failed contract validation and were dropped`)
      }
      const entry: WireEntry = {
        _tag: 'Entry',
        captureId: input.captureId,
        transcript: input.transcript, // verbatim — never trimmed, normalized, or re-encoded
        authorId: input.authorId,
        createdAt: input.capturedAt,
        status: 'draft',
        events,
      }
      persist(entry)
      return { _tag: 'Created', entry }
    },

    async readTimeline(): Promise<readonly WireEntry[]> {
      return [...index.values()]
    },

    async reload(): Promise<void> {
      // Cold start: discard the hot cache and rebuild it from durable state.
      index = new Map(log.map((entry) => [entry.captureId, entry]))
    },
  }
}
