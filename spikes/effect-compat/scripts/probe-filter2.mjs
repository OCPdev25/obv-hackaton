// What exactly do refine/check return, and how do we finish a bounded number?
import * as Schema from 'effect/Schema'

console.log('typeof Schema.Number:', typeof Schema.Number, '| Schema.is(Schema.Number):', Schema.is(Schema.Number))
const filter = Schema.isBetween({ minimum: 0, maximum: 1 })
const r = Schema.refine(Schema.Number, filter)
console.log('refine(...) ->', typeof r, 'length:', r.length, 'Schema.is(r):', Schema.is(r))
const c = Schema.check(Schema.Number, filter)
console.log('check(...)  ->', typeof c, 'length:', c.length, 'Schema.is(c):', Schema.is(c))

// Try calling the returned function with zero args and treating result as schema
try {
  const r2 = r()
  console.log('r() ->', typeof r2, Schema.is(r2) ? 'is schema' : 'not schema')
  if (Schema.is(r2)) {
    console.log('decode 0.8 ->', JSON.stringify(Schema.decodeSync(r2)(0.8)))
    try { Schema.decodeSync(r2)(1.5); console.log('1.5 SHOULD FAIL') } catch (e) { console.log('1.5 rejects:', e.message.split('\n')[0]) }
  }
} catch (e) { console.log('r() threw:', e.message.split('\n')[0]) }

// Maybe the form is refine(filter)(schema)?
try {
  const r3 = Schema.refine(filter)(Schema.Number)
  console.log('refine(filter)(schema) ->', typeof r3, Schema.is(r3) ? 'is schema' : 'not schema')
} catch (e) { console.log('refine(filter)(schema) threw:', e.message.split('\n')[0]) }

// Inspect what filter.run is and try makeFilter
console.log('filter.run:', typeof filter.run, '| makeFilter:', typeof Schema.makeFilter)
try {
  const mf = Schema.makeFilter('isBetween', (n) => n >= 0 && n <= 1, { message: 'expected 0..1' })
  console.log('makeFilter ->', typeof mf, mf && Object.keys(mf).sort().slice(0, 8).join(','))
} catch (e) { console.log('makeFilter threw:', e.message.split('\n')[0]) }
