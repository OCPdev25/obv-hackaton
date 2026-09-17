// Probes the pinned effect build for the surfaces this spike depends on.
// Run: npm run probe  (from spikes/effect-compat)
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkg = require('effect/package.json')
console.log('effect version:', pkg.version)

const attempt = async (label, specifier) => {
  try {
    const mod = await import(specifier)
    const keys = Object.keys(mod).sort()
    console.log(`OK    ${specifier} (${keys.length} exports)`)
    return mod
  } catch (err) {
    console.log(`FAIL  ${specifier}: ${err.code ?? err.message}`)
    return null
  }
}

const Schema = await attempt('schema', 'effect/Schema')
const jsonSchema = await attempt('jsonschema', 'effect/JSONSchema')

if (Schema) {
  // What shape-building and introspection APIs exist in this build?
  const interesting = ['Struct', 'TaggedStruct', 'Literal', 'Union', 'Array', 'Optional', 'String', 'Number', 'Boolean', 'Null', 'Date', 'DateFromNumber', 'UnixMillis', 'encodeUnknownEither', 'decodeUnknownEither', 'validateEither', 'is', 'typeAST', 'AST']
  console.log('\nSchema API presence:')
  for (const k of interesting) console.log(`  ${k}: ${k in Schema ? 'yes' : 'NO'}`)
  console.log('\nAll Schema exports containing "JSON" or "json":', Object.keys(Schema).filter(k => k.toLowerCase().includes('json')))
  // Full export list for the record
  console.log('\nFull Schema export list:')
  console.log(Object.keys(Schema).sort().join(', '))
}

if (jsonSchema) {
  console.log('\nJSONSchema exports:', Object.keys(jsonSchema).sort().join(', '))
}
