import { Schema } from "effect"
import { convexId } from "./ids.js"
import { ChildFields } from "./child.js"
import { EntryFields, EntrySchema } from "./entry.js"
import { EventFields } from "./event.js"
import { HouseholdFields } from "./household.js"
import { CaptureId } from "./extraction.js"
import {
  CareQuestionFields,
  CareQuestionSchema,
  CareQuestionDocument,
  CareQuestionActivityFields,
  CareQuestionActivityKind,
  CareQuestionActivitySchema,
  CareQuestionActivityDocument,
  HandoffDigestSchema,
} from "./careQuestion.js"

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

// ---- Caregiver questions (Journal & Caregiver Coordination lane) ----
// Asking is attributed to the acting caregiver and targets an existing entry
// (with its optional event). Audience is directed (explicit addressees) or
// household-wide. The activity contract mirrors CareQuestionActivityKind 1:1;
// payloads are optional because each kind carries a different subset.

export const AskQuestionInput = Schema.Struct({
  childId: convexId("children"),
  entryId: convexId("entries"),
  eventId: Schema.optionalKey(convexId("events")),
  question: Schema.String,
  audienceKind: Schema.Literals(["directed", "household"]),
  addresseeIds: Schema.optionalKey(Schema.Array(Schema.String)),
  handoffIncluded: Schema.optionalKey(Schema.Boolean),
})
export type AskQuestionInput = typeof AskQuestionInput["Type"]

export const AddQuestionActivityInput = Schema.Struct({
  questionId: convexId("careQuestions"),
  kind: CareQuestionActivityKind,
  answerText: Schema.optionalKey(Schema.String),
  sourceKind: Schema.optionalKey(Schema.Literals(["voice", "text", "photo"])),
  sourceId: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
  settlesActivityId: Schema.optionalKey(Schema.String),
})
export type AddQuestionActivityInput = typeof AddQuestionActivityInput["Type"]

/** A question plus its append-only activity log; lifecycle state is derived. */
export const CareQuestionViewSchema = Schema.Struct({
  question: CareQuestionDocument,
  activities: Schema.Array(CareQuestionActivityDocument),
})
export type CareQuestionView = typeof CareQuestionViewSchema["Type"]

export const ListQuestionsByChildInput = Schema.Struct({
  childId: convexId("children"),
  limit: Schema.optionalKey(Schema.Int),
})
export type ListQuestionsByChildInput = typeof ListQuestionsByChildInput["Type"]

export const ListQuestionsByChildOutput = Schema.Struct({
  views: Schema.Array(CareQuestionViewSchema),
})
export type ListQuestionsByChildOutput = typeof ListQuestionsByChildOutput["Type"]

/** Decode boundary for handoff-digest responses (aliases HandoffDigestSchema). */
export const HandoffDigestOutput = HandoffDigestSchema
export type HandoffDigestOutput = typeof HandoffDigestOutput["Type"]
