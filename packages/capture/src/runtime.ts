/**
 * Command execution + the capture loop (Foldkit R4/R5). `executeCommand` maps
 * a command to the matching service effect; the loop folds each result-message
 * back through the pure update. Services are injected as plain shapes, so the
 * same loop drives the RN app, tests, and the local E2E driver.
 */
import { Effect } from "effect"

import type { CaptureMessage, CaptureState } from "@journal/domain"

import type { CaptureCommand } from "./commands.js"
import { update, type UpdateResult } from "./update.js"
import type { ExtractionServiceShape } from "./services/extraction.js"
import type { EntryStoreShape } from "./services/entries.js"

export interface CaptureServices {
  readonly extraction: ExtractionServiceShape
  readonly store: EntryStoreShape
}

export const executeCommand = (
  command: CaptureCommand,
  services: CaptureServices,
): Effect.Effect<CaptureMessage, never, never> => {
  switch (command._tag) {
    case "ExtractEvents":
      return services.extraction.extract({
        captureId: command.captureId,
        childId: command.childId,
        authorId: command.authorId,
        transcript: command.transcript,
      }).pipe(
        Effect.match({
          onFailure: (error): CaptureMessage => ({
            _tag: "FailedExtraction",
            captureId: command.captureId,
            reason: error.reason,
          }),
          onSuccess: (events): CaptureMessage => ({
            _tag: "SucceededExtraction",
            captureId: command.captureId,
            events,
          }),
        }),
      )
    case "PublishEntry":
      return services.store.publish({
        _tag: "Entry",
        captureId: command.captureId,
        childId: command.childId,
        transcript: command.transcript,
        authorId: command.authorId,
        createdAt: command.createdAt,
        status: "draft",
        events: [...command.events],
      }).pipe(
        Effect.match({
          onFailure: (error): CaptureMessage => ({
            _tag: "FailedPublish",
            captureId: command.captureId,
            reason: error.reason,
          }),
          onSuccess: (stored): CaptureMessage =>
            stored.entryId === undefined
              ? {
                _tag: "FailedPublish",
                captureId: command.captureId,
                reason: "store returned an entry without an id",
              }
              : { _tag: "PublishedEntry", captureId: command.captureId, entryId: stored.entryId },
        }),
      )
  }
}

export interface CaptureLoop {
  readonly state: () => CaptureState
  /** Runs update, reports the new state, then executes returned commands. */
  readonly dispatch: (message: CaptureMessage) => Promise<void>
}

export const makeCaptureLoop = (
  services: CaptureServices,
  onState: (state: CaptureState, result: UpdateResult) => void,
  initial: CaptureState = { _tag: "Idle" },
): CaptureLoop => {
  let current: CaptureState = initial
  const loop: CaptureLoop = {
    state: () => current,
    dispatch: async (message) => {
      const [next, commands] = update(current, message)
      if (next !== current) {
        current = next
        onState(current, [next, commands])
      }
      for (const command of commands) {
        const resultMessage = await Effect.runPromise(executeCommand(command, services))
        // Result-messages re-enter the loop; the reducer's stale guard makes
        // late results from an abandoned capture harmless.
        await loop.dispatch(resultMessage)
      }
    },
  }
  return loop
}
