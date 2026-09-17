import { Schema } from "effect"

/**
 * Ambiguous references + correction-driven answer invalidation (spike slice 1).
 *
 * Contract source: art_gCDrtx4S — "Remember & Retrieve — Ambiguous References
 * & Correction Invalidation (proposal v0.1)" §3 (schema deltas) and §5–6
 * (fixture cases). Cross-area constraints: art_gfwpdmWF §3 (v0.4 fold
 * reconciliation) and §6 (executable slice queue, slice 1).
 *
 * RECONCILIATION (v0.4 fold, per art_gfwpdmWF §3.3): this module restates
 * minimal envelope equivalents instead of importing packages/domain — the
 * spike must not couple to the canonical domain package while lanes are in
 * flight. Every restated export below is drop-in replaced by the folded
 * domain module (packages/domain/src/contextEnvelope.ts, operations.ts) at
 * the fold; the fold home for the NEW schemas is
 * packages/domain/src/clarifyAnswer.ts.
 */

/**
 * RECONCILIATION: restated from packages/domain/src/ids.ts (same bytes) so
 * the spike stays import-free; the fold imports the canonical helper.
 */
export const CONVEX_TABLE_ANNOTATION = "convexTable"

export const convexId = (table: string) => Schema.String.annotate({ [CONVEX_TABLE_ANNOTATION]: table })

// ---- restated envelope id fields (art_gCDrtx4S §3 "imported, not redefined") ----

export const EnvelopeId = Schema.NonEmptyString
export type EnvelopeId = typeof EnvelopeId["Type"]

export const RecordId = Schema.NonEmptyString
export type RecordId = typeof RecordId["Type"]

/** Restated verbatim from packages/domain/src/contextEnvelope.ts. */
export const ProvenanceSource = Schema.Literals(["user-asserted", "app-known", "inferred"])
export type ProvenanceSource = typeof ProvenanceSource["Type"]

export const Actor = Schema.Struct({
  authorId: Schema.String,
  role: Schema.Literals(["parent", "caregiver"]),
})
export type Actor = typeof Actor["Type"]

export const ProvenancedChild = Schema.Struct({
  value: Schema.Struct({
    childId: convexId("children"),
    displayName: Schema.NonEmptyString,
  }),
  source: ProvenanceSource,
  basis: Schema.optionalKey(Schema.NonEmptyString),
})
export type ProvenancedChild = typeof ProvenancedChild["Type"]

export const ProvenancedView = Schema.Struct({
  value: Schema.Struct({
    screen: Schema.Literals(["capture", "timeline", "child-detail", "entry-detail"]),
    selectedRecord: Schema.optionalKey(
      Schema.Struct({
        recordId: Schema.NonEmptyString,
        recordKind: Schema.Literals(["entry", "event"]),
      })
    ),
  }),
  source: ProvenanceSource,
  basis: Schema.optionalKey(Schema.NonEmptyString),
})
export type ProvenancedView = typeof ProvenancedView["Type"]

/**
 * Restated PriorReference with one spike-local addition: `relatedChildId`.
 *
 * RECONCILIATION (flagged for slot 09 / the v0.4 fold): the landed envelope's
 * PriorReference carries no child association, but F-AX-CLARIFY-001's
 * expected outcome — options are the two in-scope CHILDREN derived from two
 * event references — is not derivable envelope-only without it. The clarify
 * reducer uses it to (a) offer child options for record references and
 * (b) apply the user-asserted currentChild tiebreaker. Whether references
 * carry child association is the fold's decision, not this spike's.
 */
export const PriorReference = Schema.Struct({
  referenceId: Schema.NonEmptyString,
  kind: Schema.Literals(["entry", "event", "message"]),
  targetId: RecordId,
  /** Spike-local enrichment — see comment above. */
  relatedChildId: Schema.optionalKey(RecordId),
  snippet: Schema.optionalKey(Schema.NonEmptyString),
  source: ProvenanceSource,
  visibleToActor: Schema.Boolean,
})
export type PriorReference = typeof PriorReference["Type"]

/**
 * Restated lite ContextEnvelope (packages/domain/src/contextEnvelope.ts) —
 * only the fields the clarify/answer reducers read. Replaced wholesale by
 * the domain module at the fold.
 */
export const ReferenceEnvelope = Schema.Struct({
  envelopeId: EnvelopeId,
  captureId: Schema.NonEmptyString,
  /** Unix ms on the wire. */
  capturedAt: Schema.Number,
  capturedAtTimezone: Schema.Struct({
    value: Schema.NonEmptyString,
    source: ProvenanceSource,
    basis: Schema.optionalKey(Schema.NonEmptyString),
  }),
  utterance: Schema.NonEmptyString,
  actor: Actor,
  /** Access-control root for every read. */
  householdId: convexId("households"),
  currentChild: Schema.optionalKey(ProvenancedChild),
  viewContext: Schema.optionalKey(ProvenancedView),
  references: Schema.optionalKey(Schema.Array(PriorReference)),
})
export type ReferenceEnvelope = typeof ReferenceEnvelope["Type"]

// ---- new branded ids (answer layer, art_gCDrtx4S §3) ----

export const AnswerId = Schema.NonEmptyString.pipe(Schema.brand("AnswerId"))
export type AnswerId = typeof AnswerId["Type"]

export const RevisionId = Schema.NonEmptyString.pipe(Schema.brand("RevisionId"))
export type RevisionId = typeof RevisionId["Type"]

/**
 * Household lineage watermark — the captureId+attempt pattern applied to the
 * corpus (art_gCDrtx4S §2.2). Bumped by every committed EventRevision;
 * version 0 is the uncorrected baseline.
 */
export const LineageWatermark = Schema.Struct({
  householdId: convexId("households"),
  version: Schema.Natural, // monotonic; 0 = corpus baseline, no revisions
})
export type LineageWatermark = typeof LineageWatermark["Type"]

// ---- focused clarification (bounded, read-scoped) ----

export const ClarifyOption = Schema.Struct({
  targetId: Schema.NonEmptyString, // a child or record already present in the envelope
  kind: Schema.Literals(["child", "entry", "event", "message"]),
  label: Schema.NonEmptyString, // display text drawn from the record's own fields
  provenance: ProvenanceSource, // which envelope field supplied this candidate
})
export type ClarifyOption = typeof ClarifyOption["Type"]

/**
 * Manual `_tag` literal instead of Schema.TaggedStruct — the tagged-struct
 * helper does not exist on effect@4.0.0-rc.115 (verified this session); the
 * wire shape is identical to the proposal's sketch.
 * RECONCILIATION: the folded domain uses an explicit `outcome` literal field
 * instead (Convex rejects underscore-prefixed stored fields, adaptation A1);
 * this spike is Convex-free, so the proposal's `_tag` wire shape stands.
 */
export const ClarifyQuestion = Schema.Struct({
  _tag: Schema.Literals(["clarify-question"]),
  envelopeId: EnvelopeId,
  question: Schema.NonEmptyString, // exactly one question; never open-ended
  options: Schema.Array(ClarifyOption), // operation invariant: 2–4 options, all envelope-derived
  ambiguousReferenceIds: Schema.Array(RecordId), // which envelope references the question disambiguates
})
export type ClarifyQuestion = typeof ClarifyQuestion["Type"]

/**
 * Resolved binding — the third ClarifyOutcome member. The proposal's
 * ClarifyOutcome union has two members (clarify-question |
 * unresolved-reference) because "one candidate is not a clarification — that
 * is the resolver's normal binding path"; this spike's reducer covers both
 * paths, so the binding is a union member with its provenance recorded
 * (art_gCDrtx4S §2.1 table, row 1). The fold decides whether `resolved`
 * joins the folded union or stays the resolver's separate return path.
 */
export const ResolvedBinding = Schema.Struct({
  _tag: Schema.Literals(["resolved"]),
  envelopeId: EnvelopeId,
  targetId: RecordId,
  kind: Schema.Literals(["child", "entry", "event", "message"]),
  provenance: ProvenanceSource,
  basis: Schema.optionalKey(Schema.NonEmptyString),
})
export type ResolvedBinding = typeof ResolvedBinding["Type"]

/**
 * Answer-layer unresolved-reference: the envelope shape (reason + detail)
 * plus the proposal's `retryable` flag (always false — only the user can
 * clear it, by supplying context with provenance `user-asserted`).
 * RECONCILIATION: the landed operations.ts member has no `retryable`; the
 * fold must settle one shape (art_gCDrtx4S §3 vs operations.ts adaptation).
 */
export const UnresolvedReference = Schema.Struct({
  _tag: Schema.Literals(["unresolved-reference"]),
  envelopeId: EnvelopeId,
  reason: Schema.Literals(["no-reference", "cross-child-blocked", "target-not-visible", "ambiguous"]),
  detail: Schema.optionalKey(Schema.NonEmptyString),
  retryable: Schema.Boolean,
})
export type UnresolvedReference = typeof UnresolvedReference["Type"]

export const ClarifyOutcome = Schema.Union([ResolvedBinding, ClarifyQuestion, UnresolvedReference])
export type ClarifyOutcome = typeof ClarifyOutcome["Type"]

// ---- revision citation link ----

export const RevisionLink = Schema.Struct({
  revisionId: RevisionId,
  targetRecordId: Schema.NonEmptyString, // the record the correction revises
  containingEntryId: Schema.optionalKey(Schema.NonEmptyString),
  /** Unix ms on the wire. */
  revisedAt: Schema.Number,
  summary: Schema.NonEmptyString, // slot 10's change summary, e.g. "quantity: 1 hour → 45 minutes"
})
export type RevisionLink = typeof RevisionLink["Type"]

// ---- Answered, additive delta (rule 2) ----

export const Citation = Schema.Struct({
  recordId: Schema.NonEmptyString,
  // 'revision' added per the proposal; the v0.4 fold unifies the vocabulary
  // to five kinds by adding 'knowledge' (art_gfwpdmWF §3.1).
  recordKind: Schema.Literals(["entry", "event", "message", "revision"]),
})
export type Citation = typeof Citation["Type"]

/**
 * Answered v0.2 — the proposal's five additive fields on the landed v0.3
 * shape (envelopeId, response, citations), keyed by
 * (envelopeId, readWatermark.version) for idempotent re-serve.
 */
export const Answered = Schema.Struct({
  _tag: Schema.Literals(["answered"]),
  envelopeId: EnvelopeId,
  response: Schema.NonEmptyString,
  citations: Schema.Array(Citation),
  // ---- additive (art_gCDrtx4S §3) ----
  answerId: AnswerId,
  readWatermark: LineageWatermark, // lineage observed at answer time
  status: Schema.Literals(["current", "superseded"]),
  supersededByRevisionId: Schema.optionalKey(RevisionId), // present iff status is 'superseded'
  revisionChain: Schema.optionalKey(Schema.Array(RevisionLink)), // present when read records carry corrections
})
export type Answered = typeof Answered["Type"]

// ---- tagged error union (answer layer) ----

export const WatermarkMoved = Schema.Struct({
  _tag: Schema.Literals(["watermark-moved"]),
  observedVersion: Schema.Natural,
  currentVersion: Schema.Natural,
  retryable: Schema.Boolean, // true — the system recomputes at the current watermark
})
export type WatermarkMoved = typeof WatermarkMoved["Type"]

export const ProviderFailure = Schema.Struct({
  _tag: Schema.Literals(["provider-failure"]),
  detail: Schema.optionalKey(Schema.NonEmptyString),
  retryable: Schema.Boolean, // true
})
export type ProviderFailure = typeof ProviderFailure["Type"]

export const MalformedModelOutput = Schema.Struct({
  _tag: Schema.Literals(["malformed-model-output"]),
  detail: Schema.optionalKey(Schema.NonEmptyString),
  retryable: Schema.Boolean, // false — deterministic on identical input
})
export type MalformedModelOutput = typeof MalformedModelOutput["Type"]

/**
 * AnswerError union (art_gCDrtx4S §3). Retryability per member is pinned by
 * the §4 table and asserted by the tests; the schemas stay permissive
 * (`Schema.Boolean`) exactly as the proposal wrote them.
 */
export const AnswerError = Schema.Union([
  UnresolvedReference,
  WatermarkMoved,
  ProviderFailure,
  MalformedModelOutput,
])
export type AnswerError = typeof AnswerError["Type"]
