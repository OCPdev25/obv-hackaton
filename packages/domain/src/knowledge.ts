import { Schema } from "effect"
import { convexId } from "./ids.js"
import { EntryVisibility } from "./entry.js"

/**
 * Family knowledge — source-attributed understanding about a child, kept
 * deliberately SEPARATE from logged events (`./event.ts`).
 *
 * Events are dated occurrences extracted from a transcript. Knowledge items
 * are durable statements — settling preferences, routines, verbatim quotes,
 * preferences — that persist, change over time, and sometimes contradict
 * each other. The design guarantees:
 *
 * - **Source attribution.** Every item records who stated it (`statedBy`),
 *   who captured it (`recordedBy`), how it is vouched for
 *   (`provenanceKind` + `confidence`), and where it came from
 *   (`sourceType` + source reference, with an optional verbatim
 *   `sourceQuote` and character `sourceSpan`). Raw sources are never
 *   destroyed or edited.
 * - **Append-only lifecycle.** Corrections and changing preferences never
 *   overwrite. A new item supersedes the old one via `supersedes`; the old
 *   item flips to `status: "superseded"` with `validUntil` set. The full
 *   chain stays readable forever.
 * - **Conflict tolerance.** Two `current` items on the same `topic` may
 *   disagree (e.g. mom and dad report different bedtimes). Both survive with
 *   their own attribution; conflict is surfaced by query as a read model —
 *   never silently merged, never resolved by overwrite. A resolution is
 *   itself a superseding append.
 * - **Audience-free by contract (v0.2).** `visibility` is the per-item
 *   publication state ONLY, mirroring `Entry`. WHO may read a published item
 *   resolves from household/relationship grants and is never stored here —
 *   no fused status/audience enum, no audience field.
 * - **Not medical.** The kind union is closed and intentionally contains no
 *   health/medical category. Extraction must not emit diagnoses or inferred
 *   medical conclusions; health-adjacent statements may only be captured in
 *   the caregiver's own words, cited to their source.
 *
 * Brief-to-model map:
 *   settling preferences  -> kind "settling"
 *   routines              -> kind "routine" (ordered `steps`)
 *   funny quotes          -> kind "quote" (verbatim `quoteText`)
 *   changing preferences  -> a new preference/settling item that
 *                            `supersedes` the old one (status + validUntil)
 *   conflicting reports   -> >= 2 `current` items sharing a `topic`, each
 *                            attributed to its own source
 */

/** Closed knowledge taxonomy. Extending it is a contract-thread decision. */
export const KnowledgeKind = Schema.Literals(["settling", "routine", "quote", "preference"])
export type KnowledgeKind = typeof KnowledgeKind["Type"]

/** Lifecycle state: items are appended, superseded, and never overwritten. */
export const KnowledgeStatus = Schema.Literals(["current", "superseded"])
export type KnowledgeStatus = typeof KnowledgeStatus["Type"]

/**
 * How the statement is vouched for. `caregiver-confirmed` items carry
 * confidence exactly 1 (the contract's "1 = caregiver-confirmed");
 * `caregiver-stated` and `model-extracted` items always sit below 1 — a
 * model guess may never claim a caregiver's certainty.
 */
export const KnowledgeProvenanceKind = Schema.Literals(["caregiver-stated", "caregiver-confirmed", "model-extracted"])
export type KnowledgeProvenanceKind = typeof KnowledgeProvenanceKind["Type"]

/** Where the statement came from. */
export const KnowledgeSourceType = Schema.Literals(["entry", "conversation", "manual"])
export type KnowledgeSourceType = typeof KnowledgeSourceType["Type"]

/** Character offsets into the preserved raw source text. */
export const KnowledgeSourceSpan = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
})
export type KnowledgeSourceSpan = typeof KnowledgeSourceSpan["Type"]

export const KnowledgeFields = {
  householdId: convexId("households"),
  childId: convexId("children"),
  kind: KnowledgeKind,
  /**
   * Stable grouping key for topic queries, preference history, and conflict
   * detection (e.g. "bedtime", "vegetables-broccoli"). Lowercase kebab-case
   * slug — see `assertKnowledgeInvariants`.
   */
  topic: Schema.NonEmptyString,
  /**
   * The knowledge itself, in plain words. For health-adjacent matters this
   * stays in the caregiver's own words — never a model-inferred conclusion.
   */
  statement: Schema.NonEmptyString,
  /** kind "quote" only: the verbatim words worth keeping. */
  quoteText: Schema.optional(Schema.NonEmptyString),
  /**
   * kind "quote" only: who spoke the words. The reserved string "child"
   * denotes the child; anything else is a caregiver's external identity.
   */
  spokenBy: Schema.optional(Schema.String),
  /** kind "routine" only: the ordered steps as the family performs them. */
  steps: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  status: KnowledgeStatus,
  /** The knowledge item this one replaces (append-only supersession). */
  supersedes: Schema.optional(convexId("knowledge")),
  /** Epoch ms — when this statement became valid/known. */
  validFrom: Schema.Number,
  /** Epoch ms — set exactly when the item is superseded. */
  validUntil: Schema.optional(Schema.Number),
  /** External identity of the person whose statement this is ("child" for a child's words reported by a caregiver). */
  statedBy: Schema.NonEmptyString,
  /** External identity of whoever captured the item; "extraction-model" for machine capture. */
  recordedBy: Schema.NonEmptyString,
  provenanceKind: KnowledgeProvenanceKind,
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  sourceType: KnowledgeSourceType,
  /** sourceType "entry": the journal entry whose transcript contains the source. */
  sourceEntryId: Schema.optional(convexId("entries")),
  /** sourceType "conversation": external conversation/message reference. */
  sourceRef: Schema.optional(Schema.String),
  /** Optional character span of the source text the item was drawn from. */
  sourceSpan: Schema.optional(KnowledgeSourceSpan),
  /** Optional verbatim snippet of the source text — raw wording is preserved. */
  sourceQuote: Schema.optional(Schema.NonEmptyString),
  /** Per-item publication state ONLY (contract v0.2). Audience resolves from grants. */
  visibility: EntryVisibility,
  /** Epoch ms — when the item was written down. */
  createdAt: Schema.Number,
} satisfies Schema.Struct.Fields

export const KnowledgeSchema = Schema.Struct(KnowledgeFields)
export type Knowledge = typeof KnowledgeSchema["Type"]

/** Knowledge table view plus Convex system fields. */
export const KnowledgeDocumentFields = {
  ...KnowledgeFields,
  _id: convexId("knowledge"),
  _creationTime: Schema.Number,
} satisfies Schema.Struct.Fields
export const KnowledgeDocument = Schema.Struct(KnowledgeDocumentFields)
export type KnowledgeDocument = typeof KnowledgeDocument["Type"]

/** Thrown when a decoded item violates the cross-field knowledge rules. */
export class KnowledgeShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "KnowledgeShapeError"
  }
}

const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const MODEL_RECORDER = "extraction-model"

/**
 * Cross-field invariants that a flat `Schema.Struct` cannot express on the
 * pinned Effect v4 RC (and that must stay inside the adapter's supported
 * vocabulary for Convex derivation). The schema validates shape; this
 * validates the family-knowledge contract on top of it. Runs on decoded
 * items — accept `KnowledgeDocument` too so self-supersession can be caught.
 */
export const assertKnowledgeInvariants = (item: Knowledge | KnowledgeDocument): void => {
  const fail = (message: string): never => {
    throw new KnowledgeShapeError(message)
  }

  // Normalized topics keep grouping, history, and conflict detection reliable.
  if (!TOPIC_PATTERN.test(item.topic)) {
    fail(`topic must be a lowercase kebab-case slug, got ${JSON.stringify(item.topic)}`)
  }

  // kind-conditional structure.
  if (item.kind === "quote") {
    if (item.quoteText === undefined) fail('kind "quote" requires quoteText (the verbatim words)')
    if (item.spokenBy === undefined) fail('kind "quote" requires spokenBy ("child" or a caregiver identity)')
    if (item.steps !== undefined) fail('kind "quote" must not carry steps')
  } else {
    if (item.quoteText !== undefined) fail(`quoteText is only valid for kind "quote" (kind is "${item.kind}")`)
    if (item.spokenBy !== undefined) fail(`spokenBy is only valid for kind "quote" (kind is "${item.kind}")`)
    if (item.kind === "routine") {
      if (item.steps === undefined) fail('kind "routine" requires steps (an ordered, non-empty list)')
      else if (item.steps.length === 0) fail('kind "routine" steps must be non-empty')
    } else if (item.steps !== undefined) {
      fail(`steps are only valid for kind "routine" (kind is "${item.kind}")`)
    }
  }

  // Lifecycle: supersession is append-only and explicit.
  if (item.status === "superseded") {
    if (item.validUntil === undefined) fail('status "superseded" requires validUntil (when the item stopped being current)')
  } else if (item.validUntil !== undefined) {
    fail('status "current" must not carry validUntil — supersede the item instead of closing it')
  }
  if (item.validUntil !== undefined && item.validUntil < item.validFrom) {
    fail("validUntil must not precede validFrom")
  }
  if ("_id" in item && item.supersedes === item._id) {
    fail("an item cannot supersede itself")
  }

  // Provenance/confidence partition: 1 is reserved for caregiver confirmation.
  if (item.provenanceKind === "caregiver-confirmed") {
    if (item.confidence !== 1) fail('provenanceKind "caregiver-confirmed" requires confidence exactly 1')
    if (item.recordedBy === MODEL_RECORDER) {
      fail('provenanceKind "caregiver-confirmed" cannot be recorded by "extraction-model"')
    }
  } else {
    if (item.confidence >= 1) {
      fail(`provenanceKind "${item.provenanceKind}" requires confidence < 1 (1 is reserved for caregiver-confirmed)`)
    }
    if (item.recordedBy === MODEL_RECORDER && item.provenanceKind !== "model-extracted") {
      fail(`recordedBy "${MODEL_RECORDER}" requires provenanceKind "model-extracted"`)
    }
    if (item.sourceType === "manual") {
      fail('provenanceKind "model-extracted" and "caregiver-stated" items cannot come from a "manual" source')
    }
  }

  // Source attribution: the item must point back at where it came from.
  if (item.sourceType === "entry") {
    if (item.sourceEntryId === undefined) fail('sourceType "entry" requires sourceEntryId')
    if (item.sourceRef !== undefined) fail('sourceType "entry" must not carry sourceRef')
  } else if (item.sourceType === "conversation") {
    if (item.sourceRef === undefined) fail('sourceType "conversation" requires sourceRef')
    if (item.sourceEntryId !== undefined) fail('sourceType "conversation" must not carry sourceEntryId')
  } else {
    // manual: deliberate human authorship — no extraction involved.
    if (item.sourceEntryId !== undefined || item.sourceRef !== undefined) {
      fail('sourceType "manual" must not carry sourceEntryId or sourceRef')
    }
    if (item.recordedBy === MODEL_RECORDER) {
      fail(`sourceType "manual" cannot be recorded by "${MODEL_RECORDER}"`)
    }
    if (item.provenanceKind !== "caregiver-confirmed") {
      fail('sourceType "manual" requires provenanceKind "caregiver-confirmed" (direct human authorship)')
    }
  }
  if (item.sourceSpan !== undefined) {
    if (item.sourceType === "manual") fail('sourceType "manual" has no source span')
    if (item.sourceSpan.end < item.sourceSpan.start) fail("sourceSpan.end must not precede sourceSpan.start")
  }

  // Audience is deliberately not stored on the item (contract v0.2): the
  // schema rejects fused visibility values, and who may read a published
  // item resolves from household/relationship grants — nothing to check here.
}
