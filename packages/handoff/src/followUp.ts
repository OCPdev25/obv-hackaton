import { Schema } from "effect"

import {
  DigestClaim,
  DigestInput,
  FollowUpAnswer,
  type HandoffEntry,
  type HandoffEvent,
  type HandoffEventCategory,
} from "./contracts.js"
import { assertCareNeutral, notLoggedForCategory, notLoggedGeneric } from "./gaps.js"
import { dayKey, timeLabel } from "./time.js"
import { categoryLabel, entryRef, entrySnippet, eventStatement, isClaimableEvent, windowEntries } from "./compose.js"

/**
 * Shape 2 — the interactive follow-up surface.
 *
 * Same ground truth as the static digest (same DigestInput), but
 * caregiver-driven: a question comes in, a grounded answer goes out. Answers
 * cite captures; refusals are explicit and never guess.
 *
 * Classification is deliberately heuristic (keyword/category matching) —
 * slot 23 replaces this with the real read-only query path. The refusals and
 * citation invariants are the part meant to survive.
 */

const MEDICAL_TOKENS = [
  "normal",
  "abnormal",
  "healthy",
  "unhealthy",
  "sick",
  "ill",
  "fever",
  "temperature",
  "medicine",
  "medication",
  "dose",
  "dosage",
  "doctor",
  "pediatrician",
  "paediatrician",
  "diagnos",
  "symptom",
  "delayed",
  "regress",
  "rash",
  "reflux",
  "constipat",
] as const

const MEDICAL_REFUSAL =
  "I can share what was logged in the journal, but I can't draw conclusions about health, development, or what's typical — for that, please talk with your child's care professional."

const CATEGORY_KEYWORDS: Record<keyof typeof categoryLabel, string[]> = {
  meal: ["meal", "ate", "eat", "eats", "eating", "breakfast", "lunch", "dinner", "snack", "milk", "bottle", "food", "formula", "ounces"],
  sleep: ["sleep", "slept", "nap", "naps", "napped", "napping", "bedtime", "crib", "asleep"],
  potty: ["potty", "poop", "pooped", "poopy", "pee", "peed", "diaper", "toilet"],
  mood: ["mood", "happy", "sad", "fussy", "giggly", "grumpy", "cranky", "cried", "crying", "tantrum"],
  milestone: ["milestone", "rolled", "crawled", "crawling", "walked", "walking", "tooth", "teeth", "waved"],
  school: ["school", "daycare", "teacher", "drop-off", "pickup", "class"],
}

const patternFor = (tokens: readonly string[]): RegExp => new RegExp(`\\b(${tokens.join("|")})`, "i")

const MEDICAL_PATTERN = patternFor(MEDICAL_TOKENS)
const OUT_OF_WINDOW_SPAN_PATTERN = /\b(last|past|this|whole)\s+(week|month|year)\b/i
const WEEK_PATTERN = /\bweek\b/i
const MONTH_YEAR_PATTERN = /\b(month|year)\b/i

const DAY = 24 * 3_600_000

export const isMedicalQuestion = (question: string): boolean => MEDICAL_PATTERN.test(question)

/**
 * Window-boundary check: refuse spans the digest cannot speak for. A mention
 * of "week"/"month"/"year" is only out of window when the window is too
 * short to contain it.
 */
export const isOutOfWindowQuestion = (question: string, windowMs: number): boolean => {
  if (OUT_OF_WINDOW_SPAN_PATTERN.test(question)) return true
  if (MONTH_YEAR_PATTERN.test(question) && windowMs < 30 * DAY) return true
  if (WEEK_PATTERN.test(question) && windowMs < 7 * DAY) return true
  return false
}

/** Taxonomy category the question is about, if any keyword matches (taxonomy order wins). */
export const matchCategory = (question: string): HandoffEventCategory | undefined => {
  for (const category of Object.keys(CATEGORY_KEYWORDS) as Array<keyof typeof categoryLabel>) {
    if (patternFor(CATEGORY_KEYWORDS[category]).test(question)) return category
  }
  return undefined
}

const answered = (claim: DigestClaim, matchedCount: number): FollowUpAnswer => ({ _tag: "answered", claim, matchedCount })

const answerFromEvents = (
  entry: HandoffEntry,
  event: HandoffEvent,
  matchedCount: number,
  timeZone: string,
): FollowUpAnswer => {
  const statement = eventStatement(event, timeZone)
  assertCareNeutral(statement)
  return answered(
    {
      statement,
      category: event.category,
      occurredAt: event.timestamp,
      sourceRefs: [entryRef(entry)],
    },
    matchedCount,
  )
}

const quotedAnswer = (entry: HandoffEntry, matchedCount: number, timeZone: string): FollowUpAnswer =>
  answered(
    {
      statement: `Mentioned in the capture from ${timeLabel(entry.createdAt, timeZone)}: "${entrySnippetQuote(entry)}"`,
      occurredAt: entry.createdAt,
      sourceRefs: [entryRef(entry)],
    },
    matchedCount,
  )

const entrySnippetQuote = (entry: HandoffEntry): string => entrySnippet(entry.rawTranscript)

/**
 * Answer one caregiver follow-up question from the window's captures.
 * Never invents, never concludes, never speaks beyond the window.
 */
export const answerFollowUp = (question: string, input: DigestInput): FollowUpAnswer => {
  const decoded = Schema.decodeUnknownSync(DigestInput)(input)
  const { timezone } = decoded
  const trimmed = question.trim()
  if (!trimmed) throw new Error("follow-up question is empty")
  const windowMs = decoded.generatedAt - decoded.lastSeenAt

  if (isMedicalQuestion(trimmed)) return { _tag: "refused-medical", guidance: MEDICAL_REFUSAL }
  if (isOutOfWindowQuestion(trimmed, windowMs)) {
    return {
      _tag: "refused-out-of-window",
      guidance: `This handoff covers ${dayKey(decoded.lastSeenAt, timezone)} through ${dayKey(decoded.generatedAt - 1, timezone)}. Ask about that window, or start a new handoff that includes earlier history.`,
    }
  }

  // Published, structured captures only — same visibility semantics as the digest.
  const published = windowEntries(decoded).filter(
    (entry) => entry.visibility === "published" && entry.extractionStatus === "structured",
  )

  const category = matchCategory(trimmed.toLowerCase())
  if (category) {
    const matches = published
      .flatMap((entry) => entry.events.filter((event) => event.category === category && isClaimableEvent(event)).map((event) => ({ entry, event })))
      .sort((a, b) => a.event.timestamp - b.event.timestamp)
    if (matches.length > 0) {
      const latest = matches[matches.length - 1]
      if (latest) return answerFromEvents(latest.entry, latest.event, matches.length, timezone)
    }
    const statement = notLoggedForCategory(categoryLabel[category].toLowerCase())
    assertCareNeutral(statement)
    return { _tag: "not-logged", statement }
  }

  // No category keyword: fall back to verbatim transcript search.
  const tokens = trimmed.toLowerCase().split(/[^a-z]+/).filter((token) => token.length >= 4)
  const matched = tokens.length > 0 ? published.filter((entry) => tokens.some((token) => entry.rawTranscript.toLowerCase().includes(token))) : []
  if (matched.length > 0) {
    const last = matched[matched.length - 1]
    if (last) return quotedAnswer(last, matched.length, timezone)
  }

  const statement = notLoggedGeneric()
  assertCareNeutral(statement)
  return { _tag: "not-logged", statement }
}
