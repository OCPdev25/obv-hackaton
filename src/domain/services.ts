/**
 * Service interfaces — the only seam between the state machine and effects.
 *
 * Effect v4 Context.Service declares each service with the interpreter's
 * requirements; composition roots (the Expo app, the E2E script, tests)
 * provide live or controlled implementations via Effect.provideService.
 * There is deliberately NO default implementation: yielding an unprovided
 * service is a composition error and fails loudly at the boundary.
 */
import { Context, type Effect } from "effect"
import type { CaptureId, CaregiverId, Entry, Event, PublishOutput, Transcript } from "./schema.js"

// ---------------------------------------------------------------------------
// Extraction — turns a raw transcript into schema-validated events.
// Failures are DATA (ExtractionOutcome), not an error channel: a malformed
// extraction is a reviewable outcome, and the raw transcript is preserved in
// state either way. The live LLM implementation is intentionally not wired in
// this candidate (no cloud calls) — see src/services/extraction.ts for the
// labeled absence.
// NOTE: Context.Reference (default-carrying) has Identifier=never, which makes
// provideService's Exclude a type-level no-op — Context.Service keys are what
// narrow the R channel. A missing service fails loudly at runtime instead.
// ---------------------------------------------------------------------------

export interface ExtractionRequest {
  readonly captureId: CaptureId
  readonly transcript: Transcript
  readonly authorId: CaregiverId
}

export type ExtractionOutcome =
  | { readonly ok: true; readonly events: ReadonlyArray<Event> }
  | { readonly ok: false; readonly reason: string }

export interface ExtractionApi {
  readonly extract: (request: ExtractionRequest) => Effect.Effect<ExtractionOutcome>
}

export const ExtractionService = Context.Service<ExtractionApi>("journal/ExtractionService")

// ---------------------------------------------------------------------------
// Capture repository — durable, idempotent publication of an Entry.
// Live implementation: Convex-backed (real persistence against the local dev
// backend). Controlled test implementation: in-memory, mirroring the server's
// captureId idempotency contract.
// ---------------------------------------------------------------------------

export type RepositoryErrorReason = "validation" | "transport" | "unknown"

export interface RepositoryError {
  readonly reason: RepositoryErrorReason
  readonly detail: string
}

export interface CaptureRepositoryApi {
  readonly publish: (entry: Entry) => Effect.Effect<PublishOutput, RepositoryError>
}

export const CaptureRepositoryService = Context.Service<CaptureRepositoryApi>("journal/CaptureRepository")
