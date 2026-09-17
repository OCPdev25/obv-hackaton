/**
 * Extraction service (OpenCode pattern #4): one interface, interchangeable
 * layers.
 *
 *  - `deterministicExtractionLayer` — rule-based local extraction. REAL code
 *    path, zero network, zero cost: candidate D's default extractor. Its
 *    output is decoded through the Event schema exactly like an LLM response
 *    would be, so the validation boundary is exercised identically.
 *  - `faultyExtractionLayer` — test double simulating a misbehaving LLM that
 *    returns schema-invalid output (confidence 1.5, unknown category). Used to
 *    prove the failure + retry path.
 *  - `unconfiguredLiveExtractionLayer` — stand-in for the live LLM layer: the
 *    interface is real, the provider is NOT wired in this slice (no cloud
 *    key, no deployed backend). It fails fast with an explicit reason so the
 *    absence is labeled, never hidden.
 */
import { Context, Effect, Layer, Result, Schema } from "effect"

import type { CaptureId, CaregiverId, ChildId, Event, EventCategory } from "@journal/domain"
import { decodeEventResult } from "@journal/domain"

export class ExtractionError extends Schema.TaggedError<ExtractionError>()("ExtractionError", {
  captureId: Schema.NonEmptyString,
  reason: Schema.String,
}) {}

export interface ExtractionInput {
  readonly captureId: CaptureId
  readonly childId: ChildId
  readonly authorId: CaregiverId
  readonly transcript: string
}

export interface ExtractionServiceShape {
  extract: (input: ExtractionInput) => Effect.Effect<ReadonlyArray<Event>, ExtractionError>
}

export class ExtractionService extends Context.Service<ExtractionService, ExtractionServiceShape>()(
  "@journal/ExtractionService",
) {}

interface CandidateEvent {
  readonly category: EventCategory
  readonly note: string
  readonly quantity?: { readonly value: number; readonly unit: string }
}

const CATEGORY_RULES: ReadonlyArray<{ readonly category: EventCategory; readonly pattern: RegExp }> = [
  { category: "potty", pattern: /\b(potty|toilet|pee|poop|diaper)\b/i },
  { category: "meal", pattern: /\b(ate|eat|breakfast|lunch|dinner|snack|bottle|nursing)\b/i },
  { category: "sleep", pattern: /\b(nap|napped|sleep|slept|bedtime|asleep)\b/i },
  { category: "mood", pattern: /\b(meltdown|tantrum|giggly|grumpy|happy|cranky|mood)\b/i },
  { category: "milestone", pattern: /\b(first time|milestone|learned|new word|proud)\b/i },
  { category: "school", pattern: /\b(school|teacher|classroom|drop-?off|pick-?up)\b/i },
]

const QUANTITY_RULES: ReadonlyArray<{ readonly pattern: RegExp; readonly unit: string }> = [
  { pattern: /\b(\d+)\s*(?:hours?|hrs?)\b/i, unit: "hours" },
  { pattern: /\b(\d+)\s*(?:minutes?|mins?)\b/i, unit: "minutes" },
]

/** Deterministic rule-based extraction — the test double that behaves. */
export const extractEventsDeterministically = (transcript: string): ReadonlyArray<CandidateEvent> => {
  const sentences = transcript.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
  const seen = new Set<EventCategory>()
  const candidates: CandidateEvent[] = []
  for (const sentence of sentences) {
    for (const rule of CATEGORY_RULES) {
      if (seen.has(rule.category) || !rule.pattern.test(sentence)) continue
      seen.add(rule.category)
      const quantity = QUANTITY_RULES.map(({ pattern, unit }) => {
        const match = pattern.exec(sentence)
        return match ? { value: Number(match[1]), unit } : undefined
      }).find((q) => q !== undefined)
      candidates.push({
        category: rule.category,
        note: sentence.trim(),
        ...(quantity ? { quantity } : {}),
      })
    }
  }
  return candidates
}

/**
 * Every candidate — deterministic or LLM — crosses the same schema boundary.
 * The wire shape (millis numbers) is what an LLM would emit; `decodeEventResult`
 * is where a bad model output dies before it can poison domain state.
 */
const candidateToEvent = (
  candidate: CandidateEvent,
  occurredAt: number,
  authorId: CaregiverId,
): Effect.Effect<Event, string> => {
  const result = decodeEventResult({
    _tag: "Event",
    category: candidate.category,
    occurredAt,
    quantity: candidate.quantity,
    confidence: 0.8,
    authorId,
    note: candidate.note,
  })
  if (Result.isSuccess(result)) return Effect.succeed(result.success)
  return Effect.fail(`extracted event failed schema validation: ${String(result.failure)}`)
}

/** Real local extraction: rules + schema-validated boundary. No network. */
export const makeDeterministicExtractor = (
  now: () => number = () => Date.now(),
): ExtractionServiceShape => ({
  extract: (input) =>
    Effect.gen(function* () {
      const occurredAt = now()
      const events: Event[] = []
      const candidates = extractEventsDeterministically(input.transcript)
      for (const [index, candidate] of candidates.entries()) {
        const event = yield* Effect.mapError(
          candidateToEvent(candidate, occurredAt, input.authorId),
          (reason) => new ExtractionError({ captureId: input.captureId, reason: `event #${index}: ${reason}` }),
        )
        events.push(event)
      }
      return events
    }),
})

/** Misbehaving-LLM double: emits schema-invalid output through the same boundary. */
export const makeFaultyExtractor = (invalid: {
  readonly category?: unknown
  readonly confidence?: number
} = { confidence: 1.5 }): ExtractionServiceShape => ({
  extract: (input) =>
    Effect.gen(function* () {
      const result = decodeEventResult({
        _tag: "Event",
        category: invalid.category ?? "potty",
        occurredAt: Date.now(),
        confidence: invalid.confidence ?? 1.5,
        authorId: input.authorId,
      })
      if (Result.isSuccess(result)) return [result.success] as const
      return yield* new ExtractionError({
        captureId: input.captureId,
        reason: `model output failed schema validation: ${String(result.failure)}`,
      })
    }),
})

export const deterministicExtractionLayer = Layer.effect(
  ExtractionService,
  Effect.sync(() => makeDeterministicExtractor()),
)

export const faultyExtractionLayer = Layer.effect(
  ExtractionService,
  Effect.sync(() => makeFaultyExtractor()),
)

export const unconfiguredLiveExtractionLayer = Layer.effect(ExtractionService, Effect.succeed({
  extract: (input) =>
    Effect.fail(
      new ExtractionError({
        captureId: input.captureId,
        reason:
          "live LLM provider is not wired in candidate D (local-only slice; no cloud key, no deployed backend) — swap this layer at the model-provider boundary",
      }),
    ),
}))
