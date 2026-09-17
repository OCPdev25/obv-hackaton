import { Schema } from "effect"
import { convexId } from "./ids.js"
import { EntryFields, EntrySchema } from "./entry.js"
import { EventFields } from "./event.js"

/**
 * Operation contracts for Convex queries/mutations. These are the single
 * source of truth for function arguments and return shapes — the backend
 * derives its validators from them via `./convexAdapter.ts`, and clients
 * decode responses through them. No hand-written duplicate types.
 */

export const CreateEntryInput = Schema.Struct({
  childId: convexId("children"),
  rawTranscript: EntryFields.rawTranscript,
  photoId: EntryFields.photoId,
})
export type CreateEntryInput = typeof CreateEntryInput["Type"]

export const ListEntriesByChildInput = Schema.Struct({
  childId: convexId("children"),
  limit: Schema.optionalKey(Schema.Int),
})
export type ListEntriesByChildInput = typeof ListEntriesByChildInput["Type"]

export const ListEntriesByChildOutput = Schema.Array(EntrySchema)
export type ListEntriesByChildOutput = typeof ListEntriesByChildOutput["Type"]

/** Events extracted from a transcript, appended to an entry by the extractor. */
export const AppendEventsInput = Schema.Struct({
  entryId: convexId("entries"),
  events: Schema.Array(Schema.Struct(EventFields)),
})
export type AppendEventsInput = typeof AppendEventsInput["Type"]
