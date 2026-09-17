import { Effect, Layer } from 'effect'
import { ExtractionError, Extractor } from '@journal/domain'
import type { ExtractorShape } from '@journal/domain'
import type { Event } from '@journal/domain'

/**
 * Deterministic heuristic extractor — the controlled test double.
 *
 * Same transcript in, same events out, no network, no clock beyond the
 * `capturedAt` argument. Keyword rules over the six canonical categories;
 * the matched sentence rides along as the event note so a reviewer can see
 * where each event came from. This is a stand-in for a live LLM provider —
 * labeled as such everywhere it runs.
 */
const RULES: ReadonlyArray<{ readonly category: Event['category']; readonly patterns: ReadonlyArray<RegExp> }> = [
  { category: 'potty', patterns: [/potty/i, /toilet/i] },
  { category: 'meal', patterns: [/\bate\b/i, /\blunch\b/i, /\bdinner\b/i, /\bbreakfast\b/i, /\bsnack\b/i] },
  { category: 'sleep', patterns: [/\bslept\b/i, /\bnap\b/i, /\bsleep\b/i, /\bbedtime\b/i] },
  { category: 'mood', patterns: [/\bhappy\b/i, /\bsad\b/i, /\bcranky\b/i, /\btemper\b/i, /\bproud\b/i] },
  { category: 'milestone', patterns: [/\bfirst time\b/i, /\blearned\b/i, /\brode\b/i, /\bmastered\b/i] },
  { category: 'school', patterns: [/\bschool\b/i, /\bteacher\b/i, /\bclass\b/i] },
]

const sentenceFor = (transcript: string, pattern: RegExp): string | undefined =>
  transcript
    .split(/(?<=[.!?])\s+/)
    .find((sentence) => pattern.test(sentence))

export const makeDeterministicExtractor = (): ExtractorShape => ({
  extract: ({ transcript, authorId, capturedAt }) =>
    Effect.sync(() => {
      const matched = new Map<Event['category'], string>()
      for (const { category, patterns } of RULES) {
        for (const pattern of patterns) {
          if (pattern.test(transcript) && !matched.has(category)) {
            const sentence = sentenceFor(transcript, pattern)
            if (sentence !== undefined) matched.set(category, sentence.trim())
            break
          }
        }
      }
      const events: Array<Event> = [...matched.entries()].map(([category, note]) => ({
        _tag: 'Event',
        category,
        occurredAt: capturedAt,
        confidence: 0.75,
        authorId,
        note,
      }))
      return events
    }),
})

export const deterministicExtractorLayer: Layer.Layer<Extractor> = Layer.effect(Extractor)(
  Effect.succeed(makeDeterministicExtractor()),
)

/**
 * Live-LLM boundary — deliberately NOT configured in the arena (cloud absent
 * by design, labeled not hidden). Any attempt to use it fails on the typed
 * error channel with `provider_unavailable`.
 */
export const unavailableProviderExtractorLayer: Layer.Layer<Extractor> = Layer.effect(Extractor)(
  Effect.succeed<ExtractorShape>({
    extract: () =>
      Effect.fail(
        new ExtractionError({
          code: 'provider_unavailable',
          detail: 'no live LLM provider configured in this arena run (cloud absent by design)',
        }),
      ),
  }),
)
