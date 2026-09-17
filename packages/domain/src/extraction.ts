import { Schema } from "effect"
import { EventFields } from "./event.js"

/**
 * Extraction envelope — part of the canonical contract (art_I2TCG08V v0.2).
 * Requests AND results carry { captureId, attempt }; `attempt` is monotonic
 * per capture, starting at 0. `captureId` is a client-side capture session
 * identifier (the flat four-table model has no captures table to reference).
 *
 * Required semantics, enforced by the pipeline that consumes this envelope:
 * (a) client interruption does NOT cancel a running server extraction — it
 *     completes server-side;
 * (b) stale-result suppression — a result applies only if it is the LATEST
 *     attempt for that captureId; superseded attempts are discarded, never
 *     merged;
 * (c) idempotent completion — applying the same (captureId, attempt) twice is
 *     a no-op.
 */
export const CaptureId = Schema.NonEmptyString
export type CaptureId = typeof CaptureId["Type"]

/** Monotonic per-capture attempt counter, starting at 0. */
export const ExtractionAttempt = Schema.Int
export type ExtractionAttempt = typeof ExtractionAttempt["Type"]

export const ExtractionRequest = Schema.Struct({
  captureId: CaptureId,
  attempt: ExtractionAttempt,
  transcript: Schema.NonEmptyString,
})
export type ExtractionRequest = typeof ExtractionRequest["Type"]

export const ExtractionResult = Schema.Struct({
  captureId: CaptureId,
  attempt: ExtractionAttempt,
  events: Schema.Array(Schema.Struct(EventFields)),
})
export type ExtractionResult = typeof ExtractionResult["Type"]
