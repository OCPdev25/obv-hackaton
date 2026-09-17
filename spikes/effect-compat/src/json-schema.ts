/**
 * JSON Schema derivation from the canonical Effect schema.
 *
 * Verified on effect@4.0.0-rc.115 (see FINDINGS.md):
 * - `effect/JSONSchema` (the Effect v3 module) does NOT exist in v4 —
 *   importing it fails with ERR_MODULE_NOT_FOUND.
 * - `Schema.toJsonSchemaDocument(schema)` is the built-in v4 surface and
 *   returns a `JsonSchema.Document<"draft-2020-12">`.
 * - `Schema.toStandardJSONSchemaV1(struct)` returns `undefined` for plain
 *   structs on this pin — treated as unsupported here.
 */
import * as Schema from 'effect/Schema'

/** Derives a draft-2020-12 JSON Schema document from any Effect schema. */
export const toJsonSchema = (schema: Schema.Schema<unknown>) => Schema.toJsonSchemaDocument(schema)
