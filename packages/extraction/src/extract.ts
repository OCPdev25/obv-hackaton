import { Effect, Schema } from "effect"
import { EventSchema, type Event, type ExtractionRequest, type ExtractionResult } from "@journal/domain"

/** Typed failure of the extraction pipeline. */
export class ExtractionError extends Schema.TaggedError<ExtractionError>()("ExtractionError", {
  message: Schema.String,
}) {}

/**
 * Turns a caregiver's raw transcript into structured journal events. Requests
 * and results carry the { captureId, attempt } envelope from the canonical
 * contract. The stub below performs no LLM call — it defines the contract the
 * real implementation (OpenAI tool-call against `toolSchemaFor(EventSchema)`)
 * will satisfy, so callers can be built against it now.
 */
export interface TranscriptEventExtractor {
  extractEvents: (request: ExtractionRequest) => Effect.Effect<ExtractionResult, ExtractionError>
}

export const stubTranscriptEventExtractor: TranscriptEventExtractor = {
  extractEvents: ({ captureId, attempt }) => Effect.succeed({ captureId, attempt, events: [] }),
}

/**
 * Decode raw extractor output (e.g. an LLM tool-call response) into typed
 * events through the canonical domain schema — the only path external data
 * may take into the system.
 */
export const decodeExtractedEvents = (raw: unknown): Effect.Effect<ReadonlyArray<Event>, ExtractionError> =>
  Effect.mapError(
    Schema.decodeUnknownEffect(Schema.Array(EventSchema))(raw),
    (issue) => new ExtractionError({ message: issue.message })
  )
