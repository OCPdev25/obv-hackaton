/**
 * Programmatic surface for cross-review adapters and CI wiring:
 * adapter types, corpus loading, and the runner — without the CLI.
 */
export type {
  CandidateAdapter,
  CreateEntryInput,
  CreateEntryResult,
  EntryStatus,
  EventCategory,
  WireEntry,
  WireEvent,
} from './adapter.ts'
export { loadFixtures, type Fixture } from './fixtures.ts'
export { runCorpus, type FixtureResult, type RunSummary } from './runner.ts'
