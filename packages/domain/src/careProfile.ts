import { Schema } from "effect"
import { convexId } from "./ids.js"
import { EntryVisibility } from "./entry.js"
import { KnowledgeSourceType, KnowledgeSourceSpan } from "./knowledge.js"

/**
 * CareProfile (contract v0.4 — Gil settlement 2, 2026-09-17). Standing care
 * context for ONE child — allergies, nap schedules, emergency info — as a
 * first-class contract area so handoffs and digests (slots 23/24) and the
 * drowsy-caregiver surface can read it without re-deriving it from journal
 * entries. Household-visible per existing membership rules: audience is
 * NEVER stored on the item (same v0.2 posture as `Entry` and `Knowledge`).
 *
 * Family-knowledge structures reused, not reinvented: each profile item is a
 * source-attributed statement with `statedBy`/`recordedBy`, provenance,
 * source reference, and append-only supersession (`supersedes` + `status` +
 * `validFrom`/`validUntil`) — the exact lifecycle `Knowledge` uses.
 *
 * Caregiver-confirmed only, by settlement: the profile is built STRICTLY on
 * explicit caregiver-confirmed information, and medical facts are never
 * inferred automatically. Both rules bind at the SCHEMA level —
 * `CareProfileProvenance` omits `model-extracted` from the union (a
 * model-proposed item cannot even encode), and the invariants reject the
 * extraction model as recorder. Health-adjacent content stays in the
 * caregiver's own words (`statement`/`sourceQuote`); the area union is
 * closed and deliberately contains no diagnosis/medical area.
 */

/** Closed care-profile areas, exactly the settled three. Extending is a contract-thread decision. */
export const CareProfileArea = Schema.Literals(["allergy", "nap-schedule", "emergency"])
export type CareProfileArea = typeof CareProfileArea["Type"]

/**
 * How the statement is vouched for — the `KnowledgeProvenanceKind` union
 * MINUS `model-extracted`: standing care context is caregiver-stated or
 * caregiver-confirmed, never machine-inferred. Confidence keeps the
 * knowledge partition (1 is reserved for caregiver-confirmed).
 */
export const CareProfileProvenance = Schema.Literals(["caregiver-stated", "caregiver-confirmed"])
export type CareProfileProvenance = typeof CareProfileProvenance["Type"]

/** Lifecycle state: append-only supersession, never overwrite. */
export const CareProfileStatus = Schema.Literals(["current", "superseded"])
export type CareProfileStatus = typeof CareProfileStatus["Type"]

export const CareProfileFields = {
  householdId: convexId("households"),
  childId: convexId("children"),
  area: CareProfileArea,
  /** The standing fact, in the caregiver's own words (verbatim for health-adjacent matters). */
  statement: Schema.NonEmptyString,
  status: CareProfileStatus,
  /** The care-profile item this one replaces (append-only supersession). */
  supersedes: Schema.optionalKey(convexId("care_profiles")),
  /** Epoch ms — when this statement became valid/known. */
  validFrom: Schema.Number,
  /** Epoch ms — set exactly when the item is superseded. */
  validUntil: Schema.optionalKey(Schema.Number),
  /** External identity of the person whose statement this is. */
  statedBy: Schema.NonEmptyString,
  /** External identity of whoever captured the item — never "extraction-model". */
  recordedBy: Schema.NonEmptyString,
  provenanceKind: CareProfileProvenance,
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  sourceType: KnowledgeSourceType,
  /** sourceType "entry": the journal entry whose transcript contains the source. */
  sourceEntryId: Schema.optionalKey(convexId("entries")),
  /** sourceType "conversation": external conversation/message reference. */
  sourceRef: Schema.optionalKey(Schema.String),
  /** Optional character span of the source text the item was drawn from. */
  sourceSpan: Schema.optionalKey(KnowledgeSourceSpan),
  /** Optional verbatim snippet of the source text — raw wording is preserved. */
  sourceQuote: Schema.optionalKey(Schema.NonEmptyString),
  /** Per-item publication state ONLY. Audience resolves from grants (v0.2 posture). */
  visibility: EntryVisibility,
  /** Epoch ms — when the item was written down. */
  createdAt: Schema.Number,
} satisfies Schema.Struct.Fields

export const CareProfileSchema = Schema.Struct(CareProfileFields)
export type CareProfile = typeof CareProfileSchema["Type"]

/** Care-profile table view plus Convex system fields (the `care_profiles` table). */
export const CareProfileDocumentFields = {
  ...CareProfileFields,
  _id: convexId("care_profiles"),
  _creationTime: Schema.Number,
} satisfies Schema.Struct.Fields
export const CareProfileDocument = Schema.Struct(CareProfileDocumentFields)
export type CareProfileDocument = typeof CareProfileDocument["Type"]

/** Thrown when a decoded item violates the cross-field care-profile rules. */
export class CareProfileShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CareProfileShapeError"
  }
}

const MODEL_RECORDER = "extraction-model"

/**
 * Cross-field invariants a flat `Schema.Struct` cannot express on the pinned
 * Effect v4 RC (same pattern as `assertKnowledgeInvariants`): the schema
 * validates shape, this validates the care-profile contract on top of it.
 * Runs on decoded items — accepts `CareProfileDocument` so self-supersession
 * can be caught.
 */
export const assertCareProfileInvariants = (item: CareProfile | CareProfileDocument): void => {
  const fail = (message: string): never => {
    throw new CareProfileShapeError(message)
  }

  // Caregiver-confirmed only (settled): the extraction model never writes
  // standing care context, and never records it.
  if (item.recordedBy === MODEL_RECORDER) {
    fail(`recordedBy "${MODEL_RECORDER}" is forbidden on care-profile items (no automatic inference)`)
  }

  // Provenance/confidence partition: 1 is reserved for caregiver confirmation.
  if (item.provenanceKind === "caregiver-confirmed") {
    if (item.confidence !== 1) fail('provenanceKind "caregiver-confirmed" requires confidence exactly 1')
  } else if (item.confidence >= 1) {
    fail(`provenanceKind "${item.provenanceKind}" requires confidence < 1 (1 is reserved for caregiver-confirmed)`)
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
    if (item.provenanceKind !== "caregiver-confirmed") {
      fail('sourceType "manual" requires provenanceKind "caregiver-confirmed" (direct human authorship)')
    }
  }
  if (item.sourceSpan !== undefined) {
    if (item.sourceType === "manual") fail('sourceType "manual" has no source span')
    if (item.sourceSpan.end < item.sourceSpan.start) fail("sourceSpan.end must not precede sourceSpan.start")
  }
}
