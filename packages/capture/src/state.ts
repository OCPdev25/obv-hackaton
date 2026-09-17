/**
 * Capture slice — the state machine as executable schemas (Foldkit R1/R2).
 * Base skeleton: candidate D's machine; grafted: the `RawPersistFailed` park
 * (candidate A's explicit failure-park modeling) and the messages that drive
 * raw-first draft persistence (candidate C's design).
 *
 * States: Idle / Recording / Transcribed / Extracting / Review / Published /
 * RawPersistFailed. The "Recording" state is the synthetic-transcript composer
 * (text entry stands in for audio; dictation findings art_tXjksHOh cover the
 * later native path). `rawTranscript` is carried unchanged through every
 * post-transcription state so failures never lose raw input, and the raw text
 * is durably persisted as a draft entry at the moment transcription completes.
 *
 * Every message is a fact named in past/present tense; `captureId` is carried
 * on every post-start message and guarded in the reducer so stale results
 * from a previous capture can never mutate a newer one.
 */
import { Schema } from "effect"

import { CaptureId } from "@journal/domain"

import { CapturedEventSchema } from "./event.js"

export const Idle = Schema.TaggedStruct("Idle", {})
export type Idle = Schema.Schema.Type<typeof Idle>

export const Recording = Schema.TaggedStruct("Recording", {
  captureId: CaptureId,
  childId: Schema.NonEmptyString,
  authorId: Schema.NonEmptyString,
})
export type Recording = Schema.Schema.Type<typeof Recording>

export const Transcribed = Schema.TaggedStruct("Transcribed", {
  captureId: CaptureId,
  childId: Schema.NonEmptyString,
  authorId: Schema.NonEmptyString,
  rawTranscript: Schema.NonEmptyString,
  /** Capture instant (Unix ms) — the draft's `createdAt`, never process time. */
  capturedAt: Schema.Number,
  /** IANA zone for relative-time resolution during extraction. */
  timezone: Schema.String,
})
export type Transcribed = Schema.Schema.Type<typeof Transcribed>

export const Extracting = Schema.TaggedStruct("Extracting", {
  captureId: CaptureId,
  childId: Schema.NonEmptyString,
  authorId: Schema.NonEmptyString,
  rawTranscript: Schema.NonEmptyString,
  capturedAt: Schema.Number,
  timezone: Schema.String,
})
export type Extracting = Schema.Schema.Type<typeof Extracting>

export const Review = Schema.TaggedStruct("Review", {
  captureId: CaptureId,
  childId: Schema.NonEmptyString,
  authorId: Schema.NonEmptyString,
  rawTranscript: Schema.NonEmptyString,
  capturedAt: Schema.Number,
  timezone: Schema.String,
  events: Schema.Array(CapturedEventSchema),
})
export type Review = Schema.Schema.Type<typeof Review>

export const Published = Schema.TaggedStruct("Published", {
  captureId: CaptureId,
  entryId: Schema.NonEmptyString,
})
export type Published = Schema.Schema.Type<typeof Published>

/**
 * Failure park (grafted from candidate A): raw-draft persistence failed, so
 * the machine parks instead of proceeding to extraction — nothing downstream
 * may exist without the durable raw draft (raw-before-events). Raw input is
 * preserved in-state; `RetryPersistRaw` re-issues the persist command.
 */
export const RawPersistFailed = Schema.TaggedStruct("RawPersistFailed", {
  captureId: CaptureId,
  childId: Schema.NonEmptyString,
  authorId: Schema.NonEmptyString,
  rawTranscript: Schema.NonEmptyString,
  capturedAt: Schema.Number,
  timezone: Schema.String,
  reason: Schema.String,
})
export type RawPersistFailed = Schema.Schema.Type<typeof RawPersistFailed>

export const CaptureState = Schema.Union([
  Idle,
  Recording,
  Transcribed,
  Extracting,
  Review,
  Published,
  RawPersistFailed,
])
export type CaptureState = Schema.Schema.Type<typeof CaptureState>

/** Tagged message union — every fact that can change the capture state. */
export const CaptureStarted = Schema.TaggedStruct("CaptureStarted", {
  captureId: CaptureId,
  childId: Schema.NonEmptyString,
  authorId: Schema.NonEmptyString,
})
export const CompletedTranscription = Schema.TaggedStruct("CompletedTranscription", {
  captureId: CaptureId,
  transcript: Schema.NonEmptyString,
  /** Capture instant (Unix ms) — resolves relative expressions and createdAt. */
  at: Schema.Number,
  timezone: Schema.String,
})
export const SubmittedForExtraction = Schema.TaggedStruct("SubmittedForExtraction", {
  captureId: CaptureId,
})
export const SucceededExtraction = Schema.TaggedStruct("SucceededExtraction", {
  captureId: CaptureId,
  events: Schema.Array(CapturedEventSchema),
})
export const FailedExtraction = Schema.TaggedStruct("FailedExtraction", {
  captureId: CaptureId,
  reason: Schema.String,
})
/** Raw draft persisted durably; no visible state change, the store owns the row. */
export const RawDraftPersisted = Schema.TaggedStruct("RawDraftPersisted", {
  captureId: CaptureId,
  entryId: Schema.NonEmptyString,
})
export const RawDraftPersistFailed = Schema.TaggedStruct("RawDraftPersistFailed", {
  captureId: CaptureId,
  reason: Schema.String,
})
/** Re-issue the raw-draft persist after a park (candidate C's RetryPersistRaw). */
export const RetryPersistRaw = Schema.TaggedStruct("RetryPersistRaw", {
  captureId: CaptureId,
})
/** Durable attach of extracted events confirmed (draft now carries events). */
export const EventsAttached = Schema.TaggedStruct("EventsAttached", {
  captureId: CaptureId,
})
export const ConfirmedReview = Schema.TaggedStruct("ConfirmedReview", {
  captureId: CaptureId,
  at: Schema.DateFromMillis,
})
export const PublishedEntry = Schema.TaggedStruct("PublishedEntry", {
  captureId: CaptureId,
  entryId: Schema.NonEmptyString,
})
export const FailedPublish = Schema.TaggedStruct("FailedPublish", {
  captureId: CaptureId,
  reason: Schema.String,
})
export const CancelledCapture = Schema.TaggedStruct("CancelledCapture", {
  captureId: CaptureId,
})

export const CaptureMessage = Schema.Union([
  CaptureStarted,
  CompletedTranscription,
  SubmittedForExtraction,
  SucceededExtraction,
  FailedExtraction,
  RawDraftPersisted,
  RawDraftPersistFailed,
  RetryPersistRaw,
  EventsAttached,
  ConfirmedReview,
  PublishedEntry,
  FailedPublish,
  CancelledCapture,
])
export type CaptureMessage = Schema.Schema.Type<typeof CaptureMessage>
