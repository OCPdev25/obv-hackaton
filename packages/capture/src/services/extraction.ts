/**
 * Extraction boundary (candidate D's three layers, kept):
 *  1. interface   — what the pipeline needs from "an extractor"
 *  2. deterministic double — pure rule-based extraction (no LLM), carrying the
 *     acceptance corpus's worked-example conventions for categories, relative
 *     time, and quantities (the conventions the arena integration brief
 *     directs us to graft).
 *  3. faulty double — emits a schema-invalid event (confidence 1.5) to prove
 *     the schema boundary rejects bad candidates before they reach state.
 *
 * Every candidate event is re-decoded through `CapturedEventSchema` before it
 * is returned — the extractor's output is never trusted on its own.
 */
import { Effect, Schema } from "effect"

import { resolveOccurredAt } from "./relativeTime.js"
import { CapturedEventSchema } from "../event.js"

import type { CapturedEvent } from "../event.js"

export interface ExtractionInput {
  readonly captureId: string
  readonly childId: string
  readonly authorId: string
  readonly transcript: string
  readonly capturedAt: number
  readonly timezone: string
}

export type ExtractionError = { readonly _tag: "ExtractionFailed"; readonly reason: string }

export interface ExtractionServiceShape {
  extract: (input: ExtractionInput) => Effect.Effect<ReadonlyArray<CapturedEvent>, ExtractionError>
}

/** Corpus convention: events carry a fixed unconfirmed confidence marker. */
const UNCONFIRMED_CONFIDENCE = 0.9

/**
 * Category rules, example-adapter order (first match wins per sentence) with
 * the canonical taxonomy's remaining categories appended last. Patterns are
 * corpus-tuned (e.g. "went poop on the potty", "giggly", "drank ... ounces").
 */
const CATEGORY_RULES: ReadonlyArray<{
  readonly category: CapturedEvent["category"]
  readonly pattern: RegExp
}> = [
  { category: "potty", pattern: /\bpoop(?:ed|ing)?\b|\bpotty\b/i },
  { category: "sleep", pattern: /\bwoke up\b|\bnap(?:ped)?\b|\bbedtime\b|\bsleepy\b|\basleep\b|\bsleep\b/i },
  { category: "mood", pattern: /\bhappy\b|\bgiggly\b|\bgrumpy\b|\bsad\b|\bfussy\b|\bcheerful\b/i },
  { category: "meal", pattern: /\bmilk\b|\bpasta\b|\bwater\b|\bbreakfast\b|\blunch\b|\bdinner\b|\bsnack\b|\bate\b|\bdrank\b|\bhad\b/i },
  { category: "milestone", pattern: /\bfirst time\b|\bcrawled\b|\brolled over\b|\btook steps\b/i },
  { category: "school", pattern: /\bschool\b|\bdaycare\b|\bteacher\b/i },
]

const QUANTITY_PATTERN = /(\d+(?:\.\d+)?)\s+ounces? of/i

/** Example-adapter sentence split; control-char transcripts stay one segment. */
const splitSentences = (transcript: string): ReadonlyArray<string> =>
  transcript
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)

const extractionError = (error: unknown): ExtractionError => ({
  _tag: "ExtractionFailed",
  reason: error instanceof Error ? error.message : String(error),
})

/**
 * The deterministic double: per sentence, first matching category rule wins;
 * a category mention with no resolvable time yields NO event (never invent an
 * instant); every candidate is decoded through `CapturedEventSchema`, so a
 * rule bug fails the extraction instead of smuggling invalid data downstream.
 */
export const makeDeterministicExtractor = (): ExtractionServiceShape => ({
  extract: (input: ExtractionInput) =>
    Effect.try({
      try: () => {
        const events: CapturedEvent[] = []
        for (const sentence of splitSentences(input.transcript)) {
          const rule = CATEGORY_RULES.find((candidate) => candidate.pattern.test(sentence))
          if (rule === undefined) continue
          const occurredAt = resolveOccurredAt({
            transcript: sentence,
            capturedAt: input.capturedAt,
            timezone: input.timezone,
          })
          if (occurredAt === undefined) continue
          const quantityMatch = QUANTITY_PATTERN.exec(sentence)
          const candidate = {
            _tag: "Event" as const,
            category: rule.category,
            occurredAt,
            ...(quantityMatch === null ? {} : { quantity: { value: Number(quantityMatch[1]), unit: "oz" } }),
            confidence: UNCONFIRMED_CONFIDENCE,
            authorId: input.authorId,
            note: sentence,
          }
          // Schema boundary: decode (don't cast) so an invalid candidate
          // fails the extraction instead of reaching state or storage.
          events.push(Schema.decodeUnknownSync(CapturedEventSchema)(candidate))
        }
        return events
      },
      catch: extractionError,
    }),
})

/**
 * Faulty double: announces a valid-looking event with confidence 1.5 — outside
 * the canonical range. Decoding must reject it, proving the boundary is real.
 */
export const makeFaultyExtractor = (): ExtractionServiceShape => ({
  extract: (input: ExtractionInput) =>
    Effect.try({
      try: () => [
        Schema.decodeSync(CapturedEventSchema)({
          _tag: "Event",
          category: "potty",
          occurredAt: input.capturedAt,
          confidence: 1.5,
          authorId: input.authorId,
        }),
      ],
      catch: extractionError,
    }),
})
