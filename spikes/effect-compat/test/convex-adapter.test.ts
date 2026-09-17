import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import { compareValues, convexToJson, jsonToConvex } from 'convex/values'
import type { Value } from 'convex/values'
import { Entry, Event } from '../src/schema'
import type { GenericValidator } from 'convex/values'
import { toConvexObjectValidator, UnsupportedRepresentationError } from '../src/convex-adapter'

/**
 * Effect encodes into readonly structures; Convex's `Value` type wants mutable
 * ones. The runtime shapes are identical plain objects — structuredClone is the
 * documented handoff point between the two type systems.
 */
const asValue = (encoded: object): Value => structuredClone(encoded) as unknown as Value

/** Minimal structural view of Convex validators for assertions (they are declarative objects). */
interface ValidatorNode {
  kind?: string
  value?: unknown
  isOptional?: string
  members?: ValidatorNode[]
  fields?: Record<string, ValidatorNode>
}
const asNode = (v: GenericValidator): ValidatorNode => v as unknown as ValidatorNode

const entryValidator = toConvexObjectValidator(Entry)
const entryFields = asNode(entryValidator).fields as Record<string, ValidatorNode>
const eventValidator = toConvexObjectValidator(Event)
const eventFields = asNode(eventValidator).fields as Record<string, ValidatorNode>

describe('adapter structure', () => {
  it('maps Entry to an object validator with correct field kinds', () => {
    expect(asNode(entryValidator).kind).toBe('object')
    expect(entryFields._tag?.kind).toBe('literal')
    expect(entryFields._tag?.value).toBe('Entry')
    expect(entryFields.transcript?.kind).toBe('string')
    expect(entryFields.createdAt?.kind).toBe('float64')
    expect(entryFields.events?.kind).toBe('array')
  })

  it('maps the visibility literal union to a two-member literal union', () => {
    const visibility = entryFields.visibility
    expect(visibility?.kind).toBe('union')
    expect(visibility?.members?.map((m) => m.value)).toStrictEqual(['draft', 'published'])
  })

  it('maps Event fields: six-category union, float64 timestamps, optional quantity/note', () => {
    expect(eventFields.category?.kind).toBe('union')
    expect(eventFields.category?.members?.map((m) => m.value)).toStrictEqual([
      'potty',
      'meal',
      'sleep',
      'mood',
      'milestone',
      'school',
    ])
    expect(eventFields.occurredAt?.kind).toBe('float64')
    expect(eventFields.confidence?.kind).toBe('float64')
    // Convex 1.46 marks optionality via isOptional: 'optional' on the validator
    // itself — there is no separate optional wrapper kind.
    expect(eventFields.quantity?.kind).toBe('object')
    expect(eventFields.quantity?.isOptional).toBe('optional')
    expect(eventFields.note?.kind).toBe('string')
    expect(eventFields.note?.isOptional).toBe('optional')
  })

  it('maps the quantity sub-struct to an object validator with an optional unit', () => {
    const quantityObject = eventFields.quantity
    expect(quantityObject?.fields?.value?.kind).toBe('float64')
    expect(quantityObject?.fields?.value?.isOptional).toBe('required')
    expect(quantityObject?.fields?.unit?.kind).toBe('string')
    expect(quantityObject?.fields?.unit?.isOptional).toBe('optional')
  })
})

describe('Convex round-trip', () => {
  const decodeEntry = (wire: unknown) => Schema.decodeUnknownSync(Entry)(wire)

  it('survives encode -> convexToJson -> jsonToConvex -> decode with deep equality', () => {
    const decoded = decodeEntry({
      _tag: 'Entry',
      transcript: 'she ate all her lunch and went potty twice',
      authorId: 'user_dad',
      createdAt: 1_726_000_000_000,
      visibility: 'published',
      events: [
        { _tag: 'Event', category: 'potty', occurredAt: 1_726_000_010_000, confidence: 0.9, authorId: 'user_mom' },
        {
          _tag: 'Event',
          category: 'meal',
          occurredAt: 1_726_000_060_000,
          confidence: 1,
          authorId: 'user_dad',
          quantity: { value: 240, unit: 'ml' },
          note: 'ate everything',
        },
      ],
    })
    const encoded = Schema.encodeSync(Entry)(decoded)

    const restored = jsonToConvex(convexToJson(asValue(encoded)))
    expect(compareValues(restored, asValue(encoded))).toBe(0)

    const redecoded = decodeEntry(restored)
    expect(redecoded).toStrictEqual(decoded)
    expect(redecoded.events[1]?.occurredAt).toBeInstanceOf(Date)
    expect(redecoded.events[1]?.quantity).toStrictEqual({ value: 240, unit: 'ml' })
  })

  it('drops undefined optional fields during serialization and still decodes', () => {
    const decoded = decodeEntry({
      _tag: 'Entry',
      transcript: 'quiet nap',
      authorId: 'user_mom',
      createdAt: 1_726_000_200_000,
      visibility: 'draft',
      events: [
        { _tag: 'Event', category: 'sleep', occurredAt: 1_726_000_210_000, confidence: 0.8, authorId: 'user_mom' },
      ],
    })
    const encoded = Schema.encodeSync(Entry)(decoded)

    const restored = jsonToConvex(convexToJson(asValue(encoded)))
    const redecoded = decodeEntry(restored)

    expect(redecoded).toStrictEqual(decoded)
    expect('quantity' in (redecoded.events[0] ?? {})).toBe(false)
  })

  it('fails loudly on unsupported representations (fixed-length tuple)', () => {
    expect(() => toConvexObjectValidator(Schema.Tuple([Schema.String, Schema.Number]))).toThrow(
      UnsupportedRepresentationError,
    )
  })

  it('fails loudly on index signatures', () => {
    expect(() => toConvexObjectValidator(Schema.Record(Schema.String, Schema.Number))).toThrow(
      UnsupportedRepresentationError,
    )
  })
})
