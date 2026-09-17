import { Schema } from "effect"
import { CaptureId, ExtractionAttempt, ExtractionStatus } from "@journal/domain"

/**
 * Interrupted-capture recovery state (proposal toward contract v0.3 — bounded
 * extension of art_I2TCG08V v0.2; Entry/Event/envelope schemas are NOT
 * modified here, only consumed).
 *
 * Design rules, per the recovery brief:
 * - Truthful states only. There is no optimistic "saving" or "sent" phase:
 *   `pending` means a submission is in flight and NOTHING is known about the
 *   server outcome until SubmitAccepted/SubmitRejected arrives.
 * - Raw-before-events: `rawTranscript` is preserved verbatim on every
 *   transition. The ONLY mutation that clears it is an explicit caregiver
 *   DiscardRequested, which leaves a receipt (missing-log vs zero-care rule:
 *   a discarded capture is a visible receipt, never silent absence).
 * - Attribution: `authorId` is carried on the state and survives recovery.
 * - Publication/audience stays OUT of this machine: phases describe delivery
 *   of the capture, never who may see it. Entry.visibility (draft|published)
 *   remains the only per-entry publication state (contract v0.2).
 */
export const CapturePhase = Schema.Literals(["drafting", "pending", "saved", "failed", "discarded"])
export type CapturePhase = typeof CapturePhase["Type"]

export const FailureReason = Schema.Literals(["network", "server", "unauthorized", "invalid"])
export type FailureReason = typeof FailureReason["Type"]

export const SubmissionId = Schema.NonEmptyString
export type SubmissionId = typeof SubmissionId["Type"]

export const DiscardReceipt = Schema.Struct({
  at: Schema.Number,
  transcriptLength: Schema.Int,
  attempt: ExtractionAttempt,
  submissionId: Schema.optionalKey(SubmissionId),
})
export type DiscardReceipt = typeof DiscardReceipt["Type"]

export const LastFailure = Schema.Struct({
  reason: FailureReason,
  at: Schema.Number,
})
export type LastFailure = typeof LastFailure["Type"]

export const CaptureRecoveryState = Schema.Struct({
  /** Same identifier space as the canonical extraction envelope. */
  captureId: CaptureId,
  /** Known caregiver attribution — preserved across interruptions. */
  authorId: Schema.NonEmptyString,
  /** Raw dictated text, latest revision from the speech layer, verbatim. */
  rawTranscript: Schema.String,
  phase: CapturePhase,
  /** Stable idempotency key: assigned at first submit, reused on retries. */
  submissionId: Schema.optionalKey(SubmissionId),
  /** Extraction attempt counter (canonical envelope), monotonic per capture. */
  attempt: ExtractionAttempt,
  /** Mirror of Entry.extractionStatus for pending captures. */
  extractionStatus: Schema.optionalKey(ExtractionStatus),
  lastFailure: Schema.optionalKey(LastFailure),
  /** Connectivity observation — never used to fabricate a server outcome. */
  networkLostAt: Schema.optionalKey(Schema.Number),
  /** Set when an interruption (call / app switch / background / death) lands. */
  interruptedAt: Schema.optionalKey(Schema.Number),
  duplicateSubmissionsSuppressed: Schema.optionalKey(Schema.Int),
  staleResultsSuppressed: Schema.optionalKey(Schema.Int),
  /** Bounded anomaly log for unexpected event/phase combinations. */
  anomalies: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  /** Present only after explicit discard — the receipt replaces the raw text. */
  discardedReceipt: Schema.optionalKey(DiscardReceipt),
  updatedAt: Schema.Number,
})
export type CaptureRecovery = typeof CaptureRecoveryState["Type"]
