/**
 * Deterministic, readable ids. Domain ids are plain annotated strings
 * (packages/domain ids.ts), so any unique non-empty string is wire-valid.
 * Fixtures use stable, human-readable ids so tests and evidence can cite them.
 */

export const nextIdFrom = (prefix: string, seq: number): string => {
  const n = String(seq).padStart(4, '0')
  return `${prefix}_${n}`
}
