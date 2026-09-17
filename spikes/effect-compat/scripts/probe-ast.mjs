// Enumerate AST node kinds in Entry's representation — drives the adapter's walker coverage.
import * as Schema from 'effect/Schema'
import { Entry } from '../src/schema.ts'

const rep = Schema.toRepresentation(Entry).representation
const tags = new Set()
const paths = []
const walk = (node, path) => {
  if (!node || typeof node !== 'object') return
  tags.add(node._tag)
  if (node._tag === 'Objects') {
    for (const ps of node.propertySignatures) {
      paths.push(`${path}.${ps.name}: isOptional=${ps.isOptional} typeTag=${ps.type._tag}`)
      walk(ps.type, `${path}.${ps.name}`)
    }
  } else if (node._tag === 'Union') {
    for (const t of node.types) {
      paths.push(`${path}~member:${t._tag}`)
      walk(t, `${path}~member`)
    }
  } else if (node._tag === 'Tuple' || node._tag === 'Array') {
    console.log(`${path}: Tuple-ish node keys:`, Object.keys(node).sort().join(','))
    if (node.elements) for (const [i, e] of node.elements.entries()) { paths.push(`${path}[${i}]:${e._tag}`); walk(e.type ?? e, `${path}[${i}]`) }
  }
}
walk(rep, 'Entry')
console.log('ALL TAGS:', [...tags].sort().join(', '))
console.log('\nproperty map:')
for (const p of paths) console.log(' ', p)
