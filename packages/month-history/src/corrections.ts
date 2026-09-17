/**
 * Append-only correction lineage — PROPOSAL TIER (see CONTRACT-PROPOSAL.md;
 * canonical adoption is owned by the contract v0.3 fold and slot 10).
 *
 * A correction never mutates or deletes the original entry: it is a new,
 * attributed record that POINTS at the original and at the correction it
 * supersedes. `buildLineage` is a pure projection — input data is treated as
 * immutable and is never reordered in place.
 */

export interface CorrectionRecord {
  readonly correctionId: string
  /** The entry being corrected. Never removed, never mutated. */
  readonly originalEntryId: string
  /** Attributed author of the correction (server-bound to the principal). */
  readonly correctedBy: string
  readonly createdAtMs: number
  readonly reason?: string
  /** Replacement raw text — stored as its own verbatim capture. */
  readonly replacementTranscript: string
  /** Chain link: the earlier correction this one supersedes, if any. */
  readonly supersedesCorrectionId?: string
}

export interface CorrectionLineage {
  readonly originalEntryId: string
  /** Ordered by (createdAtMs, correctionId) — deterministic under ties. */
  readonly chain: readonly CorrectionRecord[]
}

export function buildLineage(corrections: readonly CorrectionRecord[]): ReadonlyMap<string, CorrectionLineage> {
  const byOriginal = new Map<string, CorrectionRecord[]>()
  for (const correction of corrections) {
    const bucket = byOriginal.get(correction.originalEntryId) ?? []
    bucket.push(correction)
    byOriginal.set(correction.originalEntryId, bucket)
  }
  const lineage = new Map<string, CorrectionLineage>()
  for (const [originalEntryId, records] of byOriginal) {
    // Chain integrity: every supersedesCorrectionId must point at an EARLIER
    // correction of the SAME original — an append-only chain, no forks into
    // other entries, no forward references.
    const seen = new Set<string>()
    const ordered = [...records].sort(
      (a, b) => a.createdAtMs - b.createdAtMs || (a.correctionId < b.correctionId ? -1 : a.correctionId > b.correctionId ? 1 : 0),
    )
    for (const record of ordered) {
      const supersedes = record.supersedesCorrectionId
      if (supersedes !== undefined && !seen.has(supersedes)) {
        throw new Error(
          `correction ${record.correctionId} supersedes unknown or out-of-order correction ${supersedes}`,
        )
      }
      seen.add(record.correctionId)
    }
    lineage.set(originalEntryId, { originalEntryId, chain: ordered })
  }
  return lineage
}

export function latestCorrection(lineage: CorrectionLineage | undefined): CorrectionRecord | undefined {
  const chain = lineage?.chain
  if (!chain || chain.length === 0) return undefined
  return chain[chain.length - 1]
}
