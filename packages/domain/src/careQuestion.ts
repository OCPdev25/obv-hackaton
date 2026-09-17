import { Schema } from "effect"

import { convexId } from "./ids.js"

/**
 * Caregiver questions attached to journal content — contract proposal for the
 * canonical schema (contract v0.2 owner acceptance pending; see the companion
 * proposal document and PR description).
 *
 * Design rules this module obeys:
 *
 * 1. **Questions attach to existing journal content.** Every question points
 *    at an `entries` row (and, for event targets, one of its structured
 *    `events`). There is no standalone "conversation": this is a structured
 *    Q&A lifecycle over the journal, not general messaging.
 * 2. **Audience vs addressing, two dimensions (contract v0.2 rule).** Who a
 *    question is DIRECTED at is an asking fact stored on the question
 *    (`audienceKind` + `addresseeIds`, the To: line of the question). Who MAY
 *    see it is resolved from household/relationship grants plus the target's
 *    publication state in `./careQuestionPolicy.ts` — never fused into a
 *    status enum, never widened by publication.
 * 3. **Append-only lineage.** Answers, resolutions, reopenings and handoff
 *    decisions are activity records; nothing mutates a question in place.
 *    Current state is DERIVED (`deriveQuestionState`) — the same pattern the
 *    operator-surface design uses for extraction attempts.
 * 4. **Raw capture is preserved by reference.** `sourceCaptureId` points at
 *    the capture/entry the question arose from; the pipeline never copies or
 *    rewrites source text.
 * 5. **Missing is not zero.** An open question with no answers is "awaiting",
 *    never "none"; a questionless scope is "nothing was asked", never "all
 *    clear". `buildHandoffDigest` encodes the distinction; tests pin it.
 * 6. **Adapter-safe vocabulary only.** Every field below maps through the
 *    Effect -> Convex adapter (strings, numbers, booleans, literals, unions
 *    of literals, arrays, nested structs, optional/optionalKey) — no
 *    `DateFromMillis`, no struct unions.
 */

/** What a question is attached to. An event target always also names its owning entry. */
export type CareQuestionTargetKind = "entry" | "event"

export const CareQuestionFields = {
  householdId: convexId("households"),
  childId: convexId("children"),
  /** `"entry"` = the entry as a whole; `"event"` = one structured event within the entry. */
  targetKind: Schema.Literals(["entry", "event"]),
  /** Owning entry — always present, so event targets resolve through the entry. */
  entryId: convexId("entries"),
  /** Present if and only if `targetKind === "event"` (invariant pinned by tests). */
  eventId: Schema.optional(convexId("events")),
  /** Attribution: the caregiver who asked (external identity string, like `Entry.authorId`). */
  askedById: Schema.String,
  /** The question itself, in the asker's words. */
  question: Schema.NonEmptyString,
  /** `"directed"` = only the named addressees (+ asker); `"household"` = every household member. */
  audienceKind: Schema.Literals(["directed", "household"]),
  /** Addressees for `"directed"` questions; empty (and ignored) for `"household"`. */
  addresseeIds: Schema.Array(Schema.String),
  /** Ask-time opt-in to the handoff digest; later decisions arrive as `handoff-marked` activities. */
  handoffIncluded: Schema.Boolean,
  /** Provenance: the raw capture/entry this question arose from, when asked via conversation. */
  sourceCaptureId: Schema.optional(Schema.String),
  /** Epoch millis (Convex-friendly; wire format is a number). */
  createdAt: Schema.Number,
} satisfies Schema.Struct.Fields

export const CareQuestionSchema = Schema.Struct(CareQuestionFields)
export type CareQuestion = typeof CareQuestionSchema["Type"]

/** Question table view plus Convex system fields. */
export const CareQuestionDocumentFields = {
  ...CareQuestionFields,
  _id: convexId("careQuestions"),
  _creationTime: Schema.Number,
} satisfies Schema.Struct.Fields
export const CareQuestionDocument = Schema.Struct(CareQuestionDocumentFields)
export type CareQuestionDocument = typeof CareQuestionDocument["Type"]

/**
 * Append-only question activity. One row per lifecycle event; the question
 * row itself is never updated after creation.
 *
 * Per-`kind` invariants (optionalKey at rest because the adapter vocabulary
 * has no per-kind structs; enforced by tests and the write layer):
 *   - `answered`: `answerText` REQUIRED; optional answer source (`sourceKind`+`sourceId`)
 *     attributes where the answer came from — an entry, an event, or a capture.
 *   - `resolved`: optional `settlesActivityId` names the answer the resolution accepts.
 *   - `reopened`: `reason` REQUIRED.
 *   - `handoff-marked`: `handoffIncluded` REQUIRED (the new inclusion state).
 */
export const CareQuestionActivityKind = Schema.Literals(["answered", "resolved", "reopened", "handoff-marked"])
export type CareQuestionActivityKind = typeof CareQuestionActivityKind["Type"]

export const CareQuestionActivityFields = {
  householdId: convexId("households"),
  childId: convexId("children"),
  questionId: convexId("careQuestions"),
  kind: CareQuestionActivityKind,
  /** Attribution: who answered / resolved / reopened / marked. Server-bound at write time. */
  actorId: Schema.String,
  /** Epoch millis. */
  at: Schema.Number,
  answerText: Schema.optionalKey(Schema.NonEmptyString),
  sourceKind: Schema.optionalKey(Schema.Literals(["entry", "event", "capture"])),
  sourceId: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.NonEmptyString),
  settlesActivityId: Schema.optionalKey(Schema.String),
  handoffIncluded: Schema.optionalKey(Schema.Boolean),
} satisfies Schema.Struct.Fields

export const CareQuestionActivitySchema = Schema.Struct(CareQuestionActivityFields)
export type CareQuestionActivity = typeof CareQuestionActivitySchema["Type"]

/** Activity table view plus Convex system fields. */
export const CareQuestionActivityDocumentFields = {
  ...CareQuestionActivityFields,
  _id: convexId("careQuestionActivities"),
  _creationTime: Schema.Number,
} satisfies Schema.Struct.Fields
export const CareQuestionActivityDocument = Schema.Struct(CareQuestionActivityDocumentFields)
export type CareQuestionActivityDocument = typeof CareQuestionActivityDocument["Type"]

// ---------------------------------------------------------------------------
// Derived question state (pure; no storage concerns)
// ---------------------------------------------------------------------------

export interface CareQuestionAnswerView {
  readonly activityId: string
  readonly authorId: string
  readonly at: number
  readonly text: string
  readonly source?: { readonly kind: "entry" | "event" | "capture"; readonly id?: string }
}

export interface CareQuestionState {
  /** `"open"` includes reopened questions — reopening returns an answered/resolved question to open. */
  readonly status: "open" | "answered" | "resolved"
  readonly reopenedCount: number
  readonly answers: readonly CareQuestionAnswerView[]
  readonly handoffIncluded: boolean
  /** Latest activity time, or the question's `createdAt` when it has none. */
  readonly lastActivityAt: number
  readonly resolution?: {
    readonly activityId: string
    readonly resolvedById: string
    readonly at: number
    readonly settlesActivityId?: string
  }
}

/**
 * Derive the current state of one question from its append-only activity
 * stream. Input need not be sorted; ties in `at` preserve input order
 * (write order). Answers are keyed by their activity `_id`.
 */
export const deriveQuestionState = (
  question: Pick<CareQuestion, "handoffIncluded" | "createdAt">,
  activities: readonly CareQuestionActivityDocument[],
): CareQuestionState => {
  const ordered = [...activities].sort((a, b) => a.at - b.at)

  let status: CareQuestionState["status"] = "open"
  let reopenedCount = 0
  let handoffIncluded = question.handoffIncluded
  let resolution: CareQuestionState["resolution"]
  const answers: CareQuestionAnswerView[] = []

  for (const activity of ordered) {
    if (activity.kind === "answered" && activity.answerText !== undefined) {
      status = "answered"
      answers.push({
        activityId: activity._id,
        authorId: activity.actorId,
        at: activity.at,
        text: activity.answerText,
        source: activity.sourceKind === undefined ? undefined : { kind: activity.sourceKind, id: activity.sourceId },
      })
      continue
    }
    if (activity.kind === "resolved") {
      status = "resolved"
      resolution = {
        activityId: activity._id,
        resolvedById: activity.actorId,
        at: activity.at,
        settlesActivityId: activity.settlesActivityId,
      }
      continue
    }
    if (activity.kind === "reopened") {
      status = "open"
      reopenedCount += 1
      resolution = undefined
      continue
    }
    // kind === "handoff-marked"
    if (activity.handoffIncluded !== undefined) {
      handoffIncluded = activity.handoffIncluded
    }
  }

  return {
    status,
    reopenedCount,
    answers,
    handoffIncluded,
    lastActivityAt: ordered.length > 0 ? (ordered[ordered.length - 1]?.at ?? question.createdAt) : question.createdAt,
    resolution,
  }
}

// ---------------------------------------------------------------------------
// Handoff digest (pure; missing-vs-zero distinction is contractual)
// ---------------------------------------------------------------------------

/**
 * Flat, adapter-safe digest line. `kind` separates still-open questions from
 * resolutions so a handoff never renders "awaiting" as "none" or an explicit
 * negative as a gap. `latestAnswerText` preserves the caregiver's answer
 * verbatim — including answers like "None today." (an explicit zero), which
 * is a different fact from an unanswered question.
 */
export const HandoffLineSchema = Schema.Struct({
  kind: Schema.Literals(["unresolved", "resolved"]),
  // Full document, not the base row: digest lines must identify the question
  // (_id) and sort by createdAt without a second lookup.
  question: CareQuestionDocument,
  status: Schema.Literals(["open", "answered", "resolved"]),
  reopenedCount: Schema.Number,
  answerCount: Schema.Number,
  /** Present when `kind === "resolved"`. */
  resolvedById: Schema.optionalKey(Schema.String),
  resolvedAt: Schema.optionalKey(Schema.Number),
  latestAnswerText: Schema.optionalKey(Schema.NonEmptyString),
  latestAnswerById: Schema.optionalKey(Schema.String),
})
export type HandoffLine = typeof HandoffLineSchema["Type"]

export const HandoffDigestSchema = Schema.Struct({
  /**
   * False only when NO questions exist in scope at all — "nothing was asked".
   * A scope with questions but an empty digest body is a DIFFERENT fact:
   * questions exist, none marked for handoff. Callers must not render the
   * latter as "all clear".
   */
  hasQuestions: Schema.Boolean,
  unresolved: Schema.Array(HandoffLineSchema),
  resolvedInWindow: Schema.Array(HandoffLineSchema),
})
export type HandoffDigest = typeof HandoffDigestSchema["Type"]

export interface HandoffDigestInput {
  readonly question: CareQuestionDocument
  readonly activities: readonly CareQuestionActivityDocument[]
}

/**
 * Build the handoff digest for a set of questions the CALLER is authorized to
 * see (visibility filtering happens in the policy layer before this runs).
 * `windowStart` (epoch millis) bounds which resolutions count; unresolved
 * questions are unbounded — they stay open until resolved.
 */
export const buildHandoffDigest = (
  inputs: readonly HandoffDigestInput[],
  options?: { readonly windowStart?: number },
): HandoffDigest => {
  const windowStart = options?.windowStart
  const unresolved: HandoffLine[] = []
  const resolvedInWindow: HandoffLine[] = []

  for (const { question, activities } of inputs) {
    const state = deriveQuestionState(question, activities)
    if (!state.handoffIncluded) continue

    const latestAnswer = state.answers[state.answers.length - 1]
    // Optional fields are omitted entirely, never set to undefined: the wire
    // contract uses optionalKey (absent key), and an explicit-undefined value
    // would fail decode and violate exactOptionalPropertyTypes.
    const line: HandoffLine = {
      kind: state.status === "resolved" ? "resolved" : "unresolved",
      question,
      status: state.status,
      reopenedCount: state.reopenedCount,
      answerCount: state.answers.length,
      ...(state.resolution
        ? { resolvedById: state.resolution.resolvedById, resolvedAt: state.resolution.at }
        : {}),
      ...(latestAnswer ? { latestAnswerText: latestAnswer.text, latestAnswerById: latestAnswer.authorId } : {}),
    }

    if (state.status === "resolved" && state.resolution !== undefined && (windowStart === undefined || state.resolution.at >= windowStart)) {
      resolvedInWindow.push(line)
      continue
    }
    if (state.status !== "resolved") {
      unresolved.push(line)
    }
  }

  unresolved.sort((a, b) => a.question.createdAt - b.question.createdAt)
  resolvedInWindow.sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0))

  return { hasQuestions: inputs.length > 0, unresolved, resolvedInWindow }
}
