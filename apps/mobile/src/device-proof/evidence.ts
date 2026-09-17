/**
 * Evidence-row model for the DeviceProof harness.
 *
 * Every check the harness runs appends timestamped rows to the on-screen log.
 * Each row carries a class label that tells the reviewer what kind of evidence
 * it is:
 *
 * - `simulator`               — mechanically verifiable on an iOS simulator /
 *                               any runtime that binds the adapters
 * - `fake`                    — produced by a deterministic in-memory double
 * - `hardware-only-blocked`   — requires real hardware (iOS 26 device /
 *                               dev-client build); the row records the blocked
 *                               state honestly instead of a fake pass
 *
 * No credentials ever flow into a row: the Convex URL is never printed, only
 * whether the real or fake transport was selected.
 */

export type EvidenceClass = 'simulator' | 'fake' | 'hardware-only-blocked'

export type EvidenceStatus = 'pass' | 'fail' | 'skipped' | 'info'

export interface EvidenceEntry {
  readonly label: string
  readonly status: EvidenceStatus
  readonly evidenceClass: EvidenceClass
  readonly detail: string
}

export interface EvidenceRow extends EvidenceEntry {
  readonly id: number
  readonly at: string
}

/** Callback the checks use to append one evidence entry. */
export type EvidenceLog = (entry: EvidenceEntry) => void

/** Pure row constructor: a log entry plus its identity and clock stamp. */
export function toRow(entry: EvidenceEntry, id: number, at: string): EvidenceRow {
  return { ...entry, id, at }
}

/** Next monotonically increasing id for a newest-first row list. */
export function nextRowId(rows: readonly EvidenceRow[]): number {
  return (rows[0]?.id ?? 0) + 1
}

/** Normalize any thrown value into a one-line string for evidence display. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause === undefined ? '' : ` (cause: ${describeError(error.cause)})`
    return `${error.name}: ${error.message}${cause}`
  }
  return String(error)
}
