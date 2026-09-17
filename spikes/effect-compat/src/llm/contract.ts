/**
 * LLM extraction contract: raw dictated transcript in, typed journal events out.
 *
 * Every implementation of this contract MUST decode its output through the
 * canonical `Event` schema — callers can rely on the decoded shape without
 * re-validating. All failures are typed; nothing throws across the boundary.
 */
import { Effect, Schema } from 'effect'
import { Event } from '../schema'

/** A transcript the provider could not turn into events (network, quota, refusal, missing key...). */
export class ProviderFailure extends Schema.TaggedError<ProviderFailure>()('ProviderFailure', {
  reason: Schema.String,
}) {}

/** The provider's reply was not parseable as the agreed JSON envelope. */
export class MalformedModelOutput extends Schema.TaggedError<MalformedModelOutput>()('MalformedModelOutput', {
  raw: Schema.String,
}) {}

/** The provider replied with parseable JSON whose events failed the canonical schema. */
export class EventsFailedSchema extends Schema.TaggedError<EventsFailedSchema>()('EventsFailedSchema', {
  issues: Schema.Array(Schema.String),
}) {}

/** All contract failures, exhaustive — callers match on these and nothing else. */
export type ExtractionError = ProviderFailure | MalformedModelOutput | EventsFailedSchema

/**
 * Correlation for one extraction attempt: `captureId` is the resilient capture
 * identifier created on the client when recording starts (survives app
 * restarts and disconnects); `attempt` is a monotonically increasing sequence
 * per captureId, starting at 0 and incremented on every retry.
 */
export const CaptureAttempt = Schema.Struct({
  captureId: Schema.NonEmptyString,
  attempt: Schema.Natural,
})
export type CaptureAttempt = Schema.Schema.Type<typeof CaptureAttempt>

/** Request for one extraction attempt. */
export const ExtractEventsRequest = Schema.Struct({
  captureId: Schema.NonEmptyString,
  attempt: Schema.Natural,
  transcript: Schema.NonEmptyString,
})
export type ExtractEventsRequest = Schema.Schema.Type<typeof ExtractEventsRequest>

/** Result envelope for one extraction attempt, stamped with its correlation. */
export const ExtractionResult = Schema.Struct({
  captureId: Schema.NonEmptyString,
  attempt: Schema.Natural,
  events: Schema.Array(Event),
})
export type ExtractionResult = Schema.Schema.Type<typeof ExtractionResult>

/**
 * The extraction contract: request in (captureId + attempt + transcript),
 * canonical Events out, typed failures only.
 *
 * INTERRUPTION SEMANTICS — contract requirements:
 *
 * 1. Client interruption does NOT cancel an already-running server
 *    extraction action. The action runs to completion server-side and its
 *    result remains available through the results path even after the client
 *    disconnects.
 * 2. Stale-result suppression: a result may only be applied when its
 *    (captureId, attempt) is the LATEST attempt for that captureId. Results
 *    from superseded attempts are discarded, never merged.
 * 3. Idempotent completion: applying the same (captureId, attempt) result
 *    twice must be a no-op (duplicate protection), so the backend action can
 *    safely complete after a client disconnect and a client-side retry.
 */
export type ExtractEvents = (request: ExtractEventsRequest) => Effect.Effect<ExtractionResult, ExtractionError>

/**
 * Decodes raw (untagged) event payloads from a model through the canonical
 * schema and stamps the result envelope with the attempt correlation.
 * Strict: one invalid event fails the whole extraction — callers see typed
 * issues instead of silently losing data. (A lenient drop-and-keep variant
 * was considered; strictness is the safer contract default for a spike.)
 */
export const decodeModelEvents = (
  request: CaptureAttempt,
  raw: ReadonlyArray<unknown>,
): Effect.Effect<ExtractionResult, EventsFailedSchema> =>
  Effect.forEach(raw, (payload, i) =>
    Effect.try({
      try: () => Schema.decodeUnknownSync(Event)({ _tag: 'Event', ...(payload as Record<string, unknown>) }),
      catch: (error) => `event[${i}]: ${error instanceof Error ? error.message : String(error)}`,
    }),
  ).pipe(
    Effect.map((events): ExtractionResult => ({ captureId: request.captureId, attempt: request.attempt, events })),
    // Fail-fast strictness: forEach stops at the first invalid event, so the
    // issue list carries the single formatted failure.
    Effect.mapError((issue: string) => new EventsFailedSchema({ issues: [issue] })),
  )
