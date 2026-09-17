export { generateCorpus, type JournalCorpus, type CorpusRecord, type CorrectionRecord } from "./corpus.js"
export { answerQuery, resolveEntrySource } from "./engine.js"
export { compilePlan, parseWindow, type CompiledQuery, type ClarifyReason, type ActivityRef, type ParsedWindow } from "./resolve.js"
export {
  HistoryQueryInput,
  HistoryQueryPlan,
  HistoryQueryAnswer,
  QueryWindow as QueryWindowSchema,
  AnswerCoverage as AnswerCoverageSchema,
  AnswerNotice as AnswerNoticeSchema,
  AnswerCitation as AnswerCitationSchema,
  AmbiguityCandidate as AmbiguityCandidateSchema,
  ConflictClaim as ConflictClaimSchema,
  type HistoryQueryInput as Input,
  type HistoryQueryPlan as Plan,
  type HistoryQueryAnswer as Answer,
  type QueryWindow as Window,
  type AnswerCoverage,
  type AnswerCitation,
  type AnswerNotice,
  type AmbiguityCandidate,
  type ConflictClaim,
} from "./queryContracts.js"
