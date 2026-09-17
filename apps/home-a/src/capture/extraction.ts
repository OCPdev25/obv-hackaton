/**
 * Deterministic rule-based extraction double (provider-agnostic stand-in).
 *
 * Canonical domain envelope in and out: builds an `ExtractionRequest`, and
 * returns an `ExtractionResult` decoded through the domain schema — so every
 * proposed event already satisfies the canonical `EventFields` (including
 * `producedBy` lineage pointing at this run's attempt record). No live LLM
 * call: the same utterance always yields the same proposals.
 */
import { Schema } from "effect"
import {
  ExtractionRequest,
  ExtractionResult,
  type Event,
  type EventCategory,
} from "@journal/domain"

export const EXTRACTOR_VERSION = "home-a-extraction-double/0.1.0"
export const CONTRACT_SCHEMA_VERSION = "0.3.0"

export interface ExtractionDoubleInput {
  readonly captureId: string
  readonly attempt: number
  readonly transcript: string
  /** Capture wall-clock (unix ms) — the reference point for relative times. */
  readonly capturedAt: number
  readonly householdId: string
  /** Child roster for name/alias → childId resolution. */
  readonly childIds: readonly string[]
  readonly childNames: readonly { readonly name: string; readonly aliases: readonly string[] }[]
  /** Last child mentioned — fallback for childless follow-on clauses. */
  readonly defaultChildId: string
  /** Attempt record id this run owns (Event.producedBy.attemptId). */
  readonly attemptRecordId: string
}

export interface UnstructuredClause {
  readonly text: string
  readonly reason: string
}

export interface ExtractionOutcome {
  readonly captureId: string
  readonly attempt: number
  readonly events: readonly Event[]
  /** Parallel to `events` (one entry per event, expanded "both" included). */
  readonly sourceClauses: readonly string[]
  readonly unstructured: readonly UnstructuredClause[]
}

// --- clause splitting ---------------------------------------------------------

const CLAUSE_SPLIT = /(?:,\s*(?:then|and|but)\s+|\s+and\s+then\s+|\s+then\s+|;\s+|\?\s+|\.\s+|!\s+)/

function splitClauses(transcript: string): string[] {
  return transcript
    .split(CLAUSE_SPLIT)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

// --- categories ------------------------------------------------------------------

interface CategoryRule {
  readonly category: EventCategory
  readonly pattern: RegExp
  readonly priority: number
}

const CATEGORY_RULES: readonly CategoryRule[] = [
  { category: "milestone", pattern: /\b(first|pedal(ed|s)?|learned to|new word|rolled over|sat up|tooth|steps)\b/i, priority: 10 },
  { category: "sleep", pattern: /\b(napped?|napping|asleep|bedtime|sleep|woke|waking|wakes|down (?:by|at)|crashed)\b/i, priority: 6 },
  { category: "meal", pattern: /\b(ate|eat|eating|refused|refuse|milk|formula|ounces|oz\b)|\b(breakfast|lunch|dinner|snack|eggs|toast|oatmeal|pancakes?|yogurt|berries|fruit|veggies|pasta|rice|chicken|crackers|applesauce|banana|cheese|sandwich|soup|smoothie|pickle|pretzels|pizza|waffle|cereal|sweet potato|grilled cheese)\b/i, priority: 8 },
  { category: "potty", pattern: /\b(poop(ed|ing)?|pee(d|ing)?|potty|diaper|toilet|underwear)\b/i, priority: 7 },
  { category: "mood", pattern: /\b(meltdown|tantrum|grumpy|crank(y|ier)|fussy|happy|giggly|giggled|cheerful|sad|cried|crying|upset|clingy|delighted|proud|frustrated|nervous)\b/i, priority: 4 },
  { category: "school", pattern: /\b(school|pre-?k|classroom|teacher|drop-?off|pickup|circle time|water play|show and tell|bucket brigade)\b/i, priority: 3 },
]

/** Content that stays raw on purpose (no matching contract category). */
const UNSTRUCTURED_RULES: ReadonlyArray<{ readonly pattern: RegExp; readonly reason: string }> = [
  { pattern: /\b(checkup|doctor|pediatrician|appointment|shot|vaccine|fever|medicine|dose|symptom|rash|thermometer)\b/i, reason: "health-note-raw" },
]

function pickCategory(clause: string): EventCategory | undefined {
  let matches = CATEGORY_RULES.filter((rule) => rule.pattern.test(clause))
    .sort((a, b) => b.priority - a.priority)
  // A SKIPPED nap is not a sleep record — "skipped her nap" never becomes sleep.
  if (/\bskip(ped|ping)?\b/i.test(clause)) {
    matches = matches.filter((m) => m.category !== "sleep")
  }
  // "napped 45 minutes after lunch" — duration wording wins over the meal word.
  const hasDuration = /\b\d{1,3}\s*(minutes?|mins?|hours?|hrs?)\b/i.test(clause)
  if (hasDuration) {
    const sleep = matches.find((m) => m.category === "sleep")
    if (sleep !== undefined) return "sleep"
  }
  return matches[0]?.category
}

function unstructuredReason(clause: string): string | undefined {
  return UNSTRUCTURED_RULES.find((rule) => rule.pattern.test(clause))?.reason
}

// --- quantities --------------------------------------------------------------------

function extractQuantity(clause: string): Record<string, number> | undefined {
  const duration = clause.match(/\b(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b/i)
  if (duration?.[1] !== undefined) {
    const value = Number.parseInt(duration[1], 10)
    const unit = (duration[2] ?? "").toLowerCase()
    const minutes = unit.startsWith("h") ? value * 60 : value
    return { minutes }
  }
  const count = clause.match(/\b(three|two|one|four|five)\b/i)
  if (count?.[1] !== undefined) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 }
    const value = words[(count[1] ?? "").toLowerCase()]
    if (value !== undefined) return { count: value }
  }
  return undefined
}

// --- time resolution ------------------------------------------------------------------

/** Day-part → local hour (the 2026 synthetic dataset is America/New_York, EDT = UTC−4). */
const DAY_PART_HOURS: ReadonlyArray<{ readonly pattern: RegExp; readonly hour: number }> = [
  { pattern: /\bthis morning\b/i, hour: 8 },
  { pattern: /\bmid-morning\b/i, hour: 10 },
  { pattern: /\bat lunch\b|\blunchtime\b/i, hour: 12 },
  { pattern: /\bthis afternoon\b/i, hour: 14 },
  { pattern: /\btonight\b/i, hour: 19 },
  { pattern: /\bthis evening\b/i, hour: 18 },
]

const MEAL_HINT_HOURS: Record<string, number> = { breakfast: 8, lunch: 12, dinner: 18, bedtime: 20 }

/** UTC midnight (unix ms) of the day containing `atMs`. */
function utcMidnight(atMs: number): number {
  return atMs - ((atMs / 1000) % 86400) * 1000
}

function localHour(atMs: number): number {
  return new Date(atMs).getUTCHours() - 4
}

function resolveTimestamp(clause: string, capturedAt: number): number {
  const clock = clause.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b|\bfrom\s+(\d{1,2})(?::(\d{2}))?\b|\bto\s+(\d{1,2})(?::(\d{2}))?\b/)
  if (clock !== null) {
    const hourText = clock[1] ?? clock[3] ?? clock[5]
    const minuteText = clock[2] ?? clock[4] ?? clock[6]
    if (hourText !== undefined) {
      let hour = Number.parseInt(hourText, 10)
      const minute = minuteText !== undefined ? Number.parseInt(minuteText, 10) : 0
      // "at 3" spoken in the afternoon means 15:00.
      if (hour <= 11 && localHour(capturedAt) >= 12) hour += 12
      return utcMidnight(capturedAt) + (hour + 4) * 3_600_000 + minute * 60_000
    }
  }
  for (const dayPart of DAY_PART_HOURS) {
    if (dayPart.pattern.test(clause)) {
      return utcMidnight(capturedAt) + (dayPart.hour + 4) * 3_600_000
    }
  }
  const mealHint = clause.match(/\b(breakfast|lunch|dinner|bedtime)\b/i)
  if (mealHint !== null) {
    const hour = MEAL_HINT_HOURS[(mealHint[1] ?? "").toLowerCase()] ?? 12
    return utcMidnight(capturedAt) + (hour + 4) * 3_600_000
  }
  return capturedAt
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// --- the double ------------------------------------------------------------------------

function buildDraftEvents(
  input: ExtractionDoubleInput,
): { readonly drafts: readonly { readonly fields: unknown; readonly sourceClause: string }[]; readonly unstructured: UnstructuredClause[] } {
  const clauses = splitClauses(input.transcript)
  const drafts: { fields: unknown; sourceClause: string }[] = []
  const unstructured: UnstructuredClause[] = []
  let lastMentionedChildId: string | undefined

  for (const clause of clauses) {
    // childNames is index-aligned with childIds (name-vs-id mismatch here made
    // every clause resolve to the default child).
    const mentioned = input.childIds
      .map((childId, index) => ({ childId, def: input.childNames[index] }))
      .filter(({ childId, def }) => {
        if (def === undefined) return false
        const names = [def.name, ...def.aliases]
        return names.some((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(clause))
      })
      .map(({ childId }) => childId)
    // "Both kids down by 8" expands to one event per child.
    const bothChildren = /\bboth\b/i.test(clause) && mentioned.length === 0
    const targetChildIds: readonly string[] = bothChildren
      ? input.childIds
      : mentioned.length > 0
        ? mentioned
        : [lastMentionedChildId ?? input.defaultChildId]
    if (mentioned.length > 0) lastMentionedChildId = mentioned[mentioned.length - 1]

    const category = pickCategory(clause)
    if (category === undefined) {
      const reason = unstructuredReason(clause) ?? "no-matching-contract-category"
      unstructured.push({ text: clause, reason })
      continue
    }

    const timestamp = resolveTimestamp(clause, input.capturedAt)
    const payload = extractQuantity(clause)
    for (const targetChildId of targetChildIds) {
      drafts.push({
        sourceClause: clause,
        fields: {
          householdId: input.householdId,
          childId: targetChildId,
          category,
          timestamp,
          ...(payload === undefined ? {} : { payload }),
          confidence: 0.9,
          producedBy: {
            attemptId: input.attemptRecordId,
            extractorVersion: EXTRACTOR_VERSION,
            schemaVersion: CONTRACT_SCHEMA_VERSION,
          },
        },
      })
    }
  }
  return { drafts, unstructured }
}

/**
 * Run the deterministic double: canonical request in, canonical envelope out.
 * The result is decoded through the domain `ExtractionResult` schema — the
 * store receives only envelope-valid, EventFields-valid proposals.
 */
export function runExtraction(input: ExtractionDoubleInput): ExtractionOutcome {
  const request = Schema.decodeUnknownSync(ExtractionRequest)({
    captureId: input.captureId,
    attempt: input.attempt,
    transcript: input.transcript,
  })
  const built = buildDraftEvents(input)
  const result = Schema.decodeUnknownSync(ExtractionResult)({
    captureId: request.captureId,
    attempt: request.attempt,
    events: built.drafts.map((draft) => draft.fields),
  })
  return {
    captureId: result.captureId,
    attempt: result.attempt,
    events: result.events,
    sourceClauses: built.drafts.map((draft) => draft.sourceClause),
    unstructured: built.unstructured,
  }
}
