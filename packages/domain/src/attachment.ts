import { Schema } from "effect"

/**
 * A binary attachment carried with a capture: an explicit photo or audio
 * recording the user attached (never ambient). One shape, two consumers —
 * `Entry.attachments` (operator-surface lineage proposal, art_rBKvvzIa §4)
 * and `ContextEnvelope.attachments` (context-envelope proposal, art_lyBemdV9
 * §2) — unified per the v0.3 delta (adaptation A10).
 *
 * `storageId` matches the existing `Entry.photoId` vocabulary: a Convex
 * storage document id, not a user-table reference. `bytes` is only bounded as
 * a number for now; the proposals defer a positive-integer tightening to
 * integration.
 */
export const Attachment = Schema.Struct({
  attachmentId: Schema.NonEmptyString,
  kind: Schema.Literals(["photo", "audio"]),
  storageId: Schema.NonEmptyString,
  sha256: Schema.NonEmptyString,
  bytes: Schema.Number,
  mimeType: Schema.NonEmptyString,
})
export type Attachment = typeof Attachment["Type"]
