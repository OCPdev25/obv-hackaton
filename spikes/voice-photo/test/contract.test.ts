import { describe, expect, it } from 'vitest'
import { decodeEntry, decodeEvent, encodeEntry, encodeEvent, type EventWire } from '../src/contract/schema'

const mealEventWire: EventWire = {
  _tag: 'Event',
  category: 'meal',
  occurredAt: 1726500000000,
  confidence: 0.9,
  authorId: 'caregiver_1',
  note: 'half the pasta',
}

describe('Event contract (spike mock of art_I2TCG08V)', () => {
  it('decodes wire numbers into domain Dates and keeps optionals', () => {
    const event = decodeEvent(mealEventWire)
    expect(event.occurredAt).toBeInstanceOf(Date)
    expect(event.occurredAt.getTime()).toBe(1726500000000)
    expect(event.category).toBe('meal')
    expect(event.note).toBe('half the pasta')
  })

  it('decodes quantity payloads', () => {
    const event = decodeEvent({ ...mealEventWire, quantity: { value: 250, unit: 'ml' } })
    expect(event.quantity).toEqual({ value: 250, unit: 'ml' })
  })

  it('rejects categories outside the six literals', () => {
    expect(() => decodeEvent({ ...mealEventWire, category: 'toys' })).toThrow()
  })

  it('rejects confidence outside [0,1] and non-finite confidence', () => {
    expect(() => decodeEvent({ ...mealEventWire, confidence: 1.5 })).toThrow()
    expect(() => decodeEvent({ ...mealEventWire, confidence: -0.1 })).toThrow()
    expect(() => decodeEvent({ ...mealEventWire, confidence: Number.NaN })).toThrow()
  })

  it('rejects explicit null note — null is not in the contract', () => {
    expect(() => decodeEvent({ ...mealEventWire, note: null })).toThrow()
  })

  it('rejects empty-string note (NonEmptyString)', () => {
    expect(() => decodeEvent({ ...mealEventWire, note: '' })).toThrow()
  })

  it('encodes back to wire: Date -> unix ms and strips absent optionals', () => {
    const event = decodeEvent(mealEventWire)
    const wire = encodeEvent(event)
    expect(wire.occurredAt).toBe(1726500000000)
    expect('quantity' in wire).toBe(false)
    expect(wire.note).toBe('half the pasta')
  })
})

const entryWire = {
  _tag: 'Entry',
  transcript: 'She ate lunch at school today',
  authorId: 'caregiver_1',
  createdAt: 1726500000000,
  status: 'draft',
  events: [mealEventWire],
} as const

describe('Entry contract (spike mock of art_I2TCG08V)', () => {
  it('decodes a full Entry with events', () => {
    const entry = decodeEntry(entryWire)
    expect(entry.createdAt).toBeInstanceOf(Date)
    expect(entry.transcript).toBe('She ate lunch at school today')
    expect(entry.status).toBe('draft')
    expect(entry.events).toHaveLength(1)
    expect(entry.events[0]?.occurredAt).toBeInstanceOf(Date)
  })

  it('allows an empty events array — extraction failure never blocks capture', () => {
    const entry = decodeEntry({ ...entryWire, events: [] })
    expect(entry.events).toEqual([])
  })

  it('rejects empty transcript and unknown status', () => {
    expect(() => decodeEntry({ ...entryWire, transcript: '' })).toThrow()
    expect(() => decodeEntry({ ...entryWire, status: 'archived' })).toThrow()
  })

  it('encodes back to wire with unix-ms createdAt', () => {
    const wire = encodeEntry(decodeEntry(entryWire))
    expect(wire.createdAt).toBe(1726500000000)
    expect(wire.events[0]?.occurredAt).toBe(1726500000000)
  })
})
