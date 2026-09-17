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
  AddQuestionActivityInput,
  AskQuestionInput,
  CareQuestionViewSchema,
  HandoffDigestOutput,
  ListQuestionsByChildInput,
  ListQuestionsByChildOutput,
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
export { toolSchemaFor } from "./jsonSchema.js"
export {
  CareQuestionFields,
  CareQuestionSchema,
  CareQuestionDocument,
  CareQuestionActivityFields,
  CareQuestionActivityKind,
  CareQuestionActivitySchema,
  CareQuestionActivityDocument,
  HandoffLineSchema,
  HandoffDigestSchema,
  buildHandoffDigest,
  deriveQuestionState,
} from "./careQuestion.js"
export {
  canAskQuestion,
  canAnswerQuestion,
  canReopenQuestion,
  canResolveQuestion,
  canViewQuestion,
  visibleQuestions,
} from "./careQuestionPolicy.js"

export type { Child } from "./child.js"
export type { Household } from "./household.js"
export type { Entry } from "./entry.js"
export type { Event, EventCategory } from "./event.js"
// KnowledgeKind / KnowledgeStatus / KnowledgeProvenanceKind / KnowledgeSourceType
// are merged value+type symbols — exported once by value above.
export type { Knowledge } from "./knowledge.js"
// Merged schema constants above already export CareQuestionDocument,
// CareQuestionActivity(Document), CareQuestionActivityKind, HandoffLine and
// HandoffDigest with their types; only pure types are re-exported here.
export type {
  CareQuestion,
  CareQuestionAnswerView,
  CareQuestionState,
  HandoffLine,
  HandoffDigest,
  HandoffDigestInput,
} from "./careQuestion.js"
export type {
  QuestionPrincipal,
  QuestionDenyCode,
  QuestionDecision,
  QuestionTargetFacts,
  AskQuestionChecks,
  QuestionStatus,
} from "./careQuestionPolicy.js"
export type { CareQuestionView } from "./contracts.js"
