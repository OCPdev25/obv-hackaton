import { Schema } from "effect"
import { convexId } from "./ids.js"
import { ChildFields } from "./child.js"
import { EntryFields, EntrySchema } from "./entry.js"
import { EventFields } from "./event.js"
import { HouseholdFields } from "./household.js"
import { CaptureId } from "./extraction.js"
import { RetractionFilter } from "./retraction.js"

/**
 * Operation contracts for Convex queries/mutations. These are the single
 * source of truth for function arguments and return shapes — the backend
 * derives its validators from them via `./convexAdapter.ts`, and clients
 * decode responses through them. No hand-written duplicate types.
 */

export const CreateEntryInput = Schema.Struct({
  childId: convexId("children"),
  rawTranscript: EntryFields.rawTranscript,
  authorId: EntryFields.authorId,
  /** Retried captures with the same captureId return the original entry. */
  captureId: Schema.optional(CaptureId),
  photoId: EntryFields.photoId,
})
export type CreateEntryInput = typeof CreateEntryInput["Type"]

export const CreateEntryOutput = Schema.Struct({
  status: Schema.Literals(["created", "idempotent_hit"]),
  entryId: convexId("entries"),
  captureId: Schema.optional(CaptureId),
})
export type CreateEntryOutput = typeof CreateEntryOutput["Type"]

export const CreateChildInput = Schema.Struct({
  householdId: convexId("households"),
  name: ChildFields.name,
  birthDate: ChildFields.birthDate,
})
export type CreateChildInput = typeof CreateChildInput["Type"]

export const CreateChildOutput = Schema.Struct({
  status: Schema.Literals(["created"]),
  childId: convexId("children"),
  name: Schema.String,
})
export type CreateChildOutput = typeof CreateChildOutput["Type"]

/** Minimal household creation — the full membership/invitation flow supersedes it. */
export const CreateHouseholdInput = Schema.Struct({
  name: HouseholdFields.name,
})
export type CreateHouseholdInput = typeof CreateHouseholdInput["Type"]

export const CreateHouseholdOutput = Schema.Struct({
  status: Schema.Literals(["created"]),
  householdId: convexId("households"),
  name: Schema.String,
})
export type CreateHouseholdOutput = typeof CreateHouseholdOutput["Type"]

export const ListEntriesByChildInput = Schema.Struct({
  childId: convexId("children"),
  limit: Schema.optionalKey(Schema.Int),
  /**
   * v0.4 retraction filter hook — the pattern every household-facing query
   * input embeds (agent queries slots 15/17/23/24, timeline reads). Absent
   * means the household default: retracted entries are EXCLUDED.
   */
  retraction: Schema.optionalKey(RetractionFilter),
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
