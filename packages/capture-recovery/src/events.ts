import { Schema } from "effect"
import { ExtractionAttempt } from "@journal/domain"

import { FailureReason } from "./state.js"

/**
 * Recovery event vocabulary. Interruption, backgrounding, network loss and
 * duplicate submission are EVENTS, not states: the machine's persisted state
 * is always sufficient to resume, so no recovery-specific phase is needed.
 *
 * Timestamps come from events only — the reducer is deterministic and never
 * reads the clock, so fixtures replay identically anywhere.
 */
export const InterruptionKind = Schema.Literals(["call", "app-switch", "background", "process-death"])
export type InterruptionKind = typeof InterruptionKind["Type"]

/** Extraction outcome as returned by the canonical pipeline (never "pending"). */
export const ExtractionOutcome = Schema.Literals(["structured", "failed"])
export type ExtractionOutcome = typeof ExtractionOutcome["Type"]

export const TranscriptChanged = Schema.TaggedStruct("TranscriptChanged", {
  at: Schema.Number,
  text: Schema.String,
})

export const Interrupted = Schema.TaggedStruct("Interrupted", {
  at: Schema.Number,
  kind: InterruptionKind,
})

export const Resumed = Schema.TaggedStruct("Resumed", {
  at: Schema.Number,
})

export const SubmitRequested = Schema.TaggedStruct("SubmitRequested", {
  at: Schema.Number,
  submissionId: Schema.NonEmptyString,
})

export const RetryRequested = Schema.TaggedStruct("RetryRequested", {
  at: Schema.Number,
})

export const SubmitAccepted = Schema.TaggedStruct("SubmitAccepted", {
  at: Schema.Number,
})

export const SubmitRejected = Schema.TaggedStruct("SubmitRejected", {
  at: Schema.Number,
  attempt: ExtractionAttempt,
  reason: FailureReason,
})

/** Decoded extraction result for (captureId, attempt) — latest-attempt-only. */
export const ExtractionResultArrived = Schema.TaggedStruct("ExtractionResultArrived", {
  at: Schema.Number,
  attempt: ExtractionAttempt,
  outcome: ExtractionOutcome,
})

export const NetworkLost = Schema.TaggedStruct("NetworkLost", {
  at: Schema.Number,
})

export const NetworkRestored = Schema.TaggedStruct("NetworkRestored", {
  at: Schema.Number,
})

export const DiscardRequested = Schema.TaggedStruct("DiscardRequested", {
  at: Schema.Number,
})

export const CaptureEvent = Schema.Union([
  TranscriptChanged,
  Interrupted,
  Resumed,
  SubmitRequested,
  RetryRequested,
  SubmitAccepted,
  SubmitRejected,
  ExtractionResultArrived,
  NetworkLost,
  NetworkRestored,
  DiscardRequested,
])
export type CaptureEvent = typeof CaptureEvent["Type"]
