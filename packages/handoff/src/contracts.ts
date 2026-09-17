import { Schema } from "effect"

import { convexId, EntryVisibility, ExtractionStatus } from "@journal/domain"

/**
 * Handoff contracts — the since-last-seen caregiver digest and the grounded
 * follow-up question surface. Prototypes feeding delivery slots 23
 * (source-linked caregiver handoff) and 24 (digest with gap disclosure +
 * revision invalidation).
 *
 * Hard rules baked into these shapes:
 * - every claim carries at least one SourceRef (`SourceRefs` is a
 *   NonEmptyArray) — nothing in a summary is unsourced, by construction;
 * - there is no field anywhere for a conclusion, severity, or comparison —
 *   the digest reports what was logged, never what it means;
 * - gaps are first-class data (GapDisclosure), so absence of logs can be
 *   disclosed in care-neutral language instead of reading as absence of care.
 */

/**
 * Event taxonomy mirrored at the wire level from the @journal/domain contract
 * (`packages/domain/src/event.ts`). Same precedent as
 * `evaluation/src/adapter.ts`: wire shapes duplicate the union rather than
 * reach into domain internals, so handoff stays graftable without a domain
 * value export. Keep both sides in sync.
 */
export const HandoffEventCategory = Schema.Literals(["potty", "meal", "sleep", "mood", "milestone", "school"])
export type HandoffEventCategory = typeof HandoffEventCategory["Type"]

/** Display/computation order for category sections (domain taxonomy order). */
export const CATEGORY_ORDER = ["potty", "meal", "sleep", "mood", "milestone", "school"] as const

/** The digest's extractor confidence floor — below it, an event goes to the questions section instead of the claims. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7

export const Confidence = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

/**
 * One event inside a capture, already scoped to the entry's child. The entry
 * carries household/child context, so events do not repeat table ids here.
 */
export const HandoffEvent = Schema.Struct({
  category: HandoffEventCategory,
  /** Absolute instant, Unix ms — relative expressions must already be resolved. */
  timestamp: Schema.Number,
  payload: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  confidence: Confidence,
})
export type HandoffEvent = typeof HandoffEvent["Type"]

/**
 * One capture the recipient is authorized to see. Authorization happened
 * upstream (household/relationship grants per contract v0.2) — this package
 * never re-checks audience; it only summarizes what it is given. That seam is
 * deliberate: slot 20 owns authorization, slots 23/24 own presentation.
 */
export const HandoffEntry = Schema.Struct({
  entryId: convexId("entries"),
  captureId: Schema.NonEmptyString,
  authorId: Schema.String,
  createdAt: Schema.Number,
  visibility: EntryVisibility,
  extractionStatus: ExtractionStatus,
  rawTranscript: Schema.NonEmptyString,
  events: Schema.Array(HandoffEvent),
})
export type HandoffEntry = typeof HandoffEntry["Type"]

/** Routine context quoted verbatim from the child's family profile. */
export const RoutineNote = Schema.Struct({
  childId: convexId("children"),
  note: Schema.NonEmptyString,
})
export type RoutineNote = typeof RoutineNote["Type"]

/** Everything a handoff prototype needs to summarize one window for one recipient. */
export const DigestInput = Schema.Struct({
  childId: convexId("children"),
  childName: Schema.NonEmptyString,
  recipientName: Schema.NonEmptyString,
  /** Window start = the caregiver's previous visit, Unix ms (inclusive). */
  lastSeenAt: Schema.Number,
  /** Window end / generation instant, Unix ms (exclusive). */
  generatedAt: Schema.Number,
  /** IANA zone used for all rendering (e.g. "America/New_York"). */
  timezone: Schema.NonEmptyString,
  entries: Schema.Array(HandoffEntry),
  routineNotes: Schema.Array(RoutineNote),
})
export type DigestInput = typeof DigestInput["Type"]

/**
 * A pointer to where a claim came from. Entry refs link to the raw capture
 * (with a verbatim transcript snippet); child-profile refs link to the family
 * profile note. Snippets are quotes from humans — sources, not conclusions.
 */
export const SourceRef = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literals(["entry"]),
    entryId: convexId("entries"),
    captureId: Schema.NonEmptyString,
    /** Verbatim snippet of the raw transcript; empty for unpublished captures (no content leak). */
    snippet: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literals(["child-profile"]),
    childId: convexId("children"),
  }),
])
export type SourceRef = typeof SourceRef["Type"]

/** At least one source per claim — the "every claim links to its source" rule, enforced structurally. */
export const SourceRefs = Schema.NonEmptyArray(SourceRef)

export const DigestClaim = Schema.Struct({
  statement: Schema.NonEmptyString,
  /** Event category when the claim derives from one; routine/profile claims omit it. */
  category: Schema.optionalKey(HandoffEventCategory),
  occurredAt: Schema.optionalKey(Schema.Number),
  sourceRefs: SourceRefs,
})
export type DigestClaim = typeof DigestClaim["Type"]

export const UnresolvedQuestionReason = Schema.Literals([
  "extraction-failed",
  "extraction-pending",
  "draft-capture",
  "low-confidence-event",
])
export type UnresolvedQuestionReason = typeof UnresolvedQuestionReason["Type"]

export const UnresolvedQuestion = Schema.Struct({
  question: Schema.NonEmptyString,
  reason: UnresolvedQuestionReason,
  sourceRefs: SourceRefs,
})
export type UnresolvedQuestion = typeof UnresolvedQuestion["Type"]

/** A local calendar day inside the window with zero captures, disclosed in care-neutral language. */
export const GapDisclosure = Schema.Struct({
  /** Local calendar day, YYYY-MM-DD in the digest timezone. */
  day: Schema.String,
  disclosure: Schema.NonEmptyString,
})
export type GapDisclosure = typeof GapDisclosure["Type"]

export const CoverageRow = Schema.Struct({
  category: HandoffEventCategory,
  /** Events surfaced in the digest for this category. */
  observed: Schema.Number,
  /** Distinct captures contributing those events. */
  captureCount: Schema.Number,
  note: Schema.NonEmptyString,
})
export type CoverageRow = typeof CoverageRow["Type"]

export const SourceIndexEntry = Schema.Struct({
  entryId: convexId("entries"),
  captureId: Schema.NonEmptyString,
  createdAt: Schema.Number,
  snippet: Schema.String,
})
export type SourceIndexEntry = typeof SourceIndexEntry["Type"]

export const HandoffDigest = Schema.Struct({
  childId: convexId("children"),
  childName: Schema.NonEmptyString,
  recipientName: Schema.NonEmptyString,
  generatedAt: Schema.Number,
  timezone: Schema.NonEmptyString,
  window: Schema.Struct({ since: Schema.Number, until: Schema.Number }),
  /** What was logged, one claim per event, every claim source-linked. */
  claims: Schema.Array(DigestClaim),
  /** Family-profile routine context, verbatim and attributed. */
  routineContext: Schema.Array(DigestClaim),
  /** Captures needing human attention before the digest can be fully trusted. */
  unresolvedQuestions: Schema.Array(UnresolvedQuestion),
  /** Local days with zero captures — the gap-disclosure section. */
  gapDisclosures: Schema.Array(GapDisclosure),
  /** Per-category observation counts with care-neutral notes. */
  coverage: Schema.Array(CoverageRow),
  /** The raw captures everything above links to. */
  sourceIndex: Schema.Array(SourceIndexEntry),
  suggestedFollowUps: Schema.Array(Schema.String),
})
export type HandoffDigest = typeof HandoffDigest["Type"]

/**
 * Interactive follow-up answer — the second interaction shape. Same ground
 * truth as the static digest, but caregiver-driven: a question comes in, a
 * grounded answer (or an explicit refusal) goes out.
 */
export const FollowUpAnswer = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literals(["answered"]),
    claim: DigestClaim,
    /** How many window events the answer drew from (the claim cites the latest). */
    matchedCount: Schema.Number,
  }),
  Schema.Struct({
    _tag: Schema.Literals(["not-logged"]),
    statement: Schema.NonEmptyString,
  }),
  Schema.Struct({
    _tag: Schema.Literals(["refused-medical"]),
    guidance: Schema.NonEmptyString,
  }),
  Schema.Struct({
    _tag: Schema.Literals(["refused-out-of-window"]),
    guidance: Schema.NonEmptyString,
  }),
])
export type FollowUpAnswer = typeof FollowUpAnswer["Type"]
