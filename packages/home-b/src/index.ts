/**
 * @journal/home-b — Candidate B: Today feed-first parent home with a
 * persistent conversational composer (synthetic data, in-memory store).
 *
 * Candidate B of the parent-home A/B comparison. No live Convex, no LLM.
 */
export { HomeBStore } from "./store.js"
export type {
  ApplyResultResult,
  AudienceResult,
  CatchUpResult,
  CorrectEventInput,
  CorrectEventResult,
  EventCorrection,
  EventDetailResult,
  EventDetailView,
  ExtractionAttemptRecord,
  FeedEventView,
  FeedFilter,
  FeedResult,
  Member,
  MonthSummary,
  PublishResult,
  RawSourceResult,
  RerunResult,
  StoreOptions,
  SubmitCaptureInput,
  SubmitCaptureResult,
  UpdateProposedResult,
  WorldSeed,
} from "./store.js"
export type { CaptureChannel } from "./store.js"
export { evaluateAccess, type Action, type AudienceIntent, type Decision, type Principal, type Resource } from "./auth.js"
export { extractProposedEvents, type CaptureContext, type ExtractionOutcome } from "./extractionDouble.js"
export type { DroppedClause } from "./extractionDouble.js"
export { HOUSEHOLD_TIMEZONE, wallDateOf, wallToUtc, DEMO_NOW, type WallDate } from "./time.js"
export { nextIdFrom } from "./ids.js"
export {
  buildChildren,
  buildHousehold,
  buildMembers,
  CHILD_IRIS,
  CHILD_MILO,
  DEMO_MONTH,
  HOUSEHOLD_ID,
  OUTSIDER,
  PERSONAS,
  principalOf,
  seedStore,
  type DemoPersona,
  type SeedResult,
} from "./fixtures.js"
