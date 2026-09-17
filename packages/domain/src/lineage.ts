import { Schema } from "effect"
import { convexId } from "./ids.js"
import { AttemptNumber, CaptureId } from "./extraction.js"
import { ExtractionStatus } from "./entry.js"

/**
 * Extraction lineage (contract v0.3 — art_rBKvvzIa §3–4). Every extraction
 * run over a capture's raw input is an append-only attempt record; events
 * produced by a run point back at it via `Event.producedBy`. Reruns supersede
 * rather than mutate: the latest successful attempt defines an entry's
 * current events, and prior attempts stay fully inspectable — the attempt
 * history doubles as the audit trail (`triggeredBy` records who asked).
 */

/** Why an attempt was started. Operator reruns and edit-reparses are auditable. */
export const AttemptTrigger = Schema.Literals(["original", "operator_rerun", "edit_reparse"])
export type AttemptTrigger = typeof AttemptTrigger["Type"]

/**
 * Failure payload for a failed attempt, pinned to the contract v0.2 pipeline
 * error taxonomy (adaptation A9 — no new names invented; the operator
 * failures view maps these plus capture-side categories to display rows).
 */
export const AttemptFailure = Schema.Struct({
  error: Schema.Literals(["ProviderFailure", "MalformedModelOutput", "EventsFailedSchema"]),
  message: Schema.NonEmptyString,
})
export type AttemptFailure = typeof AttemptFailure["Type"]

export const ExtractionAttemptFields = {
  householdId: convexId("households"),
  captureId: CaptureId,
  attempt: AttemptNumber,
  startedAt: Schema.Number,
  /** Absent while the attempt is still running. */
  finishedAt: Schema.optionalKey(Schema.Number),
  extractorVersion: Schema.NonEmptyString,
  schemaVersion: Schema.NonEmptyString,
  model: Schema.optionalKey(Schema.NonEmptyString),
  triggeredBy: AttemptTrigger,
  /** SHA-256 over the exact bytes fed to the extractor (envelope bytes once the envelope lands). */
  inputHash: Schema.NonEmptyString,
  /**
   * Absent while running (the proposal's own "finishedAt optional while
   * running" requires it — adaptation A7); a running latest attempt reads
   * as `pending` in the derivation below.
   */
  outcome: Schema.optionalKey(Schema.Literals(["succeeded", "failed"])),
  failure: Schema.optionalKey(AttemptFailure),
} satisfies Schema.Struct.Fields

/** One extraction run over one capture's raw input (append-only). */
export const ExtractionAttempt = Schema.Struct(ExtractionAttemptFields)
export type ExtractionAttempt = typeof ExtractionAttempt["Type"]

/** Attempt table view plus Convex system fields (the `extraction_attempts` table). */
export const ExtractionAttemptDocumentFields = {
  ...ExtractionAttemptFields,
  _id: convexId("extraction_attempts"),
  _creationTime: Schema.Number,
} satisfies Schema.Struct.Fields
export const ExtractionAttemptDocument = Schema.Struct(ExtractionAttemptDocumentFields)
export type ExtractionAttemptDocument = typeof ExtractionAttemptDocument["Type"]

/**
 * Derived extraction status (art_rBKvvzIa §4) — the attempt record is the
 * source of truth: no attempt => pending; latest attempt succeeded =>
 * structured; latest attempt failed => failed. `Entry.extractionStatus`
 * remains the materialized read-model of exactly this derivation; the
 * attempt pipeline reconciles it on append (v0.3 adaptation A6).
 */
export const deriveExtractionStatus = (
  latest: Pick<ExtractionAttempt, "outcome"> | undefined
): ExtractionStatus => {
  if (latest === undefined || latest.outcome === undefined) return "pending"
  return latest.outcome === "succeeded" ? "structured" : "failed"
}
