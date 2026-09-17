import { Effect } from 'effect'
import type { ExtractionError, StoreError } from './errors.js'
import { makeCaptureUpdate, type CaptureCommand, type CaptureMessage, type CaptureSession, type CaptureState } from './capture.js'
import { CaptureStore, Extractor } from './services.js'

/**
 * Command runtime: executes named commands against service implementations
 * and feeds their result messages back into the pure update. This is the only
 * place the loop closes; `update` itself stays pure.
 */

export const runCommand = (
  session: CaptureSession,
  command: CaptureCommand,
): Effect.Effect<CaptureMessage, never, Extractor | CaptureStore> => {
  switch (command._tag) {
    case 'PersistRawCapture':
      return Effect.gen(function* () {
        const store = yield* CaptureStore
        return yield* store.persistRaw(command.entry).pipe(
          Effect.map((): CaptureMessage => ({ _tag: 'SucceededPersistRaw' })),
          Effect.catch((error: StoreError) =>
            Effect.succeed(
              failMessage({ _tag: 'FailedPersistRaw', error: { code: 'persist_failed', detail: `${error.code}: ${error.detail}` } }),
            ),
          ),
        )
      })

    case 'ExtractEvents':
      return Effect.gen(function* () {
        const extractor = yield* Extractor
        return yield* extractor
          .extract({
            captureId: command.captureId,
            transcript: command.transcript,
            authorId: command.authorId,
            capturedAt: command.capturedAt,
          })
          .pipe(
            Effect.map((events): CaptureMessage => ({ _tag: 'SucceededExtraction', events: [...events] })),
            Effect.catch((error: ExtractionError) =>
              Effect.succeed(
                failMessage({
                  _tag: 'FailedExtraction',
                  error: { code: 'extraction_failed', detail: `${error.code}: ${error.detail}` },
                }),
              ),
            ),
          )
      })

    case 'PublishEntry':
      return Effect.gen(function* () {
        const store = yield* CaptureStore
        return yield* store.publish({ captureId: command.captureId, events: command.events }).pipe(
          Effect.map((outcome): CaptureMessage => ({ _tag: 'SucceededPublish', entryId: outcome.entryId })),
          Effect.catch((error: StoreError) =>
            Effect.succeed(
              failMessage({
                _tag: 'FailedPublish',
                error: { code: 'publish_failed', detail: `${error.code}: ${error.detail}` },
              }),
            ),
          ),
        )
      })
  }
}

const failMessage = (message: CaptureMessage): CaptureMessage => message

/**
 * Dispatch one message: run the pure update, execute returned commands
 * sequentially, and dispatch their result messages until the machine rests.
 */
export const dispatchMessage = (
  session: CaptureSession,
  state: CaptureState,
  message: CaptureMessage,
): Effect.Effect<CaptureState, never, Extractor | CaptureStore> => {
  const update = makeCaptureUpdate(session)

  const step = (
    currentState: CaptureState,
    commands: ReadonlyArray<CaptureCommand>,
  ): Effect.Effect<CaptureState, never, Extractor | CaptureStore> => {
    const first = commands[0]
    if (first === undefined) return Effect.succeed(currentState)
    return Effect.flatMap(runCommand(session, first), (resultMessage) => {
      const [next, nextCommands] = update(currentState, resultMessage)
      return step(next, nextCommands)
    })
  }

  const [next, commands] = update(state, message)
  return step(next, commands)
}
