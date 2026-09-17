/**
 * Viewer logic for the caregiver-questions prototype: pure functions over the
 * domain contracts, so the demo screen stays presentational and the rules stay
 * testable without a device. The authorization decisions themselves come from
 * `@journal/domain` — nothing here re-implements policy.
 *
 * Seed data mirrors evaluation/fixtures/agent-experience/caregiver-questions/
 * household-a.json. Real screens will read these documents from Convex.
 */
import {
  buildHandoffDigest,
  canAnswerQuestion,
  canReopenQuestion,
  canResolveQuestion,
  canViewQuestion,
  deriveQuestionState,
  type CareQuestionState,
  type HandoffDigest,
  type QuestionPrincipal,
  type QuestionTargetFacts,
} from "@journal/domain"
import type { CareQuestionActivityDocument, CareQuestionDocument } from "@journal/domain"

export interface QuestionSeed {
  readonly question: CareQuestionDocument
  readonly activities: readonly CareQuestionActivityDocument[]
  readonly target: QuestionTargetFacts
}

/** Status line shown on a question card — open vs answered vs resolved, with reopen lineage. */
export const statusLabel = (state: CareQuestionState): string => {
  const reopened = state.reopenedCount > 0 ? `reopened ×${state.reopenedCount}` : undefined
  if (state.status === "resolved") return "Resolved"
  if (state.status === "answered") {
    return reopened ? `Answered, ${reopened}` : "Answered — awaiting confirmation"
  }
  return reopened ? `${reopened} — no answer yet` : "No answer yet"
}

/**
 * Deterministic UTC rendering so prototype output is stable across devices and
 * test runs. Real screens will render in the household's timezone instead.
 */
export const formatEpochTime = (at: number): string => {
  const iso = new Date(at).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

/**
 * One-line summary for the handoff card. The missing-vs-zero discipline lives
 * here too: "no questions" is rendered as an explicit statement, never as
 * "all clear".
 */
export const handoffSummary = (digest: HandoffDigest): string => {
  if (!digest.hasQuestions) {
    return "No questions were asked in this scope — not the same as all clear."
  }
  const unresolved = digest.unresolved.length
  const noAnswer = digest.unresolved.filter((line) => line.answerCount === 0).length
  const answered = unresolved - noAnswer
  const resolved = digest.resolvedInWindow.length
  const total = unresolved + resolved
  const parts: string[] = []
  if (noAnswer > 0) parts.push(`${noAnswer} awaiting an answer`)
  if (answered > 0) parts.push(`${answered} answered, awaiting confirmation`)
  if (resolved > 0) parts.push(`${resolved} resolved today`)
  return `${total} question${total === 1 ? "" : "s"} asked: ${parts.join(", ")}.`
}

const stateOf = (seed: QuestionSeed): CareQuestionState =>
  deriveQuestionState(seed.question, seed.activities)

/** Questions the viewer may see at all — invisible ones are excluded, not errors. */
export const visibleSeeds = (seeds: readonly QuestionSeed[], principal: QuestionPrincipal): QuestionSeed[] =>
  seeds.filter((seed) => canViewQuestion(principal, seed.question, seed.target).outcome === "ALLOW")

export const viewerCanAnswer = (seed: QuestionSeed, principal: QuestionPrincipal, caregiverId: string): boolean =>
  canAnswerQuestion(principal, caregiverId, seed.question, seed.target, stateOf(seed).status).outcome === "ALLOW"

export const viewerCanResolve = (seed: QuestionSeed, principal: QuestionPrincipal, caregiverId: string): boolean =>
  canResolveQuestion(principal, caregiverId, seed.question, seed.target, stateOf(seed).status).outcome === "ALLOW"

export const viewerCanReopen = (seed: QuestionSeed, principal: QuestionPrincipal, caregiverId: string): boolean =>
  canReopenQuestion(principal, caregiverId, seed.question, seed.target, stateOf(seed).status).outcome === "ALLOW"

/** Digest over the questions the viewer can see and that are marked for handoff. */
export const digestFor = (seeds: readonly QuestionSeed[], options?: { readonly windowStart?: number }): HandoffDigest => {
  const handoff = seeds.filter((seed) => stateOf(seed).handoffIncluded)
  return buildHandoffDigest(
    handoff.map((seed) => ({ question: seed.question, activities: seed.activities })),
    options,
  )
}
