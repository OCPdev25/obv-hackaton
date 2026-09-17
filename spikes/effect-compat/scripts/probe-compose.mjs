// Last pre-build probe: runtime shape of schemas (AST surface), .check composition, encode of a full TaggedStruct.
import * as Schema from 'effect/Schema'

console.log('keys of Schema.String:', Object.keys(Schema.String).sort())
console.log('typeof Schema.String.tag/_tag:', Schema.String._tag ?? Schema.String.tag)
console.log('toRepresentation:', typeof Schema.toRepresentation)

const Confidence = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
console.log('Confidence decode 0.9 ->', Schema.decodeSync(Confidence)(0.9))
try { Schema.decodeSync(Confidence)(1.2); console.log('1.2 SHOULD FAIL') } catch (e) { console.log('1.2 rejects:', e.message.split('\n')[0]) }

const Quantity = Schema.Struct({ value: Schema.Finite, unit: Schema.optionalKey(Schema.String) })
const Event = Schema.TaggedStruct('Event', {
  category: Schema.Literals(['potty', 'meal', 'sleep', 'mood', 'milestone', 'school']),
  occurredAt: Schema.DateFromMillis,
  quantity: Schema.optional(Quantity),
  confidence: Confidence,
  authorId: Schema.NonEmptyString,
  note: Schema.optionalKey(Schema.NonEmptyString),
})

// Full encode: domain value (Date object, optional quantity absent) -> wire value
const domain = {
  _tag: 'Event',
  category: 'meal',
  occurredAt: new Date(1758100000000),
  quantity: { value: 240, unit: 'ml' },
  confidence: 0.92,
  authorId: 'author_123',
}
const wire = Schema.encodeSync(Event)(domain)
console.log('encoded wire form:', JSON.stringify(wire))
const back = Schema.decodeSync(Event)(wire)
console.log('decode(encode(x)) === x on scalar fields:',
  back.occurredAt instanceof Date && back.occurredAt.getTime() === domain.occurredAt.getTime(),
  back.quantity && back.quantity.value === 240,
  back.confidence === domain.confidence)

// Optional quantity ABSENT round-trip
const domain2 = { ...domain, quantity: undefined }
delete domain2.quantity
const wire2 = Schema.encodeSync(Event)(domain2)
console.log('encoded without quantity:', JSON.stringify(wire2), '| decodes back:', Schema.decodeSync(Event)(wire2).quantity === undefined)

// toRepresentation — introspection surface for a possible generic adapter
try {
  const rep = Schema.toRepresentation(Event)
  console.log('toRepresentation(Event) keys:', Object.keys(rep ?? {}).sort().slice(0, 15).join(','))
  console.log('representation head:', JSON.stringify(rep, (_k, v) => (typeof v === 'function' ? '[fn]' : v)).slice(0, 700))
} catch (e) { console.log('toRepresentation FAILED:', e.message.split('\n')[0]) }
