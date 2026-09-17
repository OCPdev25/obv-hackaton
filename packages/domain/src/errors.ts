import { Schema } from 'effect'

/**
 * Typed service errors. Schema-backed so they cross service boundaries as
 * plain data and remain yieldable in `Effect.gen`.
 */

export class ExtractionError extends Schema.TaggedError<ExtractionError>()('ExtractionError', {
  /** provider_unavailable: no live provider configured (e.g. cloud absent). */
  code: Schema.Literals(['provider_unavailable', 'rate_limited', 'invalid_output', 'invalid_input']),
  detail: Schema.String,
}) {}

export class StoreError extends Schema.TaggedError<StoreError>()('StoreError', {
  /** raw_capture_missing: publish attempted before the raw capture was persisted. */
  code: Schema.Literals(['raw_capture_missing', 'unavailable', 'validation_failed']),
  detail: Schema.String,
}) {}
