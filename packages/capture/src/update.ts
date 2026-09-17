/**
 * Pure update: `[nextState, commands]` (Foldkit R3). No I/O, no clock, no
 * navigation — side effects are described as commands. TypeScript exhaustively
 * checks every message; unmatched (state, message) pairs are deliberate
 * no-ops, never silent state changes.
 *
 * Stale-result guard (candidate D, kept verbatim): any message carrying a
 * captureId that does not match the active state's captureId is ignored.
 *
 * Grafted behavior (candidates C + A + corpus status decision):
 *  - Entering Transcribed emits `PersistRawDraft` — the caregiver's words are
 *    durably persisted as a DRAFT entry before extraction can run, so a crash
 *    during extraction loses nothing (candidate C's raw-first design).
 *  - Raw-persist failure parks in `RawPersistFailed` (candidate A's explicit
 *    failure-park modeling) with raw input preserved in-state;
 *    `RetryPersistRaw` re-issues the persist command.
 *  - Extraction success emits `AttachEvents` — the extracted events attach to
 *    the existing draft, making "draft with events" the stored state at
 *    creation (corpus status-model decision; fixes D's draft-at-publish).
 *  - `PublishEntry` narrows to a status flip: the entry already exists, so
 *    confirm-and-publish cannot create a second row.
 */
import { Match } from "effect"

import type { CaptureId } from "@journal/domain"

import type {
  CaptureMessage,
  CaptureState,
  Extracting,
  RawPersistFailed,
  Recording,
  Review,
  Transcribed,
} from "./state.js"

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

const initialCaptureState: CaptureState = { _tag: "Idle" }

const keepState = (state: CaptureState): UpdateResult => [state, []]

const captureFieldsOf = (
  state: Extracting | RawPersistFailed | Transcribed | Review,
): { captureId: CaptureId; childId: string; authorId: string; rawTranscript: string; capturedAt: number; timezone: string } => ({
  captureId: state.captureId,
  childId: state.childId,
  authorId: state.authorId,
  rawTranscript: state.rawTranscript,
  capturedAt: state.capturedAt,
  timezone: state.timezone,
})

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
          capturedAt: message.at,
          timezone: message.timezone,
        }
        // Raw-first (candidate C): persist the draft at TextCaptured, before
        // extraction runs. Same captureId makes the eventual publish idempotent.
        const command: CaptureCommand = {
          _tag: "PersistRawDraft",
          captureId: state.captureId,
          childId: state.childId,
          authorId: state.authorId,
          rawTranscript: message.transcript,
          createdAt: message.at,
        }
        return [transcribed, [command]]
      },
    ),
    Match.when(
      { state: { _tag: "Transcribed" }, message: { _tag: "SubmittedForExtraction" } },
      ({ state }): UpdateResult => {
        const extracting: Extracting = { _tag: "Extracting", ...captureFieldsOf(state) }
        const command: CaptureCommand = {
          _tag: "ExtractEvents",
          captureId: state.captureId,
          childId: state.childId,
          authorId: state.authorId,
          transcript: state.rawTranscript,
          capturedAt: state.capturedAt,
          timezone: state.timezone,
        }
        return [extracting, [command]]
      },
    ),
    Match.when(
      { state: { _tag: "Extracting" }, message: { _tag: "SucceededExtraction" } },
      ({ state, message }): UpdateResult => {
        const review: Review = {
          _tag: "Review",
          ...captureFieldsOf(state),
          events: [...message.events],
        }
        // Draft-with-events (corpus status decision): the events attach to the
        // draft entry that raw-first persistence already created.
        const command: CaptureCommand = {
          _tag: "AttachEvents",
          captureId: state.captureId,
          events: message.events,
        }
        return [review, [command]]
      },
    ),
    Match.when(
      { state: { _tag: "Extracting" }, message: { _tag: "FailedExtraction" } },
      ({ state }): UpdateResult => {
        // Raw input survives untouched (in state AND as the durable draft);
        // the same captureId retries extraction.
        const transcribed: Transcribed = { _tag: "Transcribed", ...captureFieldsOf(state) }
        return [transcribed, []]
      },
    ),
    // Raw-persist results: success changes nothing visible (the store owns the
    // row); failure parks the machine with raw input preserved.
    Match.when(
      { state: { _tag: "Transcribed" }, message: { _tag: "RawDraftPersisted" } },
      ({ state }): UpdateResult => keepState(state),
    ),
    Match.when(
      { state: { _tag: "Transcribed" }, message: { _tag: "RawDraftPersistFailed" } },
      ({ state, message }): UpdateResult => {
        const parked: RawPersistFailed = {
          _tag: "RawPersistFailed",
          ...captureFieldsOf(state),
          reason: message.reason,
        }
        return [parked, []]
      },
    ),
    Match.when(
      { state: { _tag: "RawPersistFailed" }, message: { _tag: "RetryPersistRaw" } },
      ({ state, message }): UpdateResult => {
        const transcribed: Transcribed = { _tag: "Transcribed", ...captureFieldsOf(state) }
        const command: CaptureCommand = {
          _tag: "PersistRawDraft",
          captureId: state.captureId,
          childId: state.childId,
          authorId: state.authorId,
          rawTranscript: state.rawTranscript,
          createdAt: state.capturedAt,
        }
        return [transcribed, [command]]
      },
    ),
    Match.when(
      { state: { _tag: "Review" }, message: { _tag: "ConfirmedReview" } },
      ({ state }): UpdateResult => {
        // State stays Review until PublishedEntry arrives; retry on FailedPublish.
        const command: CaptureCommand = { _tag: "PublishEntry", captureId: state.captureId }
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
    // Attach results (Review): success confirms the draft now carries events
    // durably; failure parks — publish must not run without durable events,
    // and RetryPersistRaw's persist is idempotent, then re-extraction (a
    // deterministic double) reproduces the same events.
    Match.when({ state: { _tag: "Review" }, message: { _tag: "EventsAttached" } }, ({ state }): UpdateResult =>
      keepState(state)),
    Match.when(
      { state: { _tag: "Review" }, message: { _tag: "RawDraftPersistFailed" } },
      ({ state, message }): UpdateResult => {
        const parked: RawPersistFailed = {
          _tag: "RawPersistFailed",
          ...captureFieldsOf(state),
          reason: message.reason,
        }
        return [parked, []]
      },
    ),
    // Cancel is allowed from every state that still holds raw data.
    Match.whenOr(
      { state: { _tag: "Recording" }, message: { _tag: "CancelledCapture" } },
      { state: { _tag: "Transcribed" }, message: { _tag: "CancelledCapture" } },
      { state: { _tag: "Extracting" }, message: { _tag: "CancelledCapture" } },
      { state: { _tag: "Review" }, message: { _tag: "CancelledCapture" } },
      { state: { _tag: "RawPersistFailed" }, message: { _tag: "CancelledCapture" } },
      (): UpdateResult => [initialCaptureState, []],
    ),
    // Terminal state and every unmatched (state, message) pair are no-ops.
    Match.orElse(({ state }) => keepState(state)),
  )
}
