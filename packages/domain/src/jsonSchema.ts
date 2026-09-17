import { SchemaRepresentation } from "effect"
import type { JsonSchema } from "effect"

/**
 * Derive a JSON Schema (draft 2020-12) tool contract from a domain Effect
 * schema — e.g. for LLM tool definitions and external API documentation.
 *
 * Effect's own decoder remains the final authority: the generated JSON Schema
 * is for preliminary/interoperability validation and may be less strict than
 * the Effect schema (per the Effect v4 docs' own caveat).
 */
export const toolSchemaFor = (schema: unknown): JsonSchema.Document<"draft-2020-12"> => {
  // Boundary passthrough: `ast` is Effect's undocumented AST type. We hand it
  // straight to Effect's own SchemaRepresentation and never inspect it here
  // (the adapter's structural view in ./schemaAst.ts is the inspection path).
  const ast = (schema as { ast?: unknown }).ast as Parameters<
    typeof SchemaRepresentation.toRepresentation
  >[0]
  return SchemaRepresentation.toJsonSchemaDocument(SchemaRepresentation.toRepresentation(ast))
}
