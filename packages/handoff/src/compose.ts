import { Schema } from "effect"

import {
  CATEGORY_ORDER,
  DigestClaim,
  DigestInput,
  HandoffDigest,
  HandoffEntry,
  HandoffEvent,
  LOW_CONFIDENCE_THRESHOLD,
  SourceIndexEntry,
  SourceRef,
  UnresolvedQuestion,
  type HandoffEventCategory,
} from "./contracts.js"
import {
  assertCareNeutral,
  coverageObservedNote,
  coverageZeroNote,
  gapDayDisclosure,
} from "./gaps.js"
import { dayKey, daysInWindow, timeLabel } from "./time.js"

const MAX_WINDOW_DAYS = 366
const SNIPPET_LENGTH = 80

export const categoryLabel: Record<HandoffEventCategory, string> = {
  potty: "Potty",
  meal: "Meal",
  sleep: "Sleep",
  mood: "Mood",
  milestone: "Milestone",
  school: "School",
}

/** First ~80 characters of a raw transcript — a faithful quote, never a paraphrase. */
export const entrySnippet = (transcript: string): string =>
  transcript.length <= SNIPPET_LENGTH ? transcript : `${transcript.slice(0, SNIPPET_LENGTH)}…`

/** Link back to the capture an entry came from. */
export const entryRef = (entry: HandoffEntry, snippet = entrySnippet(entry.rawTranscript)): SourceRef => ({
  _tag: "entry",
  entryId: entry.entryId,
  captureId: entry.captureId,
  snippet,
})

/** Refusal-link for unpublished captures: cites the entry without quoting its content. */
const unpublishedRef = (entry: HandoffEntry): SourceRef => entryRef(entry, "")

const payloadLabel = (payload: Record<string, number> | undefined): string => {
  if (!payload) return ""
  const parts: string[] = []
  for (const [key, value] of Object.entries(payload)) {
    if (key === "minutes") parts.push(`${value} min`)
    else if (key === "ounces") parts.push(`${value} oz`)
    else parts.push(`${key}: ${value}`)
  }
  return parts.join(", ")
}

/** System-generated claim text: category + structured payload + local time, nothing else. */
export const eventStatement = (event: HandoffEvent, timeZone: string): string => {
  const label = categoryLabel[event.category]
  const at = timeLabel(event.timestamp, timeZone)
  const payload = payloadLabel(event.payload)
  return `${label} at ${at}${payload ? ` — ${payload}` : ""}.`
}

const byTimestamp = (a: HandoffEvent, b: HandoffEvent): number => a.timestamp - b.timestamp

/** Entries inside [lastSeenAt, generatedAt), oldest first. */
export const windowEntries = (input: DigestInput): HandoffEntry[] =>
  input.entries
    .filter((entry) => entry.createdAt >= input.lastSeenAt && entry.createdAt < input.generatedAt)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)

/** An event strong enough to state as a claim: confidence is the extractor's, stated not judged. */
export const isClaimableEvent = (event: HandoffEvent): boolean => event.confidence >= LOW_CONFIDENCE_THRESHOLD

const claimFromEvent = (entry: HandoffEntry, event: HandoffEvent, timeZone: string): DigestClaim => {
  const statement = eventStatement(event, timeZone)
  assertCareNeutral(statement)
  return {
    statement,
    category: event.category,
    occurredAt: event.timestamp,
    sourceRefs: [entryRef(entry)],
  }
}

/**
 * Shape 1 — the static since-last-seen digest.
 *
 * A fixed, reviewable document: what was logged since the recipient last
 * looked, the family's routine context, captures that need human attention,
 * per-category coverage, and explicit disclosure of days with no captures.
 * Pure and deterministic — same input, same digest.
 *
 * Publication semantics follow contract v0.2: claims cite published,
 * structured captures only. Draft captures appear solely as an
 * unresolved question that does not quote their content; pending and failed
 * extractions surface as questions too — a summary never silently omits
 * captures it could not process.
 */
export const composeSinceLastSeen = (input: DigestInput): HandoffDigest => {
  const decoded = Schema.decodeUnknownSync(DigestInput)(input)
  const { timezone, childName } = decoded
  const windowMs = decoded.generatedAt - decoded.lastSeenAt
  if (windowMs > MAX_WINDOW_DAYS * 24 * 3_600_000) {
    throw new Error(`handoff window exceeds ${MAX_WINDOW_DAYS} days`)
  }

  const claims: DigestClaim[] = []
  const questions: UnresolvedQuestion[] = []
  const sourceIndex: SourceIndexEntry[] = []
  const lowConfidence: Array<{ entry: HandoffEntry; event: HandoffEvent }> = []

  for (const entry of windowEntries(decoded)) {
    if (entry.visibility === "draft") {
      questions.push({
        question: `One capture from ${timeLabel(entry.createdAt, timezone)} is still in draft review and is not included in this summary.`,
        reason: "draft-capture",
        sourceRefs: [unpublishedRef(entry)],
      })
      continue
    }
    if (entry.extractionStatus === "pending") {
      questions.push({
        question: `The capture from ${timeLabel(entry.createdAt, timezone)} is still being processed and is not included in this summary yet.`,
        reason: "extraction-pending",
        sourceRefs: [unpublishedRef(entry)],
      })
      continue
    }
    if (entry.extractionStatus === "failed") {
      questions.push({
        question: `The capture from ${timeLabel(entry.createdAt, timezone)} could not be turned into events automatically — review it before relying on this summary.`,
        reason: "extraction-failed",
        sourceRefs: [unpublishedRef(entry)],
      })
      continue
    }
    // Published + structured: the capture is a quotable source.
    sourceIndex.push({
      entryId: entry.entryId,
      captureId: entry.captureId,
      createdAt: entry.createdAt,
      snippet: entrySnippet(entry.rawTranscript),
    })
    for (const event of entry.events.slice().sort(byTimestamp)) {
      if (isClaimableEvent(event)) claims.push(claimFromEvent(entry, event, timezone))
      else lowConfidence.push({ entry, event })
    }
  }

  for (const { entry, event } of lowConfidence) {
    questions.push({
      question: `A ${categoryLabel[event.category].toLowerCase()} event at ${timeLabel(event.timestamp, timezone)} was extracted with low confidence from the capture at ${timeLabel(entry.createdAt, timezone)} — check the original capture before relying on it.`,
      reason: "low-confidence-event",
      sourceRefs: [entryRef(entry)],
    })
  }

  // Routine context: verbatim family notes, attributed to the child profile.
  const routineContext: DigestClaim[] = decoded.routineNotes.map((note) => {
    const statement = `Family note: ${note.note}`
    assertCareNeutral(statement)
    return { statement, sourceRefs: [{ _tag: "child-profile", childId: note.childId }] }
  })

  // Gap disclosure: every local day in the window with zero captures, any kind.
  const captureDays = new Set(windowEntries(decoded).map((entry) => dayKey(entry.createdAt, timezone)))
  const gapDisclosures = daysInWindow(decoded.lastSeenAt, decoded.generatedAt, timezone)
    .filter((day) => !captureDays.has(day))
    .map((day) => {
      const disclosure = gapDayDisclosure(day, childName)
      assertCareNeutral(disclosure)
      return { day, disclosure }
    })

  // Coverage: one row per taxonomy category, zero-observed rows worded as gaps in capture, not care.
  const coverage = CATEGORY_ORDER.map((category) => {
    const categoryClaims = claims.filter((claim) => claim.category === category)
    const captureCount = new Set(
      categoryClaims.flatMap((claim) =>
        claim.sourceRefs
          .filter((ref): ref is Extract<SourceRef, { _tag: "entry" }> => ref._tag === "entry")
          .map((ref) => ref.entryId),
      ),
    ).size
    const label = categoryLabel[category].toLowerCase()
    const note = categoryClaims.length === 0 ? coverageZeroNote(label) : coverageObservedNote(categoryClaims.length, captureCount, label)
    assertCareNeutral(note)
    return { category, observed: categoryClaims.length, captureCount, note }
  })

  // Suggested follow-ups make the static shape a bridge into the interactive one.
  const suggestions: string[] = []
  for (const row of coverage) {
    if (row.observed === 0) suggestions.push(`Were there any ${categoryLabel[row.category].toLowerCase()} moments worth logging?`)
  }
  for (const question of questions) {
    if (question.reason !== "low-confidence-event") suggestions.push("Is there anything to review in the capture behind this question?")
  }
  const uniqueSuggestions = Array.from(new Set(suggestions)).slice(0, 4)

  const digest = {
    childId: decoded.childId,
    childName: decoded.childName,
    recipientName: decoded.recipientName,
    generatedAt: decoded.generatedAt,
    timezone: decoded.timezone,
    window: { since: decoded.lastSeenAt, until: decoded.generatedAt },
    claims,
    routineContext,
    unresolvedQuestions: questions,
    gapDisclosures,
    coverage,
    sourceIndex,
    suggestedFollowUps: uniqueSuggestions,
  }
  // Self-check: whatever a caller passes in, the returned value satisfies the contract.
  return Schema.decodeUnknownSync(HandoffDigest)(digest)
}
