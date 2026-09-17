/**
 * Runtime glue (candidate D's loop, adapted to the grafted command set): maps
 * each command to the matching service effect and folds both outcomes back
 * into result-messages, so the reducer stays the ONLY decision point. Command
 * execution is sequential — a raw draft is durably persisted before
 * extraction runs, preserving raw-before-events by construction.
 */
import { Effect } from "effect"

import { update } from "./update.js"

import type { CaptureState, CaptureMessage } from "./state.js"
import type { CaptureCommand } from "./commands.js"
import type { EntryStoreShape, StoreError } from "./services/entries.js"
import type { ExtractionServiceShape } from "./services/extraction.js"

export interface CaptureServices {
  readonly extraction: ExtractionServiceShape
  readonly entries: EntryStoreShape
}

const describeStoreError = (error: StoreError): string =>
  error._tag === "raw_capture_missing" ? `no durable raw draft for capture ${error.captureId}` : error.reason

/**
 * Execute one command, producing the result-messages to dispatch. Every
 * failure path is a typed message — none of the store or extractor errors is
 * swallowed.
 */
export const executeCommand = (
  services: CaptureServices,
  command: CaptureCommand,
): Effect.Effect<ReadonlyArray<CaptureMessage>> => {
  switch (command._tag) {
    case "PersistRawDraft":
      return services.entries
        .persistRawDraft({
          captureId: command.captureId,
          childId: command.childId,
          authorId: command.authorId,
          rawTranscript: command.rawTranscript,
          createdAt: command.createdAt,
        })
        .pipe(
          Effect.match({
            onSuccess: (entry) => [{ _tag: "RawDraftPersisted", captureId: command.captureId, entryId: entry.captureId }],
            onFailure: (error) => [{ _tag: "RawDraftPersistFailed", captureId: command.captureId, reason: describeStoreError(error) }],
          }),
        )
    case "ExtractEvents":
      return services.extraction
        .extract({
          captureId: command.captureId,
          childId: command.childId,
          authorId: command.authorId,
          transcript: command.transcript,
          capturedAt: command.capturedAt,
          timezone: command.timezone,
        })
        .pipe(
          Effect.match({
            onSuccess: (events) => [{ _tag: "SucceededExtraction", captureId: command.captureId, events }],
            onFailure: (error) => [{ _tag: "FailedExtraction", captureId: command.captureId, reason: error.reason }],
          }),
        )
    case "AttachEvents":
      return services.entries.attachEvents(command.captureId, command.events).pipe(
        Effect.match({
          onSuccess: () => [{ _tag: "EventsAttached", captureId: command.captureId }],
          onFailure: (error) => [{ _tag: "RawDraftPersistFailed", captureId: command.captureId, reason: describeStoreError(error) }],
        }),
      )
    case "PublishEntry":
      return services.entries.publish(command.captureId).pipe(
        Effect.match({
          onSuccess: ({ entryId }) => [{ _tag: "PublishedEntry", captureId: command.captureId, entryId }],
          onFailure: (error) => [{ _tag: "FailedPublish", captureId: command.captureId, reason: describeStoreError(error) }],
        }),
      )
  }
}

export interface CaptureLoop {
  /** Dispatch a message; runs commands the update emits (sequentially). */
  readonly dispatch: (message: CaptureMessage) => Effect.Effect<void>
  readonly state: () => CaptureState
}

export const makeCaptureLoop = (services: CaptureServices, onState?: (state: CaptureState) => void): CaptureLoop => {
  let current: CaptureState = { _tag: "Idle" }

  const dispatch = (message: CaptureMessage): Effect.Effect<void> =>
    Effect.suspend(() => {
      const [next, commands] = update(current, message)
      if (next !== current) {
        current = next
        onState?.(current)
      }
      return Effect.forEach(commands, (command) =>
        executeCommand(services, command).pipe(
          Effect.flatMap((resultMessages) => Effect.forEach(resultMessages, (resultMessage) => dispatch(resultMessage))),
        ),
      ).pipe(Effect.asVoid)
    })

  return { dispatch, state: () => current }
}
