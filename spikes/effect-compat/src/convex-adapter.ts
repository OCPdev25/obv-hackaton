/**
 * Adapter: Effect v4 schema -> Convex validators.
 *
 * Walks the typed structural representation (`effect/SchemaRepresentation`,
 * the documented introspection surface of effect@4.0.0-rc.115) and emits
 * Convex value validators for the schema's ENCODED (wire) form. The wire form
 * is what Convex stores, so `occurredAt: Schema.DateFromMillis` (a `Date` in
 * domain code) correctly maps to `v.number()` — Effect's codec owns the
 * Date<->unix-ms conversion, and this adapter never sees a `Date`.
 *
 * This adapter is the single sanctioned representation bridge between the
 * Effect domain schema and Convex persistence. It fails loudly on any node
 * kind it does not map — never silently.
 */
import { v } from 'convex/values'
import type { GenericValidator, PropertyValidators } from 'convex/values'
import * as Schema from 'effect/Schema'
import type * as Rep from 'effect/SchemaRepresentation'

/** Raised when the walker meets a representation it cannot map to Convex. */
export class UnsupportedRepresentationError extends Error {
  readonly path: string
  readonly tag: string

  constructor(path: string, tag: string) {
    super(`No Convex mapping for Effect representation '${tag}' at '${path}'. Extend the adapter explicitly — do not widen silently.`)
    this.name = 'UnsupportedRepresentationError'
    this.path = path
    this.tag = tag
  }
}

const isUndefinedMember = (node: Rep.Representation): boolean => node._tag === 'Undefined'

/** Maps a struct field to a Convex property validator, honoring optionality. */
const propertyValidator = (ps: Rep.PropertySignature, path: string): GenericValidator => {
  if (typeof ps.name !== 'string') {
    throw new UnsupportedRepresentationError(path, 'SymbolKey')
  }
  const inner = representationValidator(ps.type, `${path}.${ps.name}`)

  // `Schema.optional(S)` surfaces as isOptional=true with an Undefined union
  // member; `Schema.optionalKey(S)` as isOptional=true alone. Both mean the
  // field may be absent on the wire -> v.optional. Convex marks optionality as
  // isOptional: 'required' | 'optional' ON the validator itself (1.46 has no
  // separate optional wrapper kind), so compare against the marker string.
  const unionMayBeUndefined = ps.type._tag === 'Union' && ps.type.types.some(isUndefinedMember)
  if (!ps.isOptional && !unionMayBeUndefined) return inner

  return inner.isOptional === 'optional' ? inner : v.optional(inner)
}

/** Maps a structural representation node to a Convex value validator. */
export const representationValidator = (node: Rep.Representation, path = '$'): GenericValidator => {
  switch (node._tag) {
    case 'Objects': {
      if (node.indexSignatures.length > 0) {
        throw new UnsupportedRepresentationError(path, 'ObjectsWithIndexSignature')
      }
      const fields: PropertyValidators = {}
      for (const ps of node.propertySignatures) {
        if (typeof ps.name !== 'string') {
          throw new UnsupportedRepresentationError(path, 'SymbolKey')
        }
        fields[ps.name] = propertyValidator(ps, path)
      }
      return v.object(fields)
    }
    case 'Literal':
      return v.literal(node.literal)
    case 'Union': {
      const members = node.types.filter((member) => !isUndefinedMember(member))
      if (members.length === 1) return representationValidator(members[0] as Rep.Representation, `${path}~0`)
      return v.union(...members.map((member, i) => representationValidator(member, `${path}~${i}`)))
    }
    case 'String':
      return v.string()
    case 'Number':
      // Convex numbers are float64; value constraints (isInt, isBetween,
      // isFinite...) stay enforced by the Effect layer on decode.
      return v.number()
    case 'Boolean':
      return v.boolean()
    case 'BigInt':
      return v.int64()
    case 'Null':
      return v.null()
    case 'Arrays': {
      if (node.elements.length > 0) {
        throw new UnsupportedRepresentationError(path, 'FixedLengthTuple')
      }
      if (node.rest.length !== 1) {
        throw new UnsupportedRepresentationError(path, 'ArraysRestLength')
      }
      return v.array(representationValidator(node.rest[0] as Rep.Representation, `${path}[]`))
    }
    default:
      throw new UnsupportedRepresentationError(path, node._tag)
  }
}

/**
 * Builds the Convex object validator for a whole schema whose wire form is an
 * object (Entry, Event). The canonical schemas in `schema.ts` all qualify.
 */
export const toConvexObjectValidator = (schema: Schema.Schema<unknown>): GenericValidator => {
  const doc = Schema.toRepresentation(schema)
  if (doc.representation._tag !== 'Objects') {
    throw new UnsupportedRepresentationError('$', doc.representation._tag)
  }
  return representationValidator(doc.representation)
}
