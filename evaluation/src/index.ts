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
export { loadFixtures, assertFixture, type Fixture } from './fixtures.ts'
export { runCorpus, type FixtureResult, type RunSummary } from './runner.ts'
export {
  FIXTURE_CLASSES,
  MANIFEST_FILENAME,
  loadManifest,
  resolveFixtureAreas,
  type FixtureAreaEntry,
  type FixtureAreaManifest,
  type FixtureClass,
  type FixtureClassSpec,
  type RegisteredArea,
  type ResolvedManifest,
  type RunnerBinding,
} from './manifest.ts'
