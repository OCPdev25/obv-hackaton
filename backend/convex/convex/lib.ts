/**
 * Shared mutation/query helpers for the ported thin-path functions.
 *
 * The Effect schema is the final authority on values (the Convex validators
 * derived from the same contracts cover only the storage shape), so handlers
 * decode their args through the canonical contracts. Two normalizations make
 * those decodes safe against wire variance:
 *   - undefined-valued keys are dropped (an optional Effect key wants an
 *     absent key, and Convex optional args can arrive as explicit undefined);
 *   - schema errors are rethrown as typed ConvexErrors so clients see the
 *     { code, message } shape instead of a raw parser dump.
 */

export const stripUndefined = (value: Record<string, unknown>): Record<string, unknown> => {
  const cleaned: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined) cleaned[key] = v
  }
  return cleaned
}

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))
