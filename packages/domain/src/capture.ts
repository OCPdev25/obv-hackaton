/**
 * Capture slice — the state machine as executable schemas (Foldkit R1/R2).
 *
 * States: Idle / Recording / Transcribed / Extracting / Review / Published.
 * In candidate D the "Recording" state is the synthetic-transcript composer
 * (text entry stands in for audio; dictation findings art_tXjksHOh cover the
 * later native path). `rawTranscript` is carried unchanged through every
 * post-transcription state so validation failures never lose raw input.
 *
 * Every message is a fact named in past/present tense; `captureId` is carried
 * on every post-start message and guarded in the reducer so stale results
 * from a previous capture can never mutate a newer one.
 */
import { Schema } from "effect"

import { Event } from "./entry.js"
import { CaptureId, ChildId, CaregiverId, EntryId } from "./ids.js"

export const Idle = Schema.TaggedStruct("Idle", {})
export type Idle = Schema.Schema.Type<typeof Idle>

export const Recording = Schema.TaggedStruct("Recording", {
  captureId: CaptureId,
  childId: ChildId,
  authorId: CaregiverId,
})
export type Recording = Schema.Schema.Type<typeof Recording>

export const Transcribed = Schema.TaggedStruct("Transcribed", {
  captureId: CaptureId,
  childId: ChildId,
  authorId: CaregiverId,
  rawTranscript: Schema.NonEmptyString,
})
export type Transcribed = Schema.Schema.Type<typeof Transcribed>

export const Extracting = Schema.TaggedStruct("Extracting", {
  captureId: CaptureId,
  childId: ChildId,
  authorId: CaregiverId,
  rawTranscript: Schema.NonEmptyString,
})
export type Extracting = Schema.Schema.Type<typeof Extracting>

export const Review = Schema.TaggedStruct("Review", {
  captureId: CaptureId,
  childId: ChildId,
  authorId: CaregiverId,
  rawTranscript: Schema.NonEmptyString,
  events: Schema.Array(Event),
})
export type Review = Schema.Schema.Type<typeof Review>

export const Published = Schema.TaggedStruct("Published", {
  captureId: CaptureId,
  entryId: EntryId,
})
export type Published = Schema.Schema.Type<typeof Published>

export const CaptureState = Schema.Union([
  Idle,
  Recording,
  Transcribed,
  Extracting,
  Review,
  Published,
])
export type CaptureState = Schema.Schema.Type<typeof CaptureState>

/** Tagged message union — every fact that can change the capture state. */
export const CaptureStarted = Schema.TaggedStruct("CaptureStarted", {
  captureId: CaptureId,
  childId: ChildId,
  authorId: CaregiverId,
})
export const CompletedTranscription = Schema.TaggedStruct("CompletedTranscription", {
  captureId: CaptureId,
  transcript: Schema.NonEmptyString,
})
export const SubmittedForExtraction = Schema.TaggedStruct("SubmittedForExtraction", {
  captureId: CaptureId,
})
export const SucceededExtraction = Schema.TaggedStruct("SucceededExtraction", {
  captureId: CaptureId,
  events: Schema.Array(Event),
})
export const FailedExtraction = Schema.TaggedStruct("FailedExtraction", {
  captureId: CaptureId,
  reason: Schema.String,
})
export const ConfirmedReview = Schema.TaggedStruct("ConfirmedReview", {
  captureId: CaptureId,
  at: Schema.DateFromMillis,
})
export const PublishedEntry = Schema.TaggedStruct("PublishedEntry", {
  captureId: CaptureId,
  entryId: EntryId,
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
  ConfirmedReview,
  PublishedEntry,
  FailedPublish,
  CancelledCapture,
])
export type CaptureMessage = Schema.Schema.Type<typeof CaptureMessage>
