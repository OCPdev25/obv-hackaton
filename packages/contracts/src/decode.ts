import { Result, Schema } from "effect"
import { JournalEvent } from "./events.ts"

/**
 * Boundary decoding/encoding for journal events. Every external input —
 * Convex mutation args, stored documents being re-validated, LLM output —
 * decodes through these functions. The Effect Schema is the validation
 * authority; Convex validators only perform cheap structural checks.
 */

export const decodeJournalEvent = (input: unknown): Result.Result<JournalEvent, Schema.SchemaError> =>
  Schema.decodeUnknownResult(JournalEvent)(input)

export const encodeJournalEvent = (event: JournalEvent): typeof JournalEvent.Encoded =>
  Schema.encodeSync(JournalEvent)(event)
