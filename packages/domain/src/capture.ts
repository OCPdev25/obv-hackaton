import { Schema } from 'effect'
import { CaptureId, EntryId, CaregiverId, ChildId } from './ids.js'
import { Event, type Entry } from './schema.js'

/**
 * Capture state machine (Foldkit patterns, art_TPkABBrX):
 * - the model is an executable schema (inspectable at runtime),
 * - messages are facts, tagged,
 * - `update` is pure: `(state, message) => [nextState, commands]`,
 * - commands are named effectful operations executed by the runtime, whose
 *   result messages loop back into `update`.
 *
 * All timestamps ride in messages — `update` never reads a clock, so it is
 * deterministic given its inputs.
 */

/** Serializable failure info carried by failed result messages and state. */
export const CaptureErrorInfo = Schema.Struct({
  code: Schema.Literals(['extraction_failed', 'publish_failed', 'persist_failed']),
  detail: Schema.String,
})
export type CaptureErrorInfo = Schema.Schema.Type<typeof CaptureErrorInfo>

/** Capture state — tagged union covering the six phases from the brief. */
export const CaptureState = Schema.Union([
  Schema.TaggedStruct('Idle', {}),
  Schema.TaggedStruct('Recording', { captureId: CaptureId, startedAt: Schema.DateFromMillis }),
  Schema.TaggedStruct('Transcribed', {
    captureId: CaptureId,
    transcript: Schema.NonEmptyString,
    capturedAt: Schema.DateFromMillis,
    lastError: Schema.optionalKey(CaptureErrorInfo),
  }),
  Schema.TaggedStruct('Extracting', {
    captureId: CaptureId,
    transcript: Schema.NonEmptyString,
    capturedAt: Schema.DateFromMillis,
  }),
  Schema.TaggedStruct('Review', {
    captureId: CaptureId,
    transcript: Schema.NonEmptyString,
    capturedAt: Schema.DateFromMillis,
    events: Schema.Array(Event),
    publishing: Schema.optionalKey(Schema.Boolean),
    lastError: Schema.optionalKey(CaptureErrorInfo),
  }),
  Schema.TaggedStruct('Published', { captureId: CaptureId, entryId: EntryId, transcript: Schema.NonEmptyString }),
])
export type CaptureState = Schema.Schema.Type<typeof CaptureState>

/** Every fact that can cause a state change in the capture flow. */
export const CaptureMessage = Schema.Union([
  Schema.TaggedStruct('PressedRecord', { captureId: CaptureId, at: Schema.DateFromMillis }),
  Schema.TaggedStruct('StoppedRecording', { transcript: Schema.NonEmptyString, at: Schema.DateFromMillis }),
  // Synthetic-text path: caregiver types the transcript instead of dictating.
  Schema.TaggedStruct('TextCaptured', { captureId: CaptureId, transcript: Schema.NonEmptyString, at: Schema.DateFromMillis }),
  Schema.TaggedStruct('SubmittedForExtraction', {}),
  Schema.TaggedStruct('SucceededExtraction', { events: Schema.Array(Event) }),
  Schema.TaggedStruct('FailedExtraction', { error: CaptureErrorInfo }),
  Schema.TaggedStruct('RetryPersistRaw', {}),
  Schema.TaggedStruct('SucceededPersistRaw', {}),
  Schema.TaggedStruct('FailedPersistRaw', { error: CaptureErrorInfo }),
  Schema.TaggedStruct('ConfirmedReview', {}),
  Schema.TaggedStruct('SucceededPublish', { entryId: EntryId }),
  Schema.TaggedStruct('FailedPublish', { error: CaptureErrorInfo }),
  Schema.TaggedStruct('CancelledCapture', {}),
])
export type CaptureMessage = Schema.Schema.Type<typeof CaptureMessage>

/** Household context fixed for the lifetime of one capture machine. */
export interface CaptureSession {
  readonly childId: ChildId
  readonly authorId: CaregiverId
}

/**
 * Named effectful commands — data descriptions of side effects. Executed by
 * the runtime (packages/core), never inside `update`.
 */
export type CaptureCommand =
  | { readonly _tag: 'PersistRawCapture'; readonly entry: Entry }
  | {
      readonly _tag: 'ExtractEvents'
      readonly captureId: CaptureId
      readonly transcript: string
      readonly authorId: CaregiverId
      readonly capturedAt: Date
    }
  | { readonly _tag: 'PublishEntry'; readonly captureId: CaptureId; readonly events: ReadonlyArray<Event> }

export type CaptureUpdate = readonly [CaptureState, ReadonlyArray<CaptureCommand>]

const none: ReadonlyArray<CaptureCommand> = []

const draftEntry = (session: CaptureSession, captureId: CaptureId, transcript: string, at: Date): Entry => ({
  _tag: 'Entry',
  captureId,
  childId: session.childId,
  transcript,
  authorId: session.authorId,
  createdAt: at,
  status: 'draft',
  events: [],
})

/**
 * Pure update, instantiated per session so household context does not leak
 * into messages. Deterministic: same (state, message) => same [state, commands].
 */
export const makeCaptureUpdate =
  (session: CaptureSession) =>
  (state: CaptureState, message: CaptureMessage): CaptureUpdate => {
    switch (message._tag) {
      case 'PressedRecord':
        return state._tag === 'Idle'
          ? [{ _tag: 'Recording', captureId: message.captureId, startedAt: message.at }, none]
          : [state, none]

      case 'StoppedRecording': {
        if (state._tag !== 'Recording') return [state, none]
        return [
          { _tag: 'Transcribed', captureId: state.captureId, transcript: message.transcript, capturedAt: message.at },
          [{ _tag: 'PersistRawCapture', entry: draftEntry(session, state.captureId, message.transcript, message.at) }],
        ]
      }

      case 'TextCaptured': {
        if (state._tag !== 'Idle') return [state, none]
        return [
          { _tag: 'Transcribed', captureId: message.captureId, transcript: message.transcript, capturedAt: message.at },
          [{ _tag: 'PersistRawCapture', entry: draftEntry(session, message.captureId, message.transcript, message.at) }],
        ]
      }

      case 'SubmittedForExtraction':
        return state._tag === 'Transcribed'
          ? [
              { _tag: 'Extracting', captureId: state.captureId, transcript: state.transcript, capturedAt: state.capturedAt },
              [
                {
                  _tag: 'ExtractEvents',
                  captureId: state.captureId,
                  transcript: state.transcript,
                  authorId: session.authorId,
                  capturedAt: state.capturedAt,
                },
              ],
            ]
          : [state, none]

      case 'SucceededExtraction':
        return state._tag === 'Extracting'
          ? [
              {
                _tag: 'Review',
                captureId: state.captureId,
                transcript: state.transcript,
                capturedAt: state.capturedAt,
                events: [...message.events],
              },
              none,
            ]
          : [state, none]

      // Raw input is never lost: fall back to Transcribed with the error
      // recorded; the user retries without re-entering anything.
      case 'FailedExtraction':
        return state._tag === 'Extracting'
          ? [
              {
                _tag: 'Transcribed',
                captureId: state.captureId,
                transcript: state.transcript,
                capturedAt: state.capturedAt,
                lastError: { code: 'extraction_failed', detail: message.error.detail },
              },
              none,
            ]
          : [state, none]

      case 'ConfirmedReview': {
        if (state._tag !== 'Review' || state.publishing === true) return [state, none]
        return [{ ...state, publishing: true }, [{ _tag: 'PublishEntry', captureId: state.captureId, events: [...state.events] }]]
      }

      case 'SucceededPublish':
        return state._tag === 'Review'
          ? [{ _tag: 'Published', captureId: state.captureId, entryId: message.entryId, transcript: state.transcript }, none]
          : [state, none]

      // Publish failure keeps Review (raw + events intact); retry re-runs
      // publish under the same captureId (idempotent server-side).
      case 'FailedPublish':
        return state._tag === 'Review'
          ? [{ ...state, publishing: false, lastError: { code: 'publish_failed', detail: message.error.detail } }, none]
          : [state, none]

      case 'SucceededPersistRaw':
        // A recovered persist resolves the recorded failure.
        return state._tag === 'Transcribed' ? [{ ...state, lastError: undefined }, none] : [state, none]

      case 'FailedPersistRaw':
        return state._tag === 'Transcribed'
          ? [{ ...state, lastError: { code: 'persist_failed', detail: message.error.detail } }, none]
          : [state, none]

      case 'RetryPersistRaw': {
        if (state._tag !== 'Transcribed') return [state, none]
        return [state, [{ _tag: 'PersistRawCapture', entry: draftEntry(session, state.captureId, state.transcript, state.capturedAt) }]]
      }

      case 'CancelledCapture':
        return state._tag === 'Idle' || state._tag === 'Published' ? [state, none] : [{ _tag: 'Idle' }, none]

      default: {
        const exhaustive: never = message
        void exhaustive
        return [state, none]
      }
    }
  }
