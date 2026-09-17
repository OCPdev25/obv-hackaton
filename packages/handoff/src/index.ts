// Schema constants are merged value+type symbols; exporting each name once
// brings both sides (same pattern as @journal/domain).
export {
  CATEGORY_ORDER,
  Confidence,
  LOW_CONFIDENCE_THRESHOLD,
  CoverageRow,
  DigestClaim,
  DigestInput,
  FollowUpAnswer,
  GapDisclosure,
  HandoffDigest,
  HandoffEntry,
  HandoffEvent,
  HandoffEventCategory,
  RoutineNote,
  SourceIndexEntry,
  SourceRef,
  SourceRefs,
  UnresolvedQuestion,
  UnresolvedQuestionReason,
} from "./contracts.js"
export {
  FORBIDDEN_TOKENS,
  assertCareNeutral,
  coverageObservedNote,
  coverageZeroNote,
  gapDayDisclosure,
  notLoggedForCategory,
  notLoggedGeneric,
} from "./gaps.js"
export { dayKey, daysInWindow, timeLabel } from "./time.js"
export {
  categoryLabel,
  composeSinceLastSeen,
  entryRef,
  entrySnippet,
  eventStatement,
  isClaimableEvent,
  windowEntries,
} from "./compose.js"
export { answerFollowUp, isMedicalQuestion, isOutOfWindowQuestion, matchCategory } from "./followUp.js"
export { answerToText, digestToText } from "./render.js"
