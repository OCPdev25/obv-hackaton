import { Context, Effect, Layer, Schema } from "effect"
import { type CaptureId } from "./ids.ts"
import { type JournalEvent } from "./events.ts"

/**
 * Extraction turns raw transcript text into a typed JournalEvent.
 *
 * The service interface is the isolation boundary required by the contract:
 * effectful operation, named, with two implementations —
 *   - DeterministicExtraction (this file): pure keyword rules. Labeled a
 *     CONTROLLED TEST DOUBLE, but it is also the shipping offline fallback
 *     because extraction never gates capture.
 *   - Live LLM extraction lives in packages/backend (Convex action); it is
 *     cloud-dependent and labeled CLOUD-ABSENT in this slice's evidence.
 */

export class ExtractionError extends Schema.TaggedError<ExtractionError>()("ExtractionError", {
  reason: Schema.Literals(["empty", "unclassified", "live_unavailable", "live_failed"]),
  detail: Schema.optionalKey(Schema.String),
}) {}

export interface ExtractionRequest {
  readonly captureId: CaptureId
  readonly rawText: string
  readonly occurredAt: number
}

export interface ExtractionServiceApi {
  readonly extract: (request: ExtractionRequest) => Effect.Effect<JournalEvent, ExtractionError>
}

export class ExtractionService extends Context.Service<ExtractionService, ExtractionServiceApi>()(
  "@journal/contracts/ExtractionService"
) {}

export const DeterministicExtractionLayer: Layer.Layer<ExtractionService> = Layer.effect(
  ExtractionService,
  Effect.gen(function*() {
    const extract = Effect.fn("DeterministicExtraction.extract")(function*(request: ExtractionRequest) {
      const event = extractDeterministic(request)
      if (event === undefined) {
        return yield* Effect.fail(
          new ExtractionError({
            reason: "unclassified",
            detail: "no keyword rule matched the transcript",
          })
        )
      }
      return event
    })
    return ExtractionService.of({ extract })
  })
)

/** Pure rule engine so the classification itself stays unit-testable without Effect. */
export const extractDeterministic = (request: ExtractionRequest): JournalEvent | undefined => {
  const text = request.rawText.trim()
  if (text.length === 0) return undefined
  const t = text.toLowerCase()
  const occurredAt = request.occurredAt

  if (/\bfirst time\b|\bfinally\b|\bmilestone\b|\blearned (to|how)\b/.test(t)) {
    return { _tag: "milestone", label: text, occurredAt }
  }
  if (/\bpott(y|ies)\b|\bpoop(ed|ing)?\b|\bpee(d|ing)?\b|\bdiaper\b/.test(t)) {
    const isPee = /\bpee(d|ing)?\b/.test(t)
    const isPoop = /\bpoop(ed|ing)?\b|\bnumber two\b/.test(t)
    const refused = /\baccident\b|\brefused\b|\bwouldn'?t\b|\bcouldn'?t\b/.test(t)
    return {
      _tag: "potty",
      success: !refused,
      kind: isPee && isPoop ? "both" : isPee ? "pee" : isPoop ? "poop" : "pee",
      occurredAt,
    }
  }
  if (/\b(ate|eat|eating|breakfast|lunch|dinner|snack)\b/.test(t)) {
    const refused = /\bdidn'?t eat\b|\brefused\b|\bno bites\b/.test(t)
    const amount = /\bmost of\b|\bdevoured\b|\ball of it\b/.test(t)
      ? "most"
      : refused
        ? (/\bdidn'?t eat (much|a lot)\b/.test(t) ? "some" : "none")
        : "some"
    return { _tag: "meal", food: foodFrom(t), amount, occurredAt }
  }
  if (/\bnap(ped|ping)?\b|\bsleep(s|ing)?\b|\bslept\b|\basleep\b|\bbedtime\b/.test(t)) {
    const minutesMatch = /(\d+)\s*(min|minutes|mins)/.exec(t)
    const minutes = minutesMatch?.[1] !== undefined ? Number.parseInt(minutesMatch[1], 10) : undefined
    const isNight = /\bbedtime\b|\bnight\b|\bslept through\b/.test(t)
    return {
      _tag: "sleep",
      kind: isNight ? "night" : "nap",
      ...(minutes !== undefined ? { minutes } : {}),
      occurredAt,
    }
  }
  // School runs late on purpose: "had a pee accident at school" must hit the
  // potty rule first, while "drop-off was rough but she settled" must not be
  // stolen by the mood rules' "settled" keyword — so school sits after sleep
  // and before mood.
  if (/\bdrop-?off\b|\bpick(ed)? ?up\b|\bschool\b|\bteacher\b|\bclass(room)?\b/.test(t)) {
    return { _tag: "school", note: text, occurredAt }
  }
  const mood = /\bhappy\b|\bproud\b|\bexcited\b|\bdelighted\b/.test(t)
    ? "happy"
    : /\bsad\b|\bcry(ing)?\b|\btears\b/.test(t)
      ? "sad"
      : /\bupset\b|\btantrum\b|\bmelted? ?down\b|\bfussy\b|\bfrustrated\b/.test(t)
        ? "upset"
        : /\bcalm\b|\bcontent\b|\bsettled\b/.test(t)
          ? "calm"
          : /\benergetic\b|\bwild\b|\bzoomies\b/.test(t)
            ? "energetic"
            : undefined
  if (mood !== undefined) {
    return { _tag: "mood", mood, occurredAt }
  }
  return undefined
}

const foodFrom = (text: string): string => {
  const after = /\b(?:ate|had|finished|devoured)\s+(?:the\s+|some\s+|her\s+|his\s+)?([a-z][a-z-]*(?:\s+[a-z][a-z-]*)?)/.exec(text)
  return after?.[1] ?? "meal"
}
