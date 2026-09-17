import { Schema } from "effect"
import { CaptureId } from "./ids.ts"
import { JournalEvent } from "./events.ts"

/**
 * The capture state machine, in the Foldkit pattern: the whole model is a
 * schema (inspectable at runtime), messages are tagged facts, `update` is a
 * pure function returning `[nextState, commands]`, and every effectful step
 * is a named command executed by the runtime — never inside `update`.
 *
 * Dictation is SYNTHETIC in this slice: typed text stands in for the speech
 * transcript ("Recording" is the mic-open state; the typed text stands in for
 * the transcript). Native Speech-framework capture replaces the text input
 * without touching the machine.
 */

export const CaptureState = Schema.TaggedUnion({
  Idle: {},
  Recording: { startedAt: Schema.Number },
  Transcribed: {
    captureId: CaptureId,
    rawText: Schema.String,
    occurredAt: Schema.Number,
    error: Schema.optionalKey(Schema.String),
  },
  Extracting: { captureId: CaptureId, rawText: Schema.String, occurredAt: Schema.Number },
  Review: {
    captureId: CaptureId,
    rawText: Schema.String,
    occurredAt: Schema.Number,
    event: Schema.optionalKey(JournalEvent),
    error: Schema.optionalKey(Schema.String),
  },
  Published: {
    captureId: CaptureId,
    rawText: Schema.String,
    occurredAt: Schema.Number,
    // An entry may publish raw-only when extraction failed — the blueprint
    // invariant: extraction enriches the record but never gates it.
    event: Schema.optionalKey(JournalEvent),
    entryId: Schema.String,
    publishedAt: Schema.Number,
  },
})
export type CaptureState = typeof CaptureState.Type

export const CaptureMessage = Schema.TaggedUnion({
  StartRecording: {},
  // Dictation ends: the runtime generates captureId + timestamp so update stays pure.
  StopRecording: { rawText: Schema.String, captureId: CaptureId, occurredAt: Schema.Number },
  // UI auto-dispatches right after Transcribed lands.
  ExtractionRequested: {},
  ExtractionSucceeded: { event: JournalEvent },
  ExtractionFailed: { reason: Schema.String },
  EventEdited: { event: JournalEvent },
  PublishRequested: {},
  PublishSucceeded: { entryId: Schema.String, publishedAt: Schema.Number },
  PublishFailed: { reason: Schema.String },
  PersistCaptureFailed: { reason: Schema.String },
  Reset: {},
})
export type CaptureMessage = typeof CaptureMessage.Type

export const CaptureCommand = Schema.TaggedUnion({
  PersistCaptureRaw: {
    captureId: CaptureId,
    rawText: Schema.String,
    childId: Schema.String,
    authorCaregiverId: Schema.String,
    occurredAt: Schema.Number,
  },
  Extract: {
    captureId: CaptureId,
    rawText: Schema.String,
    occurredAt: Schema.Number,
  },
  PublishEvent: {
    captureId: CaptureId,
    event: JournalEvent,
  },
  PublishRawOnly: {
    captureId: CaptureId,
  },
})
export type CaptureCommand = typeof CaptureCommand.Type

export interface CaptureContext {
  readonly childId: string
  readonly authorCaregiverId: string
}

type Transcribed = Extract<CaptureState, { _tag: "Transcribed" }>
type Extracting = Extract<CaptureState, { _tag: "Extracting" }>
type Review = Extract<CaptureState, { _tag: "Review" }>

type ReviewBase = {
  readonly _tag: string
  readonly captureId: CaptureId
  readonly rawText: string
  readonly occurredAt: number
  readonly event?: JournalEvent
}

const reviewState = (
  base: ReviewBase,
  patch: { readonly event?: JournalEvent; readonly error?: string }
): CaptureState => {
  // patch.event wins (EventEdited), otherwise an existing Review event is
  // preserved (PublishFailed must not lose the event it failed to publish).
  const event = patch.event !== undefined ? patch.event : base.event
  return {
    _tag: "Review",
    captureId: base.captureId,
    rawText: base.rawText,
    occurredAt: base.occurredAt,
    ...(event !== undefined ? { event } : {}),
    ...(patch.error !== undefined ? { error: patch.error } : {}),
  }
}

const transcribedState = (
  base: { readonly captureId: CaptureId; readonly rawText: string; readonly occurredAt: number },
  error?: string
): CaptureState => ({
  _tag: "Transcribed",
  captureId: base.captureId,
  rawText: base.rawText,
  occurredAt: base.occurredAt,
  ...(error !== undefined ? { error } : {}),
})

/**
 * Pure update: `(state, message, context) => [state, commands]`. Deterministic,
 * total (unmatched message/state pairs are ignored, never throw), and free of
 * I/O — all effectful work is expressed as returned commands.
 */
export const update = (
  state: CaptureState,
  message: CaptureMessage,
  context: CaptureContext
): readonly [CaptureState, readonly CaptureCommand[]] => {
  switch (message._tag) {
    case "StartRecording": {
      if (state._tag !== "Idle") return [state, []]
      // startedAt is runtime-supplied; 0 marks "not tracked by the machine".
      return [{ _tag: "Recording", startedAt: 0 }, []] as const
    }
    case "StopRecording": {
      if (state._tag !== "Recording") return [state, []]
      const next = transcribedState(
        { captureId: message.captureId, rawText: message.rawText, occurredAt: message.occurredAt }
      )
      return [
        next,
        [
          {
            _tag: "PersistCaptureRaw",
            captureId: message.captureId,
            rawText: message.rawText,
            childId: context.childId,
            authorCaregiverId: context.authorCaregiverId,
            occurredAt: message.occurredAt,
          },
        ],
      ] as const
    }
    case "ExtractionRequested": {
      if (state._tag !== "Transcribed") return [state, []]
      return [
        { _tag: "Extracting", captureId: state.captureId, rawText: state.rawText, occurredAt: state.occurredAt },
        [{ _tag: "Extract", captureId: state.captureId, rawText: state.rawText, occurredAt: state.occurredAt }],
      ] as const
    }
    case "ExtractionSucceeded": {
      if (state._tag !== "Extracting") return [state, []]
      return [reviewState(state, { event: message.event }), []] as const
    }
    case "ExtractionFailed": {
      if (state._tag !== "Extracting") return [state, []]
      // Raw note is still publishable — extraction never gates capture.
      return [reviewState(state, { error: message.reason }), []] as const
    }
    case "EventEdited": {
      if (state._tag !== "Review") return [state, []]
      return [reviewState(state, { event: message.event }), []] as const
    }
    case "PublishRequested": {
      if (state._tag !== "Review") return [state, []]
      const command: CaptureCommand =
        state.event !== undefined
          ? { _tag: "PublishEvent", captureId: state.captureId, event: state.event }
          : { _tag: "PublishRawOnly", captureId: state.captureId }
      return [state, [command]] as const
    }
    case "PublishSucceeded": {
      if (state._tag !== "Review") return [state, []]
      return [
        {
          _tag: "Published",
          captureId: state.captureId,
          rawText: state.rawText,
          occurredAt: state.occurredAt,
          ...(state.event !== undefined ? { event: state.event } : {}),
          entryId: message.entryId,
          publishedAt: message.publishedAt,
        },
        [],
      ] as const
    }
    case "PublishFailed": {
      if (state._tag !== "Review") return [state, []]
      // Raw input stays intact — retry uses the same captureId (idempotent).
      return [reviewState(state, { error: message.reason }), []] as const
    }
    case "PersistCaptureFailed": {
      if (state._tag !== "Transcribed") return [state, []]
      return [transcribedState(state, message.reason), []] as const
    }
    case "Reset": {
      if (state._tag !== "Published") return [state, []]
      return [{ _tag: "Idle" }, []] as const
    }
    default:
      return [state, []]
  }
}
