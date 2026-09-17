/**
 * Deterministic rule-based extraction double for Candidate B — implements the
 * canonical `TranscriptEventExtractor` contract from @journal/extraction (the
 * { captureId, attempt } envelope) with fixed pattern rules, NO LLM call.
 *
 * Rule-table credit: the category-pattern approach proven in
 * evaluation/src/example/example-adapter.ts, extended here for mixed-topic
 * multi-clause utterances, child attribution, and quantity payloads
 * (nap minutes, bottle ounces).
 *
 * Known gap, mirrored in the PR's shared-change requests: `ExtractionRequest`
 * does not yet carry capture context (household, authorId, capturedAt,
 * timezone, child roster). That is the context-envelope proposal's job. Until
 * it lands, `makeCaptureScopedExtractor` closes over the context per capture —
 * a replaceable seam, not a contract change.
 */
import { Effect } from "effect"
import type { Event, EventCategory, ExtractionRequest, ExtractionResult } from "@journal/domain"
import type { TranscriptEventExtractor } from "@journal/extraction"

/** The capture context the future envelope will carry; closed over per capture for now. */
export interface CaptureContext {
  readonly householdId: string
  readonly authorId: string
  readonly capturedAt: number
  readonly timezone: string
  /** Child display name (lowercased) -> childId. */
  readonly childIdByName: Readonly<Record<string, string>>
}

/** A clause that could not be typed or attributed. Extraction failure never blocks capture. */
export interface DroppedClause {
  readonly clause: string
  readonly reason: "no-typing-rule" | "unresolved-child"
}

export interface ExtractionOutcome {
  readonly events: readonly Event[]
  readonly dropped: readonly DroppedClause[]
}

/** Rule priority: the first matching rule types the clause. */
const RULES: readonly { readonly category: EventCategory; readonly pattern: RegExp }[] = [
  { category: "potty", pattern: /\b(poop(?:ed|ing)?|potty|peed|diaper)\b/i },
  { category: "milestone", pattern: /\b(pedaled?|first (?:time|word|words|steps|tooth|book))\b/i },
  { category: "school", pattern: /\b(pre-k|preschool|school|classroom|teacher|field trip|drop-?off)\b/i },
  { category: "sleep", pattern: /\b(nap(?:ped|ping)?|bedtime|asleep|sleep|night wake|woke up|wake-?up)\b/i },
  { category: "meal", pattern: /\b(ate|eats?|eating|breakfast|lunch|dinner|supper|snack|bottle|drank|milk|ounces?|oz)\b/i },
  { category: "mood", pattern: /\b(meltdown|grumpy|happy|giggly|fussy|cheerful|sad|proud|teary|cranky)\b/i },
]

const splitClauses = (transcript: string): readonly string[] =>
  transcript
    .split(/(?<=[.!?,;])\s+/)
    .map((clause) => clause.replace(/^(?:oh\s+and\s+|and\s+then\s+|then\s+|and\s+|also\s+|but\s+)/i, "").trim())
    .filter((clause) => clause.length > 0)

const resolveChildId = (clause: string, context: CaptureContext, lastMentioned: { id?: string }): string | undefined => {
  for (const [name, childId] of Object.entries(context.childIdByName)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(clause)) {
      lastMentioned.id = childId
      return childId
    }
  }
  return lastMentioned.id
}

/**
 * Hour resolution without meridiem (deterministic conventions): 1–6 reads as
 * PM (nap/bedtime hours); 4–11 also reads as PM when the clause names
 * bedtime/night/tonight/dinner/supper; 7–11 otherwise AM; 12 PM; 0 AM.
 */
function resolveHour(hour: number, clause: string): number {
  const eveningContext = /\b(bedtime|night|tonight|dinner|supper)\b/i.test(clause)
  if (hour === 0) return 0
  if (hour === 12) return 12
  if (hour >= 1 && hour <= 6) return hour + 12
  if (eveningContext && hour >= 4 && hour <= 11) return hour + 12
  return hour
}

const to24h = (hour: number, minute: number, meridiem: string): { hour: number; minute: number } => {
  const ampm = meridiem.toLowerCase()
  if (ampm === "pm" && hour !== 12) return { hour: hour + 12, minute }
  if (ampm === "am" && hour === 12) return { hour: 0, minute }
  return { hour, minute }
}

/** Resolves the clause's time expression against the capture's wall date + `capturedAt`. */
function resolveOccurredAt(clause: string, context: CaptureContext): number {
  const wall = new Intl.DateTimeFormat("en-US", {
    timeZone: context.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(context.capturedAt))
  const get = (type: string): number => Number(wall.find((p) => p.type === type)?.value ?? "1")
  const year = get("year")
  const month = get("month")
  const day = get("day")

  // Wall-clock time in the household zone -> Unix ms (offset taken at the target instant).
  const zoneToUtc = (hour: number, minute: number): number => {
    const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: context.timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(guess))
    const g = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0")
    const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"))
    return guess - (asUTC - (guess - (guess % 1000)))
  }

  const clock = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(clause)
  if (clock !== null) {
    const rawHour = Number(clock[1])
    const minute = Number(clock[2] ?? "0")
    const meridiem = (clock[3] ?? "").toLowerCase()
    const hour = meridiem === "" ? resolveHour(rawHour, clause) : to24h(rawHour, minute, meridiem).hour
    return zoneToUtc(hour, minute)
  }
  if (/\bthis morning\b/i.test(clause)) return zoneToUtc(8, 0)
  if (/\bthis afternoon\b/i.test(clause)) return zoneToUtc(14, 0)
  if (/\btonight\b/i.test(clause)) return zoneToUtc(19, 30)
  if (/\bearlier today\b/i.test(clause)) return context.capturedAt - 2 * 3600_000
  return context.capturedAt
}

const payloadFor = (clause: string, category: EventCategory): Record<string, number> | undefined => {
  const minutes = /(\d{1,3})\s*(?:min|minutes?)\b/i.exec(clause)
  if (minutes !== null && category === "sleep") return { minutes: Number(minutes[1]) }
  const ounces = /(\d+(?:\.\d+)?)\s*(?:ounces?|oz)\b/i.exec(clause)
  if (ounces !== null && category === "meal") return { ounces: Number(ounces[1]) }
  return undefined
}

/**
 * Classify each clause into at most one event (deterministic rule priority).
 * A clause with no matching rule — or with no attributable child — is dropped
 * with a reason; the raw transcript is preserved byte-for-byte by the store.
 */
export function extractProposedEvents(transcript: string, context: CaptureContext): ExtractionOutcome {
  const events: Event[] = []
  const dropped: DroppedClause[] = []
  const lastMentioned: { id?: string } = {}

  for (const clause of splitClauses(transcript)) {
    const rule = RULES.find((r) => r.pattern.test(clause))
    if (rule === undefined) {
      dropped.push({ clause, reason: "no-typing-rule" })
      continue
    }
    const childId = resolveChildId(clause, context, lastMentioned)
    if (childId === undefined) {
      dropped.push({ clause, reason: "unresolved-child" })
      continue
    }
    // optionalKey payload: the key is ABSENT when there is no quantity —
    // an explicit `payload: undefined` would fail schema validation.
    const payload = payloadFor(clause, rule.category)
    events.push({
      householdId: context.householdId,
      childId,
      category: rule.category,
      timestamp: resolveOccurredAt(clause, context),
      ...(payload !== undefined ? { payload } : {}),
      confidence: 0.85, // deterministic double's raw guess — never caregiver-confirmed
    })
  }
  return { events, dropped }
}

/**
 * Adapt the pure classifier to the canonical `TranscriptEventExtractor`
 * contract: requests and results both carry the { captureId, attempt }
 * envelope. Runs synchronously over the closed-over capture context.
 */
export const makeCaptureScopedExtractor =
  (context: CaptureContext): TranscriptEventExtractor => ({
    extractEvents: ({ captureId, attempt, transcript }: ExtractionRequest) =>
      Effect.succeed({
        captureId,
        attempt,
        events: extractProposedEvents(transcript, context).events,
      } satisfies ExtractionResult),
  })
