// Schemas are functions in v4. Treat refine() results as schemas and decode directly.
import * as Schema from 'effect/Schema'

console.log('is curried? Schema.is(Schema.Number)(5) =', Schema.is(Schema.Number)(5), '| (\'x\') =', Schema.is(Schema.Number)('x'))

const filter = Schema.isBetween({ minimum: 0, maximum: 1 })
const bounded = Schema.refine(Schema.Number, filter)
console.log('bounded is function:', typeof bounded === 'function', '| is(bounded) accepts 0.8:', Schema.is(bounded)(0.8), '| accepts 1.5:', Schema.is(bounded)(1.5))

const dec = Schema.decodeSync(bounded)
console.log('decode 0.8 ->', dec(0.8))
try { dec(1.5); console.log('1.5 SHOULD HAVE FAILED') } catch (e) { console.log('1.5 rejects:', e.message.split('\n')[0]) }
try { dec(Number.NaN); console.log('NaN SHOULD HAVE FAILED') } catch (e) { console.log('NaN rejects:', e.message.split('\n')[0]) }
const enc = Schema.encodeSync(bounded)
console.log('encode 0.42 ->', enc(0.42), '(identity codec)')

// JSON Schema for the refined number — does the filter survive derivation?
const Struct = Schema.Struct({ confidence: bounded })
const doc = Schema.toJsonSchemaDocument(Struct)
console.log('JSON Schema of refined field:', JSON.stringify(doc.schema.properties.confidence))
