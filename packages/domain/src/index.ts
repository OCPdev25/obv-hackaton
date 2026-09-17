export {
  CONVEX_TABLE_ANNOTATION,
  convexId,
  convexTableFrom,
} from "./ids.js"
// Schema constants are merged value+type symbols; exporting each name once
// brings both sides. Pure type aliases are re-exported separately below.
export { ChildFields, ChildSchema, ChildDocument } from "./child.js"
export { EntryFields, EntrySchema, ExtractionStatus, EntryVisibility, EntryDocument } from "./entry.js"
export { EventFields, EventSchema, EventDocument, ProducedBy } from "./event.js"
export { HouseholdFields, HouseholdSchema, HouseholdDocument } from "./household.js"
export {
  AppendEventsInput,
  CreateChildInput,
  CreateChildOutput,
  CreateEntryInput,
  CreateEntryOutput,
  CreateHouseholdInput,
  CreateHouseholdOutput,
  ListEntriesByChildInput,
  ListEntriesByChildOutput,
} from "./contracts.js"
export {
  AttemptNumber,
  CaptureId,
  ExtractionRequest,
  ExtractionResult,
} from "./extraction.js"
export {
  AttemptFailure,
  AttemptTrigger,
  ExtractionAttempt,
  ExtractionAttemptDocument,
  ExtractionAttemptFields,
  deriveExtractionStatus,
} from "./lineage.js"
export { Attachment } from "./attachment.js"
export {
  ContextEnvelope,
  PriorReference,
  ProvenanceSource,
  ProvenancedChild,
  ProvenancedTimezone,
  ProvenancedView,
} from "./contextEnvelope.js"
export {
  Answered,
  Authorization,
  EventCandidate,
  ExtractionOutcome,
  FactCandidates,
  QuestionIntent,
  UnresolvedReference,
  WriteProposal,
} from "./operations.js"
export {
  KnowledgeFields,
  KnowledgeSchema,
  KnowledgeSourceSpan,
  KnowledgeStatus,
  KnowledgeProvenanceKind,
  KnowledgeSourceType,
  KnowledgeDocument,
  KnowledgeShapeError,
  assertKnowledgeInvariants,
} from "./knowledge.js"
// Since-last-seen catch-up (art_6qhBut41): read-state + report contracts,
// deterministic reducer, watermark advance, EventRevision proposal.
export {
  AdvanceReadStateInput,
  CaregiverReadStateFields,
  CatchUpItem,
  CatchUpQueryInput,
  CatchUpReport,
  CatchUpSource,
  CoverageDay,
  EventRevisionFields,
  EventRevisionStruct,
  advanceReadState,
  computeCatchUp,
  gapDisclosure,
  utcDayKey,
} from "./catchup.js"
export { toolSchemaFor } from "./jsonSchema.js"

export type { Child } from "./child.js"
export type { Household } from "./household.js"
export type { Entry } from "./entry.js"
export type { Event, EventCategory } from "./event.js"
// KnowledgeKind / KnowledgeStatus / KnowledgeProvenanceKind / KnowledgeSourceType
// are merged value+type symbols — exported once by value above.
export type { Knowledge } from "./knowledge.js"
// Catch-up pure types — schema constants above are merged value+type symbols.
export type {
  CatchUpEntry,
  CatchUpError,
  CatchUpGrants,
  CatchUpHistory,
  CatchUpItemKind,
  CatchUpRevision,
  DayKeyOf,
  EventRevision,
} from "./catchup.js"
