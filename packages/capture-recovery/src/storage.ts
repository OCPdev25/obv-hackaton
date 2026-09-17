import { Schema } from "effect"
import { CaptureRecoveryState, type CaptureRecovery } from "./state.js"

/**
 * Persistence contract for the recovery layer. The reducer is pure; the
 * CALLER must persist after every transition (save-on-transition), so that a
 * process death at any instant loses nothing. `load` powering a cold start is
 * the recovery path exercised by the reload fixtures.
 *
 * `listUnresolved` is the background queue (drafting/pending/failed) that a
 * reconnect sweep reconciles by submissionId. Discarded captures are NOT
 * unresolved — they are receipts, listed separately to keep the
 * missing-log-vs-zero-care distinction visible.
 */
export interface CaptureStorage {
  save(state: CaptureRecovery): void | Promise<void>
  load(captureId: string): CaptureRecovery | undefined
  listUnresolved(): readonly CaptureRecovery[]
  listReceipts(): readonly CaptureRecovery[]
}

const UNRESOLVED: ReadonlySet<CaptureRecovery["phase"]> = new Set(["drafting", "pending", "failed"])

export class InMemoryCaptureStorage implements CaptureStorage {
  private readonly states = new Map<string, CaptureRecovery>()

  save(state: CaptureRecovery): void {
    this.states.set(state.captureId, state)
  }

  load(captureId: string): CaptureRecovery | undefined {
    return this.states.get(captureId)
  }

  listUnresolved(): readonly CaptureRecovery[] {
    return [...this.states.values()].filter((s) => UNRESOLVED.has(s.phase))
  }

  listReceipts(): readonly CaptureRecovery[] {
    return [...this.states.values()].filter((s) => s.phase === "discarded")
  }
}

/**
 * Fail-closed read for durable adapters: storage bytes are decoded through
 * the schema before use, so a corrupt or foreign record can never enter the
 * machine. AsyncStorage/SQLite adapters (slot 22's integration) should call
 * this on every read.
 */
export const decodeStoredState = (raw: unknown): CaptureRecovery =>
  Schema.decodeUnknownSync(CaptureRecoveryState)(raw)
