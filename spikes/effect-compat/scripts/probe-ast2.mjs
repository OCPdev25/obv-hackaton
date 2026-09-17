// Inspect Arrays node shape + Event's optional/optionalKey fields.
import * as Schema from 'effect/Schema'
import { Entry, Event } from '../src/schema.ts'

const dump = (node, depth = 0, max = 4) => {
  const pad = '  '.repeat(depth)
  if (!node || typeof node !== 'object') return `${pad}${JSON.stringify(node)}`
  if (node._tag === 'Arrays') {
    console.log(`${pad}Arrays keys:`, Object.keys(node).sort().join(','))
    if (node.element) { console.log(`${pad}element:`); dump(node.element, depth + 1) }
    else if (node.elements) node.elements.forEach((e, i) => { console.log(`${pad}element[${i}]:`); dump(e.type ?? e, depth + 1) })
    return
  }
  if (node._tag === 'Objects') {
    console.log(`${pad}Objects:`)
    for (const ps of node.propertySignatures) {
      console.log(`${pad}  .${ps.name} isOptional=${ps.isOptional} mutable=${ps.isMutable} type=${ps.type._tag}`)
      if (depth < max) dump(ps.type, depth + 2, max)
    }
    return
  }
  if (node._tag === 'Union') {
    console.log(`${pad}Union of ${node.types.length}:`)
    for (const t of node.types) dump(t, depth + 1, max)
    return
  }
  console.log(`${pad}${node._tag}${node.literal !== undefined ? ` (${JSON.stringify(node.literal)})` : ''}${node.checks?.length ? ` checks=[${node.checks.map(c => c.representation?.id ?? '?').join(',')}]` : ''}`)
}

console.log('=== Entry.events element ===')
dump(Schema.toRepresentation(Entry).representation.propertySignatures.find(p => p.name === 'events').type)
console.log('=== Event struct ===')
dump(Schema.toRepresentation(Event).representation)
