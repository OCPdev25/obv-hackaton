import { Schema } from "effect"

import { EventFields, convexId } from "@journal/domain"

/**
 * Query-surface contracts for the remember-and-retrieve read-only path.
 *
 * This module is the EXECUTABLE FORM of a contract rule-2 proposal (rule 2:
 * "Adding fields: propose in this thread first; the schema is the single
 * source of truth"). Canonical promotion — moving these operation schemas
 * into packages/domain — is owned by the contract v0.3 fold thread
 * (th_IL2xKJpO) and is deliberately NOT self-landed here.
 *
 * Boundaries that keep the canonical contract authoritative:
 * - Entry/Event decoding still goes through `@journal/domain`; nothing here
 *   redefines those shapes.
 * - `category` fields reuse the canonical `EventFields.category` schema —
 *   the six-literal taxonomy is never restated.
 * - Household/child id fields reuse `convexId()` annotations so a later
 *   promotion derives identical Convex validators.
 */

/** Half-open window `[from, to)` in unix ms — `to` is exclusive. */
export const QueryWindow = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number,
})
export type QueryWindow = typeof QueryWindow["Type"]

/** One citation: a source entry plus the events in it backing the claim. */
export const AnswerCitation = Schema.Struct({
  entryId: Schema.String,
  eventIds: Schema.Array(Schema.String),
  childId: Schema.String,
  authorId: Schema.String,
  /** Bounded verbatim excerpt of the cited entry's raw transcript. */
  excerpt: Schema.String,
  /** Timestamp of the first cited event, unix ms. */
  occurredAt: Schema.Number,
})
export type AnswerCitation = typeof AnswerCitation["Type"]

/**
 * Confirmation breakdown over the events an answer rests on (T2, Gap 3/A7).
 * `confidence === 1` is caregiver-confirmed per contract v0.2; anything
 * lower is an inferred (raw extractor) event. `confirmed + inferred` is the
 * denominator of aggregate claims such as "potty success rate 80%".
 */
export const AnswerCoverage = Schema.Struct({
  confirmed: Schema.Number,
  inferred: Schema.Number,
  total: Schema.Number,
})
export type AnswerCoverage = typeof AnswerCoverage["Type"]

/** One side of a conflicting-authors claim. */
export const ConflictClaim = Schema.Struct({
  authorId: Schema.String,
  eventIds: Schema.Array(Schema.String),
  payloadKey: Schema.String,
  payloadValue: Schema.Number,
})
export type ConflictClaim = typeof ConflictClaim["Type"]

/**
 * Out-of-band facts the answer must disclose alongside the claim itself:
 * corrections that superseded data the answer used, conflicting authors for
 * the same subject/category/day, and missing-log gaps inside the window.
 */
export const AnswerNotice = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("correction"),
    supersedesEventId: Schema.String,
    replacementEventId: Schema.optionalKey(Schema.String),
    correctedBy: Schema.String,
    reason: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("conflict"),
    category: EventFields.category,
    localDay: QueryWindow,
    claims: Schema.Array(ConflictClaim),
  }),
  Schema.Struct({
    _tag: Schema.Literal("gap"),
    from: Schema.Number,
    to: Schema.Number,
    days: Schema.Number,
  }),
])
export type AnswerNotice = typeof AnswerNotice["Type"]

/** One candidate in an ambiguous-subject answer (latest match per child). */
export const AmbiguityCandidate = Schema.Struct({
  childId: Schema.String,
  entryId: Schema.String,
  eventIds: Schema.Array(Schema.String),
  occurredAt: Schema.Number,
})
export type AmbiguityCandidate = typeof AmbiguityCandidate["Type"]

/**
 * The answer union. Every variant is a tagged struct so consumers decode
 * through one schema and switch on `_tag`.
 */
export const HistoryQueryAnswer = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("found"),
    statement: Schema.NonEmptyString,
    citations: Schema.Array(AnswerCitation),
    coverage: AnswerCoverage,
    notices: Schema.Array(AnswerNotice),
  }),
  Schema.Struct({
    _tag: Schema.Literal("ambiguous"),
    reason: Schema.Literal("multiple-children-matched"),
    candidates: Schema.Array(AmbiguityCandidate),
  }),
  Schema.Struct({
    _tag: Schema.Literal("clarify"),
    reason: Schema.Literals(["unknown-activity", "unresolved-person", "missing-time-window"]),
    message: Schema.NonEmptyString,
  }),
  Schema.Struct({
    _tag: Schema.Literal("not-found"),
    statement: Schema.NonEmptyString,
    window: Schema.optionalKey(QueryWindow),
    notices: Schema.Array(AnswerNotice),
  }),
])
export type HistoryQueryAnswer = typeof HistoryQueryAnswer["Type"]

/**
 * The structured plan a question compiles to. The bounded resolver in
 * `./resolve.js` produces plans; richer NL layers (slot 15/17) target the
 * same schema. `window` is half-open; absent on `last-event` = whole
 * corpus span.
 */
export const HistoryQueryPlan = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("last-event"),
    category: EventFields.category,
    keyword: Schema.optionalKey(Schema.NonEmptyString),
    subjectChildId: Schema.optionalKey(Schema.String),
    window: Schema.optionalKey(QueryWindow),
  }),
  Schema.Struct({
    _tag: Schema.Literal("count-events"),
    category: EventFields.category,
    keyword: Schema.optionalKey(Schema.NonEmptyString),
    subjectChildId: Schema.optionalKey(Schema.String),
    window: QueryWindow,
  }),
  Schema.Struct({
    _tag: Schema.Literal("probe-events"),
    category: EventFields.category,
    keyword: Schema.optionalKey(Schema.NonEmptyString),
    subjectChildId: Schema.optionalKey(Schema.String),
    window: QueryWindow,
  }),
  Schema.Struct({
    _tag: Schema.Literal("day-summary"),
    subjectChildId: Schema.optionalKey(Schema.String),
    window: QueryWindow,
  }),
])
export type HistoryQueryPlan = typeof HistoryQueryPlan["Type"]

/** Input contract for a history question (read-only; no writes anywhere). */
export const HistoryQueryInput = Schema.Struct({
  householdId: convexId("households"),
  /** Pinned subject child; absent = derived from the question or ambiguous. */
  childId: Schema.optionalKey(convexId("children")),
  askedBy: Schema.NonEmptyString,
  /** "Now" for relative-time resolution, unix ms. */
  askedAt: Schema.Number,
  /** IANA zone of the asker — day boundaries and statement clocks. */
  timezone: Schema.NonEmptyString,
  question: Schema.NonEmptyString,
})
export type HistoryQueryInput = typeof HistoryQueryInput["Type"]
