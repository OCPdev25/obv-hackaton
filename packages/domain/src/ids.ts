import { Schema } from "effect"

/**
 * Annotation key read by the Effect -> Convex validator adapter
 * (`./convexAdapter.ts`). A string schema annotated with this key maps to a
 * Convex `v.id(<table>)` validator; without it, it maps to `v.string()`.
 */
export const CONVEX_TABLE_ANNOTATION = "convexTable"

export const convexId = (table: string) => Schema.String.annotate({ [CONVEX_TABLE_ANNOTATION]: table })

export const convexTableFrom = (annotations: unknown): string | undefined => {
  if (typeof annotations !== "object" || annotations === null) return undefined
  const value = (annotations as Record<string, unknown>)[CONVEX_TABLE_ANNOTATION]
  return typeof value === "string" ? value : undefined
}
