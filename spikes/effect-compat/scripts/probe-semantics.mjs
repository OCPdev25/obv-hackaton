// Probes the exact v4 semantics the canonical schema needs. Evidence for FINDINGS.md.
import * as Schema from 'effect/Schema'

// 1. Literals union for categories
try {
  const Category = Schema.Literals(['potty', 'meal', 'sleep', 'mood', 'milestone', 'school'])
  console.log('1. Literals([...]):', Schema.is(Category) ? 'schema ok' : 'not a schema')
  console.log('   decode "meal" ->', JSON.stringify(Schema.decodeSync(Category)('meal')))
  try { Schema.decodeSync(Category)('snack'); console.log('   decode "snack" -> SHOULD HAVE FAILED') } catch (e) { console.log('   decode "snack" rejects:', e.message.split('\n')[0]) }
} catch (e) { console.log('1. Literals FAILED:', e.message.split('\n')[0]) }

// 2. optional vs optionalKey — what happens to a MISSING key on decode?
try {
  const WithOptional = Schema.Struct({ a: Schema.Number, b: Schema.optional(Schema.String) })
  console.log('2. optional: decode {a:1} (no b key) ->', JSON.stringify(Schema.decodeUnknownSync(WithOptional)({ a: 1 })))
} catch (e) { console.log('2. optional with missing key FAILED:', e.message.split('\n')[0]) }
try {
  const WithOptionalKey = Schema.Struct({ a: Schema.Number, b: Schema.optionalKey(Schema.String) })
  console.log('2b. optionalKey: decode {a:1} (no b key) ->', JSON.stringify(Schema.decodeUnknownSync(WithOptionalKey)({ a: 1 })))
  console.log('2b. optionalKey: decode {a:1,b:undefined} ->', JSON.stringify(Schema.decodeUnknownSync(WithOptionalKey)({ a: 1, b: undefined })))
} catch (e) { console.log('2b. optionalKey FAILED:', e.message.split('\n')[0]) }

// 3. isBetween refine combinator
try {
  const Confidence = Schema.isBetween(Schema.Number, { minimum: 0, maximum: 1 })
  console.log('3. isBetween(0,1): decode 0.8 ->', JSON.stringify(Schema.decodeSync(Confidence)(0.8)))
  try { Schema.decodeSync(Confidence)(1.5); console.log('   decode 1.5 -> SHOULD HAVE FAILED') } catch (e) { console.log('   decode 1.5 rejects:', e.message.split('\n')[0]) }
} catch (e) { console.log('3. isBetween FAILED:', e.message) }

// 4. DateFromMillis codec direction (number in, Date out?)
try {
  const Ts = Schema.DateFromMillis
  const decoded = Schema.decodeSync(Ts)(1758100000000)
  console.log('4. DateFromMillis decode number ->', decoded instanceof Date ? `Date ${decoded.toISOString()}` : typeof decoded)
  const encoded = Schema.encodeSync(Ts)(decoded)
  console.log('   encode Date ->', typeof encoded, encoded)
} catch (e) { console.log('4. DateFromMillis FAILED:', e.message) }

// 5. TaggedStruct shape
try {
  const Ev = Schema.TaggedStruct('Event', { category: Schema.String })
  const v = Schema.decodeSync(Ev)({ _tag: 'Event', category: 'meal' })
  console.log('5. TaggedStruct:', JSON.stringify(v))
} catch (e) { console.log('5. TaggedStruct FAILED:', e.message.split('\n')[0]) }

// 6. JSON Schema derivation — the two built-in surfaces
const Sample = Schema.Struct({
  id: Schema.String,
  at: Schema.DateFromMillis,
  confidence: Schema.isBetween(Schema.Number, { minimum: 0, maximum: 1 }),
  note: Schema.optionalKey(Schema.String),
  category: Schema.Literals(['potty', 'meal']),
})
for (const name of ['toJsonSchemaDocument', 'toStandardJSONSchemaV1']) {
  try {
    const out = Schema[name](Sample)
    console.log(`6. ${name} output:`)
    console.log(JSON.stringify(out, null, 2).slice(0, 1400))
  } catch (e) { console.log(`6. ${name} FAILED:`, e.message.split('\n')[0]) }
}

// 7. Union of structs (for per-category payload, if needed)
try {
  const U = Schema.Union(Schema.Struct({ k: Schema.Literals(['a']), n: Schema.Number }), Schema.Struct({ k: Schema.Literals(['b']), s: Schema.String }))
  console.log('7. Union decode {k:"a",n:1} ->', JSON.stringify(Schema.decodeUnknownSync(U)({ k: 'a', n: 1 })))
} catch (e) { console.log('7. Union FAILED:', e.message.split('\n')[0]) }
