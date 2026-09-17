/**
 * Fail-closed caregiver-question authorization.
 *
 * Same discipline as `security/access/policy.ts` (PR #4): pure functions,
 * decision VALUES not exceptions, fixed check order, absent or malformed data
 * never opens access. Lives in `@journal/domain` (not `security/access`)
 * because it composes the CANONICAL schemas; `security/access` still speaks
 * the threat-model's mock vocabulary.
 *
 * The two-dimension rule from contract v0.2, applied to questions:
 *   - ADDRESSING (who a question is directed at) is an asking fact on the
 *     question itself (`audienceKind` / `addresseeIds`).
 *   - VISIBILITY (who may see it) is resolved HERE from (a) household
 *     membership, (b) the target entry's publication state, and (c) the
 *     question's addressing — in that fixed order, fail-closed. A directed
 *     question narrows visibility; nothing widens it.
 *
 * Membership and the household roster are SERVER-MAINTAINED FACTS passed in
 * as parameters — the policy never infers them from a link, a share, or the
 * question's own claims.
 */
import type { CareQuestion } from "./careQuestion.js"
import type { EntryVisibility } from "./entry.js"

export type QuestionPrincipal =
  | { readonly kind: "caregiver"; readonly caregiverId: string; readonly householdIds: readonly string[] }
  | { readonly kind: "anonymous" }

export type QuestionDenyCode =
  | "DENY_Q_ANONYMOUS"
  | "DENY_Q_NO_HOUSEHOLD_PATH"
  | "DENY_Q_DRAFT_AUTHOR_ONLY"
  | "DENY_Q_NOT_ADDRESSEE"
  | "DENY_Q_NOT_ANSWERABLE"
  | "DENY_Q_ALREADY_RESOLVED"
  | "DENY_Q_NOT_RESOLVED"
  | "DENY_Q_ATTRIBUTION_MISMATCH"
  | "DENY_Q_ADDRESSEE_NOT_IN_HOUSEHOLD"
  | "DENY_Q_INVALID_AUDIENCE"
  | "DENY_Q_INVALID_TARGET"

export type QuestionDecision =
  | { readonly outcome: "ALLOW" }
  | { readonly outcome: "DENY"; readonly code: QuestionDenyCode; readonly detail: string }

/** The facts about a question's target entry the policy needs (never inferred). */
export interface QuestionTargetFacts {
  readonly householdId: string
  readonly childId: string
  readonly authorId: string
  readonly visibility: EntryVisibility
}

export interface AskQuestionChecks {
  readonly asAskedById: string
  readonly householdId: string
  readonly childId: string
  readonly targetKind: "entry" | "event"
  readonly eventId?: string
  readonly audienceKind: "directed" | "household"
  readonly addresseeIds: readonly string[]
}

export type QuestionStatus = "open" | "answered" | "resolved"

const deny = (code: QuestionDenyCode, detail: string): QuestionDecision => ({ outcome: "DENY", code, detail })
const ALLOW: QuestionDecision = { outcome: "ALLOW" }

/**
 * Shared read-path checks, in fixed order. The first failing check denies:
 *   1. DENY_Q_ANONYMOUS          — authentication edge.
 *   2. DENY_Q_NO_HOUSEHOLD_PATH  — household-membership boundary.
 *   3. DENY_Q_DRAFT_AUTHOR_ONLY  — publication-state boundary on the TARGET
 *                                  entry: drafts are author-only, and a
 *                                  question attached to a draft inherits
 *                                  that. Membership does not pierce drafts.
 *   4. DENY_Q_NOT_ADDRESSEE      — addressing boundary for directed questions:
 *                                  the asker and the named addressees only.
 */
const readChecks = (
  principal: QuestionPrincipal,
  question: Pick<CareQuestion, "askedById" | "audienceKind" | "addresseeIds">,
  target: QuestionTargetFacts,
): QuestionDecision => {
  if (principal.kind === "anonymous") {
    return deny("DENY_Q_ANONYMOUS", "unauthenticated principal cannot see questions")
  }
  if (!principal.householdIds.includes(target.householdId)) {
    return deny(
      "DENY_Q_NO_HOUSEHOLD_PATH",
      `question target is owned by household ${target.householdId}; caregiver ${principal.caregiverId} holds membership in [${principal.householdIds.join(", ") || "none"}]`,
    )
  }
  if (target.visibility === "draft" && target.authorId !== principal.caregiverId) {
    return deny(
      "DENY_Q_DRAFT_AUTHOR_ONLY",
      `question is attached to a draft entry authored by ${target.authorId}; caregiver ${principal.caregiverId} is a household member but not the author`,
    )
  }
  if (
    question.audienceKind === "directed" &&
    question.askedById !== principal.caregiverId &&
    !question.addresseeIds.includes(principal.caregiverId)
  ) {
    return deny(
      "DENY_Q_NOT_ADDRESSEE",
      `question is directed to [${question.addresseeIds.join(", ") || "no one"}]; caregiver ${principal.caregiverId} is neither the asker nor an addressee`,
    )
  }
  return ALLOW
}

/** May this principal SEE this question (and its answers)? */
export const canViewQuestion = (
  principal: QuestionPrincipal,
  question: Pick<CareQuestion, "askedById" | "audienceKind" | "addresseeIds">,
  target: QuestionTargetFacts,
): QuestionDecision => readChecks(principal, question, target)

/**
 * May this principal ASK this question? Asking requires reading the target
 * (checks 1–3, with the caller's own addressing instead of the question's),
 * then target integrity, attribution, and audience validity:
 *   5. DENY_Q_INVALID_TARGET     — scope mismatch, or an event target without its eventId.
 *   6. DENY_Q_ATTRIBUTION_MISMATCH — the ask is attributed to the authenticated principal or nothing.
 *   7. DENY_Q_INVALID_AUDIENCE / DENY_Q_ADDRESSEE_NOT_IN_HOUSEHOLD — a directed
 *      question needs a non-empty addressee list, and every addressee must be
 *      a server-verified household member (roster passed in, never trusted
 *      from the request).
 */
export const canAskQuestion = (
  principal: QuestionPrincipal,
  input: AskQuestionChecks,
  target: QuestionTargetFacts,
  householdMemberIds: readonly string[],
): QuestionDecision => {
  // The asker must be able to read the target under household addressing —
  // their own directed audience is chosen AFTER they prove they can see it.
  const read = readChecks(
    principal,
    { askedById: input.asAskedById, audienceKind: "household", addresseeIds: [] },
    target,
  )
  if (read.outcome === "DENY") return read

  if (target.householdId !== input.householdId || target.childId !== input.childId) {
    return deny("DENY_Q_INVALID_TARGET", `ask claims household/child ${input.householdId}/${input.childId} but the target entry belongs to ${target.householdId}/${target.childId}`)
  }
  if (input.targetKind === "event" && (input.eventId === undefined || input.eventId.length === 0)) {
    return deny("DENY_Q_INVALID_TARGET", "event-target question is missing its eventId")
  }
  if (principal.kind === "caregiver" && input.asAskedById !== principal.caregiverId) {
    return deny("DENY_Q_ATTRIBUTION_MISMATCH", `ask claims askedById=${input.asAskedById} but authenticated principal is ${principal.caregiverId}`)
  }
  if (input.audienceKind === "directed") {
    if (input.addresseeIds.length === 0) {
      return deny("DENY_Q_INVALID_AUDIENCE", "a directed question needs at least one addressee; use audienceKind 'household' instead")
    }
    const stranger = input.addresseeIds.find((id) => !householdMemberIds.includes(id))
    if (stranger !== undefined) {
      return deny(
        "DENY_Q_ADDRESSEE_NOT_IN_HOUSEHOLD",
        `addressee ${stranger} is not a server-verified member of household ${target.householdId}`,
      )
    }
  }
  return ALLOW
}

/**
 * May this principal ANSWER? Viewers under household addressing may; directed
 * questions are answered by their addressees only (the asker resolves instead
 * of answering their own directed question). A resolved question must be
 * reopened first — answering a settled question would launder the resolution.
 */
export const canAnswerQuestion = (
  principal: QuestionPrincipal,
  asActorId: string,
  question: CareQuestion,
  target: QuestionTargetFacts,
  currentStatus: QuestionStatus,
): QuestionDecision => {
  const read = readChecks(principal, question, target)
  if (read.outcome === "DENY") return read
  if (principal.kind === "caregiver" && asActorId !== principal.caregiverId) {
    return deny("DENY_Q_ATTRIBUTION_MISMATCH", `answer claims actorId=${asActorId} but authenticated principal is ${principal.caregiverId}`)
  }
  if (question.audienceKind === "directed" && !question.addresseeIds.includes(asActorId)) {
    return deny(
      "DENY_Q_NOT_ANSWERABLE",
      `question is directed to [${question.addresseeIds.join(", ") || "no one"}]; ${asActorId} may resolve it (if the asker) but not answer it`,
    )
  }
  if (currentStatus === "resolved") {
    return deny("DENY_Q_ALREADY_RESOLVED", "question is resolved; reopen it before answering again")
  }
  return ALLOW
}

/**
 * May this principal RESOLVE? Any viewer who can see the question may confirm
 * it is settled — the family is small, every resolution is attributed with a
 * receipt (actor, timestamp, optional answer reference), and reopening is
 * always available to reverse it.
 */
export const canResolveQuestion = (
  principal: QuestionPrincipal,
  asActorId: string,
  question: CareQuestion,
  target: QuestionTargetFacts,
  currentStatus: QuestionStatus,
): QuestionDecision => {
  const read = readChecks(principal, question, target)
  if (read.outcome === "DENY") return read
  if (principal.kind === "caregiver" && asActorId !== principal.caregiverId) {
    return deny("DENY_Q_ATTRIBUTION_MISMATCH", `resolution claims actorId=${asActorId} but authenticated principal is ${principal.caregiverId}`)
  }
  if (currentStatus === "resolved") {
    return deny("DENY_Q_ALREADY_RESOLVED", "question is already resolved; reopen it first if it is not actually settled")
  }
  return ALLOW
}

/** May this principal REOPEN? Only a resolved question can be reopened. */
export const canReopenQuestion = (
  principal: QuestionPrincipal,
  asActorId: string,
  question: CareQuestion,
  target: QuestionTargetFacts,
  currentStatus: QuestionStatus,
): QuestionDecision => {
  const read = readChecks(principal, question, target)
  if (read.outcome === "DENY") return read
  if (principal.kind === "caregiver" && asActorId !== principal.caregiverId) {
    return deny("DENY_Q_ATTRIBUTION_MISMATCH", `reopen claims actorId=${asActorId} but authenticated principal is ${principal.caregiverId}`)
  }
  if (currentStatus !== "resolved") {
    return deny("DENY_Q_NOT_RESOLVED", `question is ${currentStatus}; only a resolved question can be reopened`)
  }
  return ALLOW
}

/** Which of the given questions may this principal see? Invisible = excluded, not an error. */
export const visibleQuestions = (
  principal: QuestionPrincipal,
  questions: readonly { readonly question: CareQuestion; readonly target: QuestionTargetFacts }[],
): CareQuestion[] =>
  questions
    .filter(({ question, target }) => canViewQuestion(principal, question, target).outcome === "ALLOW")
    .map(({ question }) => question)
