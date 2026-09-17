// Find how v4 attaches a filter to a schema; then confirm bounded-number decode.
import * as Schema from 'effect/Schema'

const bounds = { minimum: 0, maximum: 1 }
const filter = Schema.isBetween(bounds)
console.log('filter object keys:', Object.keys(filter).sort().slice(0, 12).join(','))

const attempts = {
  'refine(schema, filter)': () => Schema.refine(Schema.Number, filter),
  'Number.pipe(filter)': () => Schema.Number.pipe(filter),
  'check(schema, filter)': () => Schema.check(Schema.Number, filter),
}

for (const [label, fn] of Object.entries(attempts)) {
  try {
    const s = fn()
    if (!s || typeof s !== 'object') { console.log(`${label} -> ${typeof s} (not a schema)`); continue }
    console.log(`${label}: decode 0.8 ->`, JSON.stringify(Schema.decodeSync(s)(0.8)))
    try { Schema.decodeSync(s)(1.5); console.log(`${label}: 1.5 SHOULD HAVE FAILED`) } catch (e) { console.log(`${label}: 1.5 rejects ->`, e.message.split('\n')[0]) }
    try { Schema.decodeSync(s)(Number.NaN); console.log(`${label}: NaN SHOULD HAVE FAILED`) } catch (e) { console.log(`${label}: NaN rejects ->`, e.message.split('\n')[0]) }
  } catch (e) { console.log(`${label} FAILED:`, e.message.split('\n')[0]) }
}
