import { Schema } from "effect"
import { convexId } from "./ids.js"
import { EventCategory } from "./event.js"
import { ProvenanceSource } from "./contextEnvelope.js"

/**
 * Operation-output contracts (contract v0.3 — art_lyBemdV9 §4). Extraction,
 * conversational answer, and authorized execution are distinct operations
 * that share the `ContextEnvelope`; their outputs are a CLOSED tagged union:
 * a question can only produce `question-intent` (no write payload exists on
 * that member), a write exists only as an inert `write-proposal` until
 * `Authorization` executes it, and a correction with no identifiable target
 * produces `unresolved-reference` — never a guess.
 *
 * Discrimination (adaptation A1): the merged scaffold's wire format is
 * tagless and Convex outlaws underscore-prefixed stored fields, so the
 * proposal's `_tag` values live on as an explicit `outcome` literal field —
 * the same strings, a Convex-storable shape, and a proper discriminated
 * union in TypeScript.
 */

/**
 * A pre-Entry extraction candidate: honest about resolution precision (a
 * window, not a point) and about HOW each resolution was made. Never decodes
 * as a contract `Event` — that decode happens only after review/authorization.
 */
export const EventCandidate = Schema.Struct({
  category: EventCategory,
  occurredAtWindow: Schema.Struct({
    /** Unix ms on the wire. */
    from: Schema.Number,
    to: Schema.Number,
  }),
  quantity: Schema.optionalKey(
    Schema.Struct({
      value: Schema.Number,
      unit: Schema.optionalKey(Schema.String),
    })
  ),
  childId: convexId("children"),
  authorId: Schema.String,
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  /** Provenance of the RESOLUTION per field — e.g. "she" -> selected child is app-known; "an hour" is user-asserted. */
  resolution: Schema.Struct({
    child: ProvenanceSource,
    time: ProvenanceSource,
    quantity: ProvenanceSource,
  }),
})
export type EventCandidate = typeof EventCandidate["Type"]

export const FactCandidates = Schema.Struct({
  outcome: Schema.Literals(["fact-candidates"]),
  envelopeId: Schema.NonEmptyString,
  candidates: Schema.Array(EventCandidate),
})
export type FactCandidates = typeof FactCandidates["Type"]

/** Read scope only — no write payload exists on this member. */
export const QuestionIntent = Schema.Struct({
  outcome: Schema.Literals(["question-intent"]),
  envelopeId: Schema.NonEmptyString,
  readScope: Schema.Struct({
    householdId: convexId("households"),
    childId: Schema.optionalKey(convexId("children")),
    window: Schema.Struct({
      from: Schema.Number,
      to: Schema.Number,
    }),
  }),
})
export type QuestionIntent = typeof QuestionIntent["Type"]

/** Inert until `Authorization` executes it; `execute` is idempotent on `proposalHash`. */
export const WriteProposal = Schema.Struct({
  outcome: Schema.Literals(["write-proposal"]),
  proposalId: Schema.NonEmptyString,
  envelopeId: Schema.NonEmptyString,
  proposalType: Schema.Literals(["create", "correction"]),
  targetEventId: Schema.optionalKey(convexId("events")),
  draft: Schema.optionalKey(EventCandidate),
  changes: Schema.optionalKey(
    Schema.Struct({
      quantity: Schema.optionalKey(
        Schema.Struct({
          value: Schema.Number,
          unit: Schema.optionalKey(Schema.String),
        })
      ),
    })
  ),
  status: Schema.Literals(["proposed", "authorized", "executed", "rejected", "superseded"]),
  proposalHash: Schema.NonEmptyString,
})
export type WriteProposal = typeof WriteProposal["Type"]

/** An extraction that needed absent context — it may not proceed on a guess. */
export const UnresolvedReference = Schema.Struct({
  outcome: Schema.Literals(["unresolved-reference"]),
  envelopeId: Schema.NonEmptyString,
  reason: Schema.Literals(["no-reference", "cross-child-blocked", "target-not-visible", "ambiguous"]),
  detail: Schema.optionalKey(Schema.NonEmptyString),
})
export type UnresolvedReference = typeof UnresolvedReference["Type"]

export const ExtractionOutcome = Schema.Union([
  FactCandidates,
  QuestionIntent,
  WriteProposal,
  UnresolvedReference,
])
export type ExtractionOutcome = typeof ExtractionOutcome["Type"]

/** Answer operation output: reads only, household-scoped; citations name every record read. */
export const Answered = Schema.Struct({
  envelopeId: Schema.NonEmptyString,
  response: Schema.NonEmptyString,
  citations: Schema.Array(
    Schema.Struct({
      recordId: Schema.NonEmptyString,
      recordKind: Schema.Literals(["entry", "event", "message"]),
    })
  ),
})
export type Answered = typeof Answered["Type"]

/**
 * Execute input — the ONLY path that mutates. `execute` verifies
 * `authorizedBy` is the envelope actor (or a parent) and is idempotent on
 * `proposalHash`: a second authorization of the same hash is a recorded
 * no-op.
 */
export const Authorization = Schema.Struct({
  proposalId: Schema.NonEmptyString,
  proposalHash: Schema.NonEmptyString,
  authorizedBy: Schema.String,
})
export type Authorization = typeof Authorization["Type"]
