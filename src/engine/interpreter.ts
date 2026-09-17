/**
 * Command interpreter — the ONLY place effects run.
 *
 * The pure update (src/domain/captureState.ts) produces named commands; this
 * interpreter executes them through the service interfaces (Extraction,
 * CaptureRepository) and feeds the results back as messages until the flow
 * reaches a terminal state. Services are provided at the composition root via
 * Effect.provideService — the same binary works against the live Convex
 * repository or the in-memory test double.
 */
import { Effect, Result } from "effect"
import { update, isTerminalCaptureState, type CaptureMessage, type CaptureState } from "../domain/captureState.js"
import { CaptureRepositoryService, ExtractionService, type CaptureRepositoryApi, type ExtractionApi } from "../domain/services.js"
import { Entry } from "../domain/schema.js"

export interface RunCaptureFlowOptions {
  /** Observes every intermediate state (Extracting → Review → …) as it lands. */
  readonly onStateChange?: (state: CaptureState) => void
}

export const runCaptureFlow = (
  initial: CaptureState,
  messages: ReadonlyArray<CaptureMessage>,
  options?: RunCaptureFlowOptions,
): Effect.Effect<CaptureState, never, ExtractionApi | CaptureRepositoryApi> =>
  Effect.gen(function* () {
    const extraction = yield* Effect.service(ExtractionService)
    const repository = yield* Effect.service(CaptureRepositoryService)
    let state = initial
    const queue: CaptureMessage[] = [...messages]

    while (queue.length > 0 && !isTerminalCaptureState(state)) {
      const message = queue.shift() as CaptureMessage
      const [next, commands] = update(state, message)
      state = next
      options?.onStateChange?.(state)

      for (const command of commands) {
        switch (command.type) {
          case "extractEvents": {
            queue.push({ type: "extractionStarted" })
            const outcome = yield* extraction.extract({
              captureId: command.captureId,
              transcript: command.transcript,
              authorId: command.authorId,
            })
            queue.push(
              outcome.ok
                ? { type: "extractionSucceeded", events: outcome.events }
                : { type: "extractionFailed", reason: outcome.reason },
            )
            break
          }
          case "persistCapture": {
            // The command carries the full entry draft; the interpreter owns
            // the wall-clock createdAt (update stays pure) and hands the
            // domain entry to the repository, which owns wire encoding.
            const entry: Entry = {
              _tag: "Entry",
              captureId: command.captureId,
              childId: command.childId,
              transcript: command.transcript,
              authorId: command.authorId,
              createdAt: new Date(),
              status: "published",
              events: [...command.events],
            }
            // RepositoryError is handled as data: a failed publish is a
            // retryable state, never an unhandled error. (This RC has no
            // catchAll — Effect.result lifts E into a Result to match on.)
            const outcome = yield* Effect.result(repository.publish(entry))
            const message: CaptureMessage = Result.isSuccess(outcome)
              ? { type: "persistSucceeded", recordId: outcome.success.recordId }
              : { type: "persistFailed", reason: `${outcome.failure.reason}: ${outcome.failure.detail}` }
            queue.push(message)
            break
          }
        }
      }
    }
    return state
  })
