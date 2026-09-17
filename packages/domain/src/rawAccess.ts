import { Schema } from "effect"
import { convexId } from "./ids.js"
import { EntryFields, EntrySchema } from "./entry.js"

/**
 * Raw-access-by-grant (contract v0.4 — Gil settlement 3, 2026-09-17). The
 * visibility DEFAULT for verbatim capture content: members of OTHER
 * households see STRUCTURED ENTRIES ONLY; the verbatim raw transcript is
 * reachable through an explicit grant, and the absence of a grant IS the
 * denial (default-off, by record — slot 20 enforcement binds to this schema,
 * not convention).
 *
 * Dimension separation (settled): a grant is NOT publication state and NOT
 * audience — those live on `Entry.visibility` and in household/relationship
 * grants respectively, and this record carries neither. It is a third,
 * independent dimension: permission to read the verbatim source of one
 * child's entries, granted by a caregiver of the child's household, and
 * revocable by appending the revocation to the same record.
 */

/** Where the viewer stands relative to the entry-owning household. Resolves from membership (app side). */
export const RawViewerRelation = Schema.Literals(["same-household", "cross-household"])
export type RawViewerRelation = typeof RawViewerRelation["Type"]

/** Grant lifecycle: an active grant authorizes; a revocation closes it. Never deleted. */
export const RawAccessGrantStatus = Schema.Literals(["granted", "revoked"])
export type RawAccessGrantStatus = typeof RawAccessGrantStatus["Type"]

export const RawAccessGrantFields = {
  /** The household whose entries the grant opens (the granting side). */
  householdId: convexId("households"),
  childId: convexId("children"),
  /** External identity of the viewer being granted raw-transcript access. */
  granteeId: Schema.NonEmptyString,
  /** External identity of the granting caregiver. */
  grantedBy: Schema.NonEmptyString,
  status: RawAccessGrantStatus,
  /** Epoch ms — when the grant was made. */
  grantedAt: Schema.Number,
  /** Epoch ms — set exactly when the grant is revoked. */
  revokedAt: Schema.optionalKey(Schema.Number),
  /** Optional caregiver-provided context, in their own words. */
  detail: Schema.optionalKey(Schema.NonEmptyString),
  /** Epoch ms — when the grant record was written. */
  createdAt: Schema.Number,
} satisfies Schema.Struct.Fields

export const RawAccessGrantSchema = Schema.Struct(RawAccessGrantFields)
export type RawAccessGrant = typeof RawAccessGrantSchema["Type"]

/** Grant table view plus Convex system fields (the `raw_access_grants` table). */
export const RawAccessGrantDocumentFields = {
  ...RawAccessGrantFields,
  _id: convexId("raw_access_grants"),
  _creationTime: Schema.Number,
} satisfies Schema.Struct.Fields
export const RawAccessGrantDocument = Schema.Struct(RawAccessGrantDocumentFields)
export type RawAccessGrantDocument = typeof RawAccessGrantDocument["Type"]

/** Thrown when a decoded grant violates the cross-field grant rules. */
export class RawAccessGrantShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RawAccessGrantShapeError"
  }
}

/**
 * Cross-field grant lifecycle rules (same pattern as
 * `assertKnowledgeInvariants`): a granted record carries no revocation, a
 * revoked record carries its revocation timestamp, and revocation cannot
 * precede the grant.
 */
export const assertRawAccessGrantInvariants = (grant: RawAccessGrant | RawAccessGrantDocument): void => {
  const fail = (message: string): never => {
    throw new RawAccessGrantShapeError(message)
  }
  if (grant.status === "revoked") {
    if (grant.revokedAt === undefined) fail('status "revoked" requires revokedAt (when the grant was closed)')
  } else if (grant.revokedAt !== undefined) {
    fail('status "granted" must not carry revokedAt — revoke the grant instead of voiding it')
  }
  if (grant.revokedAt !== undefined && grant.revokedAt < grant.grantedAt) {
    fail("revokedAt must not precede grantedAt")
  }
}

/** An active grant is one whose status is granted — revocation is a schema-enforced absence. */
export const isGrantActive = (grant: RawAccessGrant): boolean => grant.status === "granted"

/**
 * The default-off rule slot 20 enforces. Same-household membership reads raw
 * transcripts under the existing household rules; a cross-household viewer
 * needs an ACTIVE grant for that child — absence of a grant is the denial.
 */
export const rawTranscriptVisible = (
  relation: RawViewerRelation,
  grant: RawAccessGrant | undefined
): boolean => relation === "same-household" || (grant !== undefined && isGrantActive(grant))

/**
 * The cross-household projection: an entry WITHOUT its verbatim transcript —
 * what a cross-household viewer receives by default. Derived from
 * `EntryFields` so the projection tracks the entry contract; only the
 * verbatim field is removed. Verbatim content reaches a cross-household
 * viewer only through the `rawTranscriptVisible` path above.
 */
const { rawTranscript: _rawTranscript, ...structuredEntryViewFields } = EntryFields
export const StructuredEntryView = Schema.Struct(structuredEntryViewFields)
export type StructuredEntryView = typeof StructuredEntryView["Type"]

/**
 * Convenience: project a decoded entry down to the cross-household view. The
 * full wire shape is decoded through `StructuredEntryView`, which strips the
 * verbatim transcript as an excess key — the projection drops the field by
 * construction, not by convention.
 */
export const toStructuredEntryView = (entry: typeof EntrySchema["Type"]): StructuredEntryView =>
  Schema.decodeUnknownSync(StructuredEntryView)(Schema.encodeSync(EntrySchema)(entry))
