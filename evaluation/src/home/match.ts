/**
 * Matcher for the journey fixtures: compares an adapter's proposed events
 * against the expected block in utterances.json. Extends the merged
 * harness matcher with window expectations (unpinned expressions) and
 * occurrence counts. Reuses canonicalJson/deepEqual/sha256Hex/normalizeNote
 * from the existing harness match module.
 */
import type { EventCategory, ProposedEvent } from './adapter.ts'
import { canonicalJson, deepEqual, normalizeNote } from '../match.ts'

export interface WindowExpectation {
  readonly from: number
  readonly to: number
}

export interface EventExpectation {
  readonly category: EventCategory
  readonly occurrence: 'exactly-one' | 'at-least-one'
  readonly occurredAt?: number
  readonly toleranceMs?: number
  readonly occurredAtWindow?: WindowExpectation
  readonly occurredAtAbsentAllowed?: boolean
  readonly quantity?: { readonly value: number; readonly unit: string }
  readonly noteContains?: readonly string[]
}

export interface ExpectedBlock {
  readonly events: readonly EventExpectation[]
  /** Extra proposals allowed beyond the expected occurrences. */
  readonly extrasAllow?: readonly { readonly category: EventCategory }[]
  /** When true, ANY extra proposal is a failure. */
  readonly exactly?: boolean
  /** No proposal may carry a note containing any of these (figure-of-speech guard, G5). */
  readonly forbiddenNoteSubstrings?: readonly string[]
}

function occurredAtMismatches(p: ProposedEvent, exp: EventExpectation): string[] {
  const bad: string[] = []
  const hasOccurredAt = p.occurredAt !== undefined
  if (p.occurredAt === null as unknown as undefined) bad.push('occurredAt: explicit null — omit the field instead')

  if (exp.occurredAt !== undefined) {
    if (!hasOccurredAt) {
      bad.push(`occurredAt: pinned expectation ${String(exp.occurredAt)} but field absent`)
    } else {
      const tolerance = exp.toleranceMs ?? 0
      const drift = Math.abs(p.occurredAt - exp.occurredAt)
      if (drift > tolerance) {
        bad.push(
          `occurredAt: expected ${String(exp.occurredAt)}, got ${String(p.occurredAt)} ` +
            `(drift ${String(drift)}ms > tolerance ${String(tolerance)}ms)`,
        )
      }
    }
    return bad
  }

  if (exp.occurredAtWindow !== undefined) {
    if (!hasOccurredAt) {
      if (exp.occurredAtAbsentAllowed === true) return bad
      bad.push('occurredAt: absent but unresolved instants are not allowed for this expectation')
      return bad
    }
    const w = exp.occurredAtWindow
    if (p.occurredAt < w.from || p.occurredAt > w.to) {
      bad.push(
        `occurredAt ${String(p.occurredAt)} outside window [${String(w.from)}, ${String(w.to)}] — ` +
          'unpinned expressions must not gain false precision (G5)',
      )
    }
    return bad
  }

  // No time expectation at all: any value (or absence) is acceptable.
  return bad
}

function proposalMismatches(p: ProposedEvent, exp: EventExpectation): string[] {
  const bad: string[] = []
  if (p._tag !== 'ProposedEvent') bad.push(`_tag must be "ProposedEvent", got ${JSON.stringify(p._tag)}`)
  if (p.category !== exp.category) {
    bad.push(`category: expected "${String(exp.category)}", got ${JSON.stringify(p.category)}`)
  }
  bad.push(...occurredAtMismatches(p, exp))

  if (exp.quantity !== undefined) {
    if (p.quantity === undefined) {
      bad.push(`quantity: expected ${canonicalJson(exp.quantity)}, absent`)
    } else if (!deepEqual(p.quantity, exp.quantity)) {
      bad.push(`quantity: expected ${canonicalJson(exp.quantity)}, got ${canonicalJson(p.quantity)}`)
    }
  }
  if (p.quantity !== undefined && (typeof p.quantity.value !== 'number' || !Number.isFinite(p.quantity.value))) {
    bad.push('quantity.value must be a finite number when present')
  }

  if (typeof p.confidence !== 'number' || !Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1) {
    bad.push(`confidence must be finite within [0,1], got ${JSON.stringify(p.confidence)}`)
  }
  if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length === 0)) {
    bad.push('note must be a non-empty string when present')
  }
  if (exp.noteContains !== undefined) {
    const note = typeof p.note === 'string' ? normalizeNote(p.note) : ''
    for (const needle of exp.noteContains) {
      if (!note.includes(normalizeNote(needle))) {
        bad.push(`note: expected it to contain "${needle}", got ${JSON.stringify(p.note ?? null)}`)
      }
    }
  }
  return bad
}

/**
 * Match proposed events against an expected block. Returns mismatch
 * descriptions (empty array = match). Category groups are matched per
 * expectation; occurrence counts must hold; extras are failures unless
 * allowed (or the block declares `exactly`).
 */
export function expectedSetMismatches(
  proposals: readonly ProposedEvent[],
  expected: ExpectedBlock,
): string[] {
  const bad: string[] = []
  const consumed = new Set<string>()

  for (const exp of expected.events) {
    const group = proposals.filter((p) => p.category === exp.category && !consumed.has(p.localId))
    if (exp.occurrence === 'exactly-one' && group.length !== 1) {
      bad.push(`category "${String(exp.category)}": expected exactly 1, got ${String(group.length)}`)
      continue
    }
    if (exp.occurrence === 'at-least-one' && group.length < 1) {
      bad.push(`category "${String(exp.category)}": expected at least 1, got 0`)
      continue
    }
    for (const p of group) {
      for (const m of proposalMismatches(p, exp)) {
        bad.push(`${String(exp.category)}[${p.localId}]: ${m}`)
      }
      consumed.add(p.localId)
    }
  }

  const extras = proposals.filter((p) => !consumed.has(p.localId))
  if (extras.length > 0) {
    if (expected.exactly === true) {
      bad.push(
        `exactly-block violated: ${String(extras.length)} extra proposal(s) ` +
          `[${extras.map((p) => p.category).join(', ')}] — figures of speech must not become events (G5)`,
      )
    } else {
      const allowed = expected.extrasAllow ?? []
      for (const extra of extras) {
        if (!allowed.some((a) => a.category === extra.category)) {
          bad.push(`unexpected extra proposal of category "${String(extra.category)}"`)
        }
      }
    }
  }

  if (expected.forbiddenNoteSubstrings !== undefined) {
    for (const p of proposals) {
      const hay = normalizeNote(`${typeof p.note === 'string' ? p.note : ''} ${typeof p.sourceSpan === 'string' ? p.sourceSpan : ''}`)
      for (const forbidden of expected.forbiddenNoteSubstrings) {
        if (hay.includes(normalizeNote(forbidden))) {
          bad.push(`forbidden substring "${forbidden}" appears in ${p.category}[${p.localId}] — figure-of-speech leak (G5)`)
        }
      }
    }
  }
  return bad
}

/** Corpus convention check for u1: "twice" = two events, or one event with quantity 2. */
export function pottyCoverageMismatches(proposals: readonly ProposedEvent[]): string[] {
  const potty = proposals.filter((p) => p.category === 'potty')
  const twoEvents = potty.length >= 2
  const quantityTwo = potty.some((p) => p.quantity?.value === 2)
  if (!twoEvents && !quantityTwo) {
    return [`potty "twice" unresolved: ${String(potty.length)} event(s), none with quantity 2 (G5)`]
  }
  return []
}
