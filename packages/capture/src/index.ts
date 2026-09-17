// Capture pipeline — public surface. Decision points are the pure reducer;
// services are plain interfaces (DI by object), runtime is the only side-effectful glue.
export {
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
  CaptureMessage,
  CaptureState,
} from "./state.js"
export type { Idle, Recording, Transcribed, Extracting, Review, Published, RawPersistFailed } from "./state.js"
export type { CaptureCommand, CommandName } from "./commands.js"
export { update, type UpdateResult } from "./update.js"
export { executeCommand, makeCaptureLoop, type CaptureServices, type CaptureLoop } from "./runtime.js"
export { CapturedEventSchema, CapturedEntrySchema, EntryStatus } from "./event.js"
export type { CapturedEvent, CapturedEntry } from "./event.js"
export { zoneOffsetMs, wallToUtc, captureWallDate, to24h, resolveOccurredAt, type RelativeTimeInput } from "./services/relativeTime.js"
export {
  makeDeterministicExtractor,
  type ExtractionServiceShape,
  type ExtractionInput,
  type ExtractionError,
} from "./services/extraction.js"
export { makeInMemoryEntryStore, type EntryStoreShape, type StoreError, type DraftInput } from "./services/entries.js"
export { toCanonicalEvent, fromCanonicalEvent, type EncodedCaptureEvent, type EncodedCanonicalEvent } from "./wire.js"
export { createIntegratedAdapter, CORPUS_CHILD_ID } from "./evaluation-adapter.js"
