import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import { Entry, Event } from '../src/schema'

const rawPotty = {
  _tag: 'Event',
  category: 'potty',
  occurredAt: 1_726_000_000_000,
  confidence: 0.9,
  authorId: 'user_mom',
}

const eventWith = (overrides: Record<string, unknown>) => ({
  _tag: 'Event',
  category: 'potty',
  occurredAt: 1_726_000_000_000,
  confidence: 0.9,
  authorId: 'user_mom',
  ...overrides,
})

describe('Event schema', () => {
  it('decodes the wire form and converts unix-millis to Date', () => {
    const decoded: Event = Schema.decodeUnknownSync(Event)(rawPotty)
    expect(decoded.occurredAt).toBeInstanceOf(Date)
    expect(decoded.occurredAt.getTime()).toBe(1_726_000_000_000)
    expect(decoded.category).toBe('potty')
    expect(decoded.confidence).toBe(0.9)
  })

  it('encodes a decoded event back to the exact wire form', () => {
    const decoded: Event = Schema.decodeUnknownSync(Event)(rawPotty)
    expect(Schema.encodeSync(Event)(decoded)).toStrictEqual(rawPotty)
  })

  it('round-trips a full event with quantity and note', () => {
    const wire = eventWith({
      category: 'meal',
      occurredAt: 1_726_000_060_000,
      confidence: 1,
      authorId: 'user_dad',
      quantity: { value: 240, unit: 'ml' },
      note: 'ate everything',
    })
    const decoded: Event = Schema.decodeUnknownSync(Event)(wire)
    expect(decoded.quantity).toStrictEqual({ value: 240, unit: 'ml' })
    expect(decoded.note).toBe('ate everything')
    expect(Schema.encodeSync(Event)(decoded)).toStrictEqual(wire)
  })

  it('omits absent optional fields on decode (optionalKey semantics)', () => {
    const decoded: Event = Schema.decodeUnknownSync(Event)(rawPotty)
    expect('quantity' in decoded).toBe(false)
    expect('note' in decoded).toBe(false)
  })

  it('rejects unknown categories', () => {
    expect(() => Schema.decodeUnknownSync(Event)(eventWith({ category: 'treat' }))).toThrow()
    expect(() => Schema.decodeUnknownSync(Event)(eventWith({ category: 'Potty' }))).toThrow()
  })

  it('rejects confidence outside [0, 1] and accepts the bounds', () => {
    expect(Schema.decodeUnknownSync(Event)(eventWith({ confidence: 0 })).confidence).toBe(0)
    expect(Schema.decodeUnknownSync(Event)(eventWith({ confidence: 1 })).confidence).toBe(1)
    expect(() => Schema.decodeUnknownSync(Event)(eventWith({ confidence: 1.01 }))).toThrow()
    expect(() => Schema.decodeUnknownSync(Event)(eventWith({ confidence: -0.01 }))).toThrow()
    expect(() => Schema.decodeUnknownSync(Event)(eventWith({ confidence: Number.NaN }))).toThrow()
  })

  it('rejects malformed quantities', () => {
    expect(() => Schema.decodeUnknownSync(Event)(eventWith({ quantity: { value: '240' } }))).toThrow()
    expect(() => Schema.decodeUnknownSync(Event)(eventWith({ quantity: { value: 0.1 / 0 } }))).toThrow()
    expect(() => Schema.decodeUnknownSync(Event)(eventWith({ quantity: { unit: 'ml' } }))).toThrow()
  })

  it('rejects empty author attribution and empty notes', () => {
    expect(() => Schema.decodeUnknownSync(Event)(eventWith({ authorId: '' }))).toThrow()
    expect(() => Schema.decodeUnknownSync(Event)(eventWith({ note: '' }))).toThrow()
  })
})

describe('Entry schema', () => {
  const rawEntry = (overrides: Record<string, unknown> = {}) => ({
    _tag: 'Entry',
    transcript: 'she ate all her lunch and went potty twice',
    authorId: 'user_dad',
    createdAt: 1_726_000_000_000,
    visibility: 'draft',
    events: [],
    ...overrides,
  })

  it('decodes with an empty events list — capture never blocks on extraction', () => {
    const decoded: Entry = Schema.decodeUnknownSync(Entry)(rawEntry())
    expect(decoded.events).toStrictEqual([])
    expect(decoded.createdAt).toBeInstanceOf(Date)
  })

  it('keeps publication visibility as an independent per-entry dimension with no audience field', () => {
    const decoded: Entry = Schema.decodeUnknownSync(Entry)(rawEntry({ visibility: 'published' }))
    expect(decoded.visibility).toBe('published')
    expect('audience' in decoded).toBe(false)
    expect('status' in decoded).toBe(false)
  })

  it('rejects visibility values outside draft|published (audience is deliberately not merged in)', () => {
    expect(() => Schema.decodeUnknownSync(Entry)(rawEntry({ visibility: 'shared' }))).toThrow()
    expect(() => Schema.decodeUnknownSync(Entry)(rawEntry({ visibility: 'private' }))).toThrow()
  })

  it('rejects empty transcripts and empty author ids', () => {
    expect(() => Schema.decodeUnknownSync(Entry)(rawEntry({ transcript: '' }))).toThrow()
    expect(() => Schema.decodeUnknownSync(Entry)(rawEntry({ authorId: '' }))).toThrow()
  })

  it('round-trips an entry carrying decoded events', () => {
    const decoded: Entry = Schema.decodeUnknownSync(Entry)(
      rawEntry({ events: [rawPotty, eventWith({ category: 'sleep', quantity: { value: 45, unit: 'min' } })] }),
    )
    const encoded = Schema.encodeSync(Entry)(decoded)
    expect(Schema.decodeUnknownSync(Entry)(encoded)).toStrictEqual(decoded)
  })
})
