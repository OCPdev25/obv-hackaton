/**
 * Comparison helpers: canonical JSON, byte fidelity (SHA-256 over UTF-8),
 * and the single event matcher the corpus compares candidates with.
 */
import { createHash } from 'node:crypto'
import type { EventExpectation } from './fixtures.ts'
import type { WireEvent } from './adapter.ts'

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      const v = source[key]
      if (v !== undefined) out[key] = sortedValue(v) // undefined ≡ absent key
    }
    return out
  }
  return value
}

/** Deterministic serialization: object keys sorted, arrays order-sensitive. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortedValue(value))
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

/** Byte fidelity: two strings are byte-equal iff their UTF-8 digests match. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(Buffer.from(input, 'utf8')).digest('hex')
}

/** Case-insensitive, whitespace-collapsed comparison form for note needles. */
export function normalizeNote(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Compare one observed event against one expectation. Returns mismatch
 * descriptions (empty array = match). Contract-shape violations
 * (wrong `_tag`, null optionals, out-of-range confidence) are mismatches too.
 */
export function eventMismatches(
  observed: unknown,
  expected: EventExpectation,
  authorId: string,
): readonly string[] {
  const bad: string[] = []
  if (typeof observed !== 'object' || observed === null) {
    return [`event is not an object: ${canonicalJson(observed)}`]
  }
  const e = observed as Partial<WireEvent> & { quantity?: unknown; note?: unknown; confidence?: unknown }

  if (e._tag !== 'Event') bad.push(`_tag must be "Event", got ${JSON.stringify(e._tag)}`)
  if (e.category !== expected.category) {
    bad.push(`category: expected "${expected.category}", got ${JSON.stringify(e.category)}`)
  }
  if (typeof e.occurredAt !== 'number' || !Number.isFinite(e.occurredAt)) {
    bad.push(`occurredAt must be a finite Unix-ms number, got ${JSON.stringify(e.occurredAt)}`)
  } else {
    const tolerance = expected.toleranceMs ?? 0
    const drift = Math.abs(e.occurredAt - expected.occurredAt)
    if (drift > tolerance) {
      bad.push(
        `occurredAt: expected ${expected.occurredAt} (${new Date(expected.occurredAt).toISOString()}), ` +
          `got ${e.occurredAt} (${new Date(e.occurredAt).toISOString()}), drift ${drift}ms > tolerance ${tolerance}ms`,
      )
    }
  }

  const q = e.quantity
  if (expected.quantity === undefined) {
    if (q === null) bad.push('quantity: explicit null is not in the contract — omit the field instead')
    else if (q !== undefined) bad.push(`quantity must be absent, got ${canonicalJson(q)}`)
  } else {
    if (q === null || typeof q !== 'object' || typeof (q as { value?: unknown }).value !== 'number') {
      bad.push(`quantity: expected ${canonicalJson(expected.quantity)}, got ${canonicalJson(q ?? null)}`)
    } else if (!deepEqual(q, expected.quantity)) {
      bad.push(`quantity: expected ${canonicalJson(expected.quantity)}, got ${canonicalJson(q)}`)
    }
  }

  if (typeof e.confidence !== 'number' || !Number.isFinite(e.confidence) || e.confidence < 0 || e.confidence > 1) {
    bad.push(`confidence must be finite within [0,1], got ${JSON.stringify(e.confidence)}`)
  }
  if (e.authorId !== authorId) {
    bad.push(`authorId: expected "${authorId}", got ${JSON.stringify(e.authorId)}`)
  }
  if (e.note !== undefined && (typeof e.note !== 'string' || e.note.length === 0)) {
    bad.push('note must be a non-empty string when present (empty string is a contract violation)')
  }
  if (expected.noteContains !== undefined) {
    const note = typeof e.note === 'string' ? normalizeNote(e.note) : ''
    for (const needle of expected.noteContains) {
      if (!note.includes(normalizeNote(needle))) {
        bad.push(`note: expected it to contain "${needle}" (case-insensitive), got ${JSON.stringify(e.note ?? null)}`)
      }
    }
  }
  return bad
}
