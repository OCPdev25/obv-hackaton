/**
 * Minimal structural view of the Effect v4 schema AST used by the adapter and
 * the JSON Schema derivation. This is the ONE boundary where we touch
 * undocumented AST internals; every property below was verified against
 * effect@4.0.0-rc.115 (see test/roundtrip.test.ts).
 */
export interface AstNodeView {
  readonly _tag: string
  readonly literal?: string | number | boolean | bigint
  readonly types?: ReadonlyArray<AstNodeView>
  /** Repeating element (Schema.Array): an indexable tuple whose [0] is the element AST. */
  readonly rest?: ReadonlyArray<AstNodeView>
  /** Fixed-position elements (tuple-shaped arrays). */
  readonly elements?: ReadonlyArray<AstNodeView>
  readonly annotations?: unknown
  readonly indexSignatures?: ReadonlyArray<IndexSignatureView>
  readonly propertySignatures?: ReadonlyArray<PropertySignatureView>
  readonly context?: { readonly isOptional?: boolean } | undefined
}

export interface PropertySignatureView {
  readonly name: string
  readonly type: AstNodeView
}

export interface IndexSignatureView {
  readonly parameter: AstNodeView
  readonly type: AstNodeView
}

export const astOf = (schema: unknown): AstNodeView => {
  const ast = (schema as { ast?: unknown }).ast
  if (typeof ast !== "object" || ast === null) {
    throw new Error("Effect schema is missing its AST — unsupported schema instance")
  }
  return ast as AstNodeView
}
