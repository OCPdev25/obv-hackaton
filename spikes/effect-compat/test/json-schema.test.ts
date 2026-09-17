import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import { Entry } from '../src/schema'
import { toJsonSchema } from '../src/json-schema'

const doc = toJsonSchema(Entry)

const walk = (node: unknown, visit: (n: Record<string, unknown>) => void): void => {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit))
    return
  }
  if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>
    visit(record)
    Object.values(record).forEach((child) => walk(child, visit))
  }
}

const collect = (predicate: (n: Record<string, unknown>) => boolean): Array<Record<string, unknown>> => {
  const found: Array<Record<string, unknown>> = []
  walk(doc.schema, (n) => {
    if (predicate(n)) found.push(n)
  })
  return found
}

describe('JSON Schema derivation (effect@4.0.0-rc.115)', () => {
  it('derives a draft-2020-12 document via Schema.toJsonSchemaDocument', () => {
    expect(doc.dialect).toBe('draft-2020-12')
    expect(doc.schema).toBeTypeOf('object')
  })

  it('keeps the six journal categories as a string enum', () => {
    const categoryEnums = collect((n) => Array.isArray(n.enum)).map((n) => n.enum)
    expect(categoryEnums).toContainEqual(['potty', 'meal', 'sleep', 'mood', 'milestone', 'school'])
  })

  it('maps the timestamp codec to integer (unix millis on the wire)', () => {
    expect(collect((n) => n.type === 'integer').length).toBeGreaterThanOrEqual(2)
  })

  it('bounds confidence with minimum 0 and maximum 1', () => {
    const bounded = collect((n) => n.minimum === 0 && n.maximum === 1)
    expect(bounded.length).toBeGreaterThanOrEqual(1)
  })

  it('requires the core entry fields and marks the root an object', () => {
    const root = doc.schema as Record<string, unknown>
    expect(root.type).toBe('object')
    const required = root.required as Array<string>
    for (const key of ['_tag', 'transcript', 'authorId', 'createdAt', 'visibility', 'events']) {
      expect(required).toContain(key)
    }
  })

  it('yields no JSON Schema document via toStandardJSONSchemaV1 on this pin (verified behavior)', () => {
    // On effect@4.0.0-rc.115 this returns the schema itself, not a JSON Schema
    // document — toJsonSchemaDocument is the only working derivation path.
    expect(Schema.toStandardJSONSchemaV1(Entry)).not.toHaveProperty('schema')
  })
})
