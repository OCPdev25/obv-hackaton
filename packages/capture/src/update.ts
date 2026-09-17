/**
 * Pure update: `[nextState, commands]` (Foldkit R3). No I/O, no clock, no
 * navigation — side effects are described as commands. TypeScript exhaustively
 * checks every message; unmatched (state, message) pairs are deliberate
 * no-ops, never silent state changes.
 *
 * Stale-result guard: any message carrying a captureId that does not match the
 * active state's captureId is ignored. A validation failure returns to
 * Transcribed with `rawTranscript` intact — extraction is retryable without
 * losing raw input, and the same captureId makes the eventual publish
 * idempotent.
 */
import { Match } from "effect"

import type {
  CaptureMessage,
  CaptureState,
  Extracting,
  Recording,
  Review,
  Transcribed,
} from "@journal/domain"

import type { CaptureCommand } from "./commands.js"

const activeCaptureIdOf = (state: CaptureState): string | undefined =>
  state._tag === "Idle" ? undefined : state.captureId

/** Message applies only if it belongs to the capture the state is about. */
const isStale = (state: CaptureState, message: CaptureMessage): boolean => {
  if (!("captureId" in message)) return false
  const activeCaptureId = activeCaptureIdOf(state)
  if (activeCaptureId === undefined) return false
  return message.captureId !== activeCaptureId
}

export type UpdateResult = readonly [CaptureState, ReadonlyArray<CaptureCommand>]

export const initialCaptureState: CaptureState = { _tag: "Idle" }

const keepState = (state: CaptureState): UpdateResult => [state, []]

export const update = (state: CaptureState, message: CaptureMessage): UpdateResult => {
  if (isStale(state, message)) return keepState(state)

  return Match.value({ state, message }).pipe(
    Match.when({ state: { _tag: "Idle" }, message: { _tag: "CaptureStarted" } }, ({ message }): UpdateResult => {
      const started: Recording = {
        _tag: "Recording",
        captureId: message.captureId,
        childId: message.childId,
        authorId: message.authorId,
      }
      return [started, []]
    }),
    Match.when(
      { state: { _tag: "Recording" }, message: { _tag: "CompletedTranscription" } },
      ({ state, message }): UpdateResult => {
        const transcribed: Transcribed = {
          _tag: "Transcribed",
          captureId: state.captureId,
          childId: state.childId,
          authorId: state.authorId,
          rawTranscript: message.transcript,
        }
        return [transcribed, []]
      },
    ),
    Match.when(
      { state: { _tag: "Transcribed" }, message: { _tag: "SubmittedForExtraction" } },
      ({ state }): UpdateResult => {
        const extracting: Extracting = {
          _tag: "Extracting",
          captureId: state.captureId,
          childId: state.childId,
          authorId: state.authorId,
          rawTranscript: state.rawTranscript,
        }
        const command: CaptureCommand = {
          _tag: "ExtractEvents",
          captureId: state.captureId,
          childId: state.childId,
          authorId: state.authorId,
          transcript: state.rawTranscript,
        }
        return [extracting, [command]]
      },
    ),
    Match.when(
      { state: { _tag: "Extracting" }, message: { _tag: "SucceededExtraction" } },
      ({ state, message }): UpdateResult => {
        const review: Review = {
          _tag: "Review",
          captureId: state.captureId,
          childId: state.childId,
          authorId: state.authorId,
          rawTranscript: state.rawTranscript,
          events: message.events,
        }
        return [review, []]
      },
    ),
    Match.when(
      { state: { _tag: "Extracting" }, message: { _tag: "FailedExtraction" } },
      ({ state }): UpdateResult => {
        // Raw input survives untouched; the same captureId retries extraction.
        const transcribed: Transcribed = {
          _tag: "Transcribed",
          captureId: state.captureId,
          childId: state.childId,
          authorId: state.authorId,
          rawTranscript: state.rawTranscript,
        }
        return [transcribed, []]
      },
    ),
    Match.when(
      { state: { _tag: "Review" }, message: { _tag: "ConfirmedReview" } },
      ({ state, message }): UpdateResult => {
        // State stays Review until PublishedEntry arrives; retry on FailedPublish.
        const command: CaptureCommand = {
          _tag: "PublishEntry",
          captureId: state.captureId,
          childId: state.childId,
          authorId: state.authorId,
          transcript: state.rawTranscript,
          createdAt: message.at,
          events: state.events,
        }
        return [state, [command]]
      },
    ),
    Match.when(
      { state: { _tag: "Review" }, message: { _tag: "PublishedEntry" } },
      ({ state, message }): UpdateResult => {
        const published: CaptureState = {
          _tag: "Published",
          captureId: state.captureId,
          entryId: message.entryId,
        }
        return [published, []]
      },
    ),
    Match.when({ state: { _tag: "Review" }, message: { _tag: "FailedPublish" } }, ({ state }): UpdateResult =>
      keepState(state)),
    // Cancel is allowed from every state that still holds raw data.
    Match.whenOr(
      { state: { _tag: "Recording" }, message: { _tag: "CancelledCapture" } },
      { state: { _tag: "Transcribed" }, message: { _tag: "CancelledCapture" } },
      { state: { _tag: "Extracting" }, message: { _tag: "CancelledCapture" } },
      { state: { _tag: "Review" }, message: { _tag: "CancelledCapture" } },
      (): UpdateResult => [initialCaptureState, []],
    ),
    // Terminal state and every unmatched (state, message) pair are no-ops.
    Match.orElse(({ state }) => keepState(state)),
  )
}
