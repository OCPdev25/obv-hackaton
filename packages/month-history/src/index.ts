/**
 * @journal/month-history — deterministic month-history surfaces for the
 * Shared Child Journal: timezone-correct bucketing, one-policy
 * authorization, append-only corrections, source-linked handoff digests,
 * and accessibility contracts, with the three journeys as executable
 * checks (src/run.ts + rubric.json).
 */
export {
  DAY_CELL_A11Y_HINT,
  CORRECTION_INPUT_HINT,
  CORRECTION_INPUT_LABEL,
  CORRECTION_ORIGINAL_PRESERVED_LABEL,
  EXTRACTION_FAILED_LABEL,
  FONT_SCALING,
  GAP_DISCLAIMER,
  LAYOUT_POLICY,
  NO_ENTRIES_LABEL,
  QUIET_TEXT_INPUT,
  captureLabel,
  dayCellA11yLabel,
  entryA11yLabel,
  eventA11yLabel,
  lateLabel,
  monthHeaderA11yLabel,
  previewForLabel,
} from "./a11y.js"
export {
  buildLineage,
  latestCorrection,
  type CorrectionLineage,
  type CorrectionRecord,
} from "./corrections.js"
export {
  correctionAccess,
  monthAccess,
  toPolicyEntry,
  type ChildScope,
  type Decision,
  type DenyCode,
  type MonthAccessResult,
  type Principal,
} from "./access.js"
export { buildHandoffDigest, daySummary, type HandoffDigest, type HandoffDigestLine } from "./handoff.js"
export {
  AUTHORS,
  CHILD_ID,
  CORRECTED_TOWER_TRANSCRIPT,
  CORRECTIONS,
  DAD,
  ENTRIES,
  ENTRY_IDS,
  EVENTS,
  EVENT_IDS,
  HOUSEHOLD_ID,
  HOUSEHOLD_ZONE,
  MOM,
  ANA,
  MONTH_FIXTURE,
  NOV1_0130_EDT,
  NOV1_0130_EST,
  OCT1_0010_EVENT,
  ORIGINAL_TOWER_TRANSCRIPT,
  SEP30_2350_EVENT,
} from "./fixtures/monthHistory.js"
export {
  LABEL_LOCALE,
  fullDayLabel,
  isInstantInMonth,
  localDateKey,
  localDateKeysOfMonth,
  localTimeLabel,
  monthLabel,
  nextMonthKey,
  parseMonthKey,
  zonedMonthBounds,
  type LocalParts,
  type ZonedMonthBounds,
} from "./zone.js"
export type {
  BuildMonthHistoryInput,
  CorrectionLineageView,
  DayCellView,
  EntryCardView,
  EntryViewInput,
  EventCardView,
  EventViewInput,
  MonthGapStatement,
  MonthHistoryView,
} from "./types.js"
export { buildMonthHistoryView, entryViewInputFromDocument, eventViewInputFromDocument } from "./view.js"
export { JOURNEY_CHECKS, buildAuthorizedView, type CheckOutcome, type JourneyCheck, type JourneyKind } from "./journeys.js"
