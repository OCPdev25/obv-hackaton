import { Schema } from "effect"
import { convexId } from "./ids.js"

/**
 * Retraction (contract v0.4 — Gil settlement 1, 2026-09-17). A published
 * entry can be retracted as an APPEND-ONLY state change: the original entry
 * and every derived record stay at the storage layer, and the retraction is
 * recorded as a household-visible receipt — never an in-place edit or delete.
 *
 * Privacy posture: retracted content is HIDDEN FROM HOUSEHOLD QUERIES. The
 * exclusion is a query-path filter (see `RetractionFilter`), not deletion —
 * operator/lineage reads resolve through the receipt and remain reachable.
 *
 * Dimension separation (settled): the receipt carries NO audience field and
 * NO publication-state field. Publication state stays on `Entry.visibility`,
 * audience resolves from household/relationship grants, and a retraction is
 * its own append-only state change on top of both.
 */

/**
 * The append-only retraction record — the household-visible receipt. A
 * receipt exists exactly once per retraction; retracting an already-retracted
 * entry is a storage-layer no-op, not a second receipt. There is no
 * "unretract": reversing a retraction is a new contract decision, not a
 * mutation of this record.
 */
export const RetractionReceiptFields = {
  householdId: convexId("households"),
  childId: convexId("children"),
  /** The retracted entry. The original row is retained at the storage layer. */
  entryId: convexId("entries"),
  /** External identity of the caregiver who retracted the entry. */
  retractedBy: Schema.NonEmptyString,
  /** Epoch ms — when the receipt was appended. */
  retractedAt: Schema.Number,
  /** Optional caregiver-provided context for the retraction, in their own words. */
  detail: Schema.optionalKey(Schema.NonEmptyString),
} satisfies Schema.Struct.Fields

export const RetractionReceiptSchema = Schema.Struct(RetractionReceiptFields)
export type RetractionReceipt = typeof RetractionReceiptSchema["Type"]

/** Receipt table view plus Convex system fields (the `retractions` table). */
export const RetractionReceiptDocumentFields = {
  ...RetractionReceiptFields,
  _id: convexId("retractions"),
  _creationTime: Schema.Number,
} satisfies Schema.Struct.Fields
export const RetractionReceiptDocument = Schema.Struct(RetractionReceiptDocumentFields)
export type RetractionReceiptDocument = typeof RetractionReceiptDocument["Type"]

/**
 * Retraction filter hook (contract v0.4) — embedded by household-facing
 * query inputs (agent queries in slots 15/17/23/24, timeline reads). ABSENT
 * means the household default: retracted entries are EXCLUDED. The only way
 * a query may include them is an explicit operator scope — an
 * operator/lineage read, never a household view.
 */
export const RetractionFilter = Schema.Struct({
  retractionScope: Schema.optionalKey(Schema.Literals(["household", "operator"])),
})
export type RetractionFilter = typeof RetractionFilter["Type"]

/**
 * The query-path exclusion rule the filter encodes. Absent filter or
 * household scope both mean EXCLUDE retracted entries — the privacy posture
 * is the default, not an opt-in.
 */
export const excludesRetracted = (filter: RetractionFilter | undefined): boolean =>
  (filter?.retractionScope ?? "household") === "household"
