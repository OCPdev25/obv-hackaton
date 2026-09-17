import { Schema } from "effect"
import { convexId } from "./ids.js"
import { Attachment } from "./attachment.js"
import { CaptureId } from "./extraction.js"

/**
 * The context envelope (contract v0.3 — art_lyBemdV9 §2–3): the
 * schema-defined record that travels with every captured utterance and
 * carries, in one decodable structure, the raw utterance plus what the app
 * already showed the user. Every contextual value carries provenance;
 * missing context stays unknown — an absent optional field, never `null`,
 * never a sentinel default (the pinned wire rules: no explicit nulls, no
 * underscore-prefixed fields).
 *
 * Privacy posture carried from the proposal: no ambient capture, no hidden
 * access (the envelope contains only what the app renders to the same user),
 * and the household is the access-control root — it never carries
 * cross-household data.
 */

/** Where a contextual value came from. `inferred` is narrow by policy: capture-time derivations with a stated rule only. */
export const ProvenanceSource = Schema.Literals(["user-asserted", "app-known", "inferred"])
export type ProvenanceSource = typeof ProvenanceSource["Type"]

export const ProvenancedChild = Schema.Struct({
  value: Schema.Struct({
    childId: convexId("children"),
    displayName: Schema.NonEmptyString,
  }),
  source: ProvenanceSource,
  /** One-line why, human-readable (e.g. "child picker selection on capture screen"). */
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

export const ProvenancedTimezone = Schema.Struct({
  /** IANA zone, e.g. "America/New_York". */
  value: Schema.NonEmptyString,
  source: ProvenanceSource,
  basis: Schema.optionalKey(Schema.NonEmptyString),
})
export type ProvenancedTimezone = typeof ProvenancedTimezone["Type"]

/**
 * A reference to prior context the user's capture explicitly relates to, as
 * surfaced by the app's own picker. `visibleToActor` is a required Boolean
 * the app asserts at capture — the guard the private-audience acceptance
 * case audits: a reference the actor cannot see must resolve to
 * `target-not-visible`, never leak content.
 */
export const PriorReference = Schema.Struct({
  referenceId: Schema.NonEmptyString,
  kind: Schema.Literals(["entry", "event", "message"]),
  targetId: Schema.NonEmptyString,
  snippet: Schema.optionalKey(Schema.NonEmptyString),
  source: ProvenanceSource,
  visibleToActor: Schema.Boolean,
})
export type PriorReference = typeof PriorReference["Type"]

export const ContextEnvelope = Schema.Struct({
  envelopeId: Schema.NonEmptyString,
  captureId: CaptureId,
  /** Unix ms on the wire. */
  capturedAt: Schema.Number,
  /** Required — "today" and window math need a zone; no device-default guessing downstream. */
  capturedAtTimezone: ProvenancedTimezone,
  locale: Schema.optionalKey(Schema.NonEmptyString),
  /** Verbatim, byte-faithful: never trimmed, normalized, or "corrected". */
  utterance: Schema.NonEmptyString,
  actor: Schema.Struct({
    authorId: Schema.String,
    role: Schema.Literals(["parent", "caregiver"]),
  }),
  /** Access-control root for every read. */
  householdId: convexId("households"),
  /** The EXPLICIT current child only; absent = unknown. Guessing the child is Extract's job, recorded on the candidate. */
  currentChild: Schema.optionalKey(ProvenancedChild),
  viewContext: Schema.optionalKey(ProvenancedView),
  attachments: Schema.optionalKey(Schema.Array(Attachment)),
  references: Schema.optionalKey(Schema.Array(PriorReference)),
})
export type ContextEnvelope = typeof ContextEnvelope["Type"]
