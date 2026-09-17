import type { FollowUpAnswer, HandoffDigest, SourceRef } from "./contracts.js"
import { categoryLabel } from "./compose.js"
import { timeLabel } from "./time.js"

/**
 * Plain-text renderings — the static digest made concrete (what a caregiver
 * would read or a ticket/print surface would show). Kept pure so tests can
 * assert on rendered content and slots 23/24 can reuse or replace the layout
 * without touching the composer.
 */

const sourceTag = (refs: readonly [SourceRef, ...SourceRef[]]): string =>
  refs
    .map((ref) => {
      if (ref._tag === "child-profile") return `[source: child profile ${ref.childId}]`
      return ref.snippet ? `[source: ${ref.entryId} — "${ref.snippet}"]` : `[source: ${ref.entryId}]`
    })
    .join(" ")

export const digestToText = (digest: HandoffDigest): string => {
  const lines: string[] = []
  lines.push(`# Care summary for ${digest.childName}`)
  lines.push(
    `For ${digest.recipientName} — ${timeLabel(digest.window.since, digest.timezone)} through ${timeLabel(digest.window.until, digest.timezone)} (${digest.timezone}).`,
  )
  lines.push("")
  lines.push("## Since last seen")
  if (digest.claims.length === 0) lines.push("(nothing logged in this window)")
  for (const claim of digest.claims) lines.push(`- ${claim.statement} ${sourceTag(claim.sourceRefs)}`)
  if (digest.routineContext.length > 0) {
    lines.push("")
    lines.push("## Family routine notes")
    for (const claim of digest.routineContext) lines.push(`- ${claim.statement} ${sourceTag(claim.sourceRefs)}`)
  }
  if (digest.unresolvedQuestions.length > 0) {
    lines.push("")
    lines.push("## Things to check")
    for (const question of digest.unresolvedQuestions)
      lines.push(`- [${question.reason}] ${question.question} ${sourceTag(question.sourceRefs)}`)
  }
  lines.push("")
  lines.push("## Coverage")
  for (const row of digest.coverage)
    lines.push(`- ${categoryLabel[row.category]}: ${row.observed} ${row.observed === 1 ? "event" : "events"} — ${row.note}`)
  if (digest.gapDisclosures.length > 0) {
    lines.push("")
    lines.push("## Days without entries")
    for (const gap of digest.gapDisclosures) lines.push(`- ${gap.day}: ${gap.disclosure}`)
  }
  if (digest.suggestedFollowUps.length > 0) {
    lines.push("")
    lines.push("## You might want to ask")
    for (const suggestion of digest.suggestedFollowUps) lines.push(`- ${suggestion}`)
  }
  if (digest.sourceIndex.length > 0) {
    lines.push("")
    lines.push("## Where everything came from")
    for (const source of digest.sourceIndex)
      lines.push(
        `- ${source.entryId} — capture ${source.captureId} at ${timeLabel(source.createdAt, digest.timezone)}: "${source.snippet}"`,
      )
  }
  return lines.join("\n")
}

export const answerToText = (answer: FollowUpAnswer): string => {
  switch (answer._tag) {
    case "answered":
      return `${answer.claim.statement} ${sourceTag(answer.claim.sourceRefs)}`
    case "not-logged":
      return answer.statement
    case "refused-medical":
      return answer.guidance
    case "refused-out-of-window":
      return answer.guidance
  }
}
