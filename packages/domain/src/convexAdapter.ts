import { v, type GenericValidator } from "convex/values"
import { astOf, type AstNodeView, type PropertySignatureView } from "./schemaAst.js"
import { convexTableFrom } from "./ids.js"

/**
 * The single Effect schema -> Convex validator adapter. Domain schemas are the
 * only source of table field definitions; this adapter derives the Convex
 * representation so no competing validator model is maintained by hand.
 *
 * Supported schema vocabulary (each mapping is covered by a round-trip test):
 *   String -> v.string(), annotated with convexTable -> v.id(table)
 *   Number / Boolean -> v.number() / v.boolean()
 *   Literal / Literals([...]) -> v.literal(...) / v.union(v.literal(...), ...)
 *   optional / optionalKey -> v.optional(inner)
 *   Schema.Record(String, X) -> v.record(v.string(), mapped X)
 *   Schema.Array(X) -> v.array(mapped X)
 *   nested Schema.Struct -> v.object(mapped fields)
 *
 * Filters and checks (nonEmpty, between, Int, ...) stay on the Effect side of
 * the boundary — Convex validators cover the storage shape and the Effect
 * schema remains the final authority on values. Anything outside this
 * vocabulary fails loudly instead of guessing.
 */

export type ConvexFieldValidators = Record<string, GenericValidator>

const unsupported = (node: AstNodeView): never => {
  throw new Error(`Convex adapter: unsupported schema node _tag=${node._tag}`)
}

/** Union nodes that only mark key/value optionality unwrap to their member. */
const unwrapOptionalMarker = (node: AstNodeView): AstNodeView => {
  if (node._tag !== "Union" || node.context?.isOptional !== true) return node
  const defined = (node.types ?? []).filter((t) => t._tag !== "Undefined")
  if (defined.length !== 1) return node
  const inner = defined[0]
  if (inner === undefined) return node
  return inner
}

const literalValue = (node: AstNodeView): string | number | boolean => {
  const { literal } = node
  if (typeof literal === "string" || typeof literal === "number" || typeof literal === "boolean") return literal
  return unsupported(node)
}

const validatorFor = (node: AstNodeView): GenericValidator => {
  switch (node._tag) {
    case "String": {
      const table = convexTableFrom(node.annotations)
      return table === undefined ? v.string() : v.id(table)
    }
    case "Number":
      return v.number()
    case "Boolean":
      return v.boolean()
    case "Literal":
      return v.literal(literalValue(node))
    case "Union": {
      const members = node.types ?? []
      if (members.length > 0 && members.every((m) => m._tag === "Literal")) {
        return v.union(...members.map((m) => v.literal(literalValue(m))))
      }
      return unsupported(node)
    }
    case "Objects": {
      const indexSignatures = node.indexSignatures ?? []
      if (indexSignatures.length > 0) {
        const signature = indexSignatures[0]
        if (signature === undefined) return unsupported(node)
        const { parameter, type } = signature
        if (parameter._tag !== "String") return unsupported(parameter)
        return v.record(v.string(), validatorFor(type))
      }
      return v.object(fieldsFromPropertySignatures(node.propertySignatures ?? []))
    }
    case "Arrays": {
      // Schema.Array(X) stores the repeating element in `rest` (a tuple whose
      // [0] is the element AST); fixed-position tuples use `elements`.
      const first = node.rest?.[0] ?? node.elements?.[0]
      if (first === undefined) return unsupported(node)
      return v.array(validatorFor(first))
    }
    default:
      return unsupported(node)
  }
}

export const fieldsFromPropertySignatures = (signatures: ReadonlyArray<PropertySignatureView>): ConvexFieldValidators => {
  const fields: ConvexFieldValidators = {}
  for (const ps of signatures) {
    const isOptional = ps.type.context?.isOptional === true
    const base = validatorFor(unwrapOptionalMarker(ps.type))
    fields[ps.name] = isOptional ? v.optional(base) : base
  }
  return fields
}

/**
 * Derive the Convex validators for every field of a domain `Schema.Struct`.
 * Used by `backend/convex` for `defineTable` and by function `args`.
 */
export const convexFields = (schema: unknown): ConvexFieldValidators => {
  const node = astOf(schema)
  if (node._tag !== "Objects" || node.propertySignatures === undefined) {
    throw new Error("Convex adapter: expected a Schema.Struct")
  }
  return fieldsFromPropertySignatures(node.propertySignatures)
}
