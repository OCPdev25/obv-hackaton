// Find the v4 way to build a bounded number + run JSON Schema derivation.
import * as Schema from 'effect/Schema'

console.log('typeof isBetween:', typeof Schema.isBetween, '| arity:', Schema.isBetween.length)
console.log('typeof makeIsBetween:', typeof Schema.makeIsBetween, '| arity:', Schema.makeIsBetween.length)
console.log('typeof check:', typeof Schema.check, '| arity:', Schema.check.length)
console.log('typeof refine:', typeof Schema.refine, '| arity:', Schema.refine.length)
console.log('Number has .pipe:', typeof Schema.Number.pipe, '| Number has .annotations:', typeof Schema.Number.annotations)

// Candidate A: isBetween(min, max) as a filter, combined via check/refine
try {
  const bounded = Schema.check(Schema.Number, Schema.isBetween(0, 1))
  console.log('A. check(Number, isBetween(0,1)) ok; decode 0.8 ->', JSON.stringify(Schema.decodeSync(bounded)(0.8)))
  try { Schema.decodeSync(bounded)(1.5); console.log('   1.5 SHOULD HAVE FAILED') } catch (e) { console.log('   1.5 rejects:', e.message.split('\n')[0]) }
} catch (e) { console.log('A. check(Number, isBetween(0,1)) FAILED:', e.message.split('\n')[0]) }

// Candidate B: isBetween as direct schema constructor with bounds object
try {
  const bounded2 = Schema.isBetween({ minimum: 0, maximum: 1 })
  console.log('B. isBetween({minimum,maximum}) returns:', typeof bounded2)
} catch (e) { console.log('B. FAILED:', e.message.split('\n')[0]) }

// Candidate C: pipe
try {
  const bounded3 = Schema.Number.pipe(Schema.isBetween(0, 1))
  console.log('C. Number.pipe(isBetween(0,1)) ok; decode 0.5 ->', JSON.stringify(Schema.decodeSync(bounded3)(0.5)))
} catch (e) { console.log('C. Number.pipe FAILED:', e.message.split('\n')[0]) }

// JSON Schema derivation on a fixed sample
const Sample = Schema.Struct({
  id: Schema.String,
  at: Schema.DateFromMillis,
  note: Schema.optionalKey(Schema.String),
  category: Schema.Literals(['potty', 'meal']),
})
try {
  const doc = Schema.toJsonSchemaDocument(Sample)
  console.log('6. toJsonSchemaDocument:', JSON.stringify(doc).slice(0, 900))
} catch (e) { console.log('6. toJsonSchemaDocument FAILED:', e.message.split('\n')[0]) }
try {
  const std = Schema.toStandardJSONSchemaV1(Sample)
  console.log('6b. toStandardJSONSchemaV1:', JSON.stringify(std).slice(0, 900))
} catch (e) { console.log('6b. toStandardJSONSchemaV1 FAILED:', e.message.split('\n')[0]) }
