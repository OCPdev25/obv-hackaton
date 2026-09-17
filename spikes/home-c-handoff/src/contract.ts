import { Schema } from "effect"

/**
 * Contract mirror — art_I2TCG08V (Shared Child Journal — Effect v4 Schema
 * Contract v0.2), the rubric's declared vocabulary authority
 * (art_VyNYOggs, ground rule 2). Shapes are copied field-for-field; every
 * fixture in ./fixtures and every event the prototype renders decodes
 * through these schemas on the pinned effect@4.0.0-rc.115.
 *
 * Known divergence vs the merged repo implementation (packages/domain):
 * the merged Event uses `timestamp: Schema.Number` + `payload: Record` and
 * has no `_tag`/`occurredAt`/`quantity`/`authorId`/`note`. The evaluation
 * corpus adapter (evaluation/src/adapter.ts) and this prototype follow the
 * contract document instead. The mismatch is already flagged for the v0.3
 * contract fold (Event.authorId open); the home candidates are not the
 * reconciliation owner — see the evidence document, "Contract divergences".
 *
 * Wire format rules binding on fixtures (contract doc §validation):
 * - `_tag` literals present on the wire.
 * - Timestamps are unix-ms numbers on the wire (Date in domain code via
 *   Schema.DateFromMillis).
 * - Optional fields are absent — never explicitly `null`.
 * - `quantity`: absent key OR explicit undefined both valid; explicit null
 *   is NOT in contract.
 * - `note`: `optionalKey` — missing key only; explicit undefined fails
 *   decode; non-empty when present.
 */

/** Exactly six categories (contract: category literals). */
export const EventCategory = Schema.Literals(["potty", "meal", "sleep", "mood", "milestone", "school"])
export type EventCategory = typeof EventCategory["Type"]

/** Quantitative payload. */
export const Quantity = Schema.Struct({
  value: Schema.Number,
  unit: Schema.optional(Schema.String),
})
export type Quantity = typeof Quantity["Type"]

/** Extraction target (contract v0.2 "Event"). */
export const EventFields = {
  _tag: Schema.Literal("Event"),
  category: EventCategory,
  /** Unix ms on the wire; `Date` in domain code. */
  occurredAt: Schema.DateFromMillis,
  quantity: Schema.optional(Quantity),
  /** 1 = caregiver-confirmed; lower = raw extractor guess. */
  confidence: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  /** Attribution: caregiver who dictated/confirmed. */
  authorId: Schema.NonEmptyString,
  note: Schema.optionalKey(Schema.NonEmptyString),
} satisfies Schema.Struct.Fields
export const Event = Schema.Struct(EventFields)
export type Event = typeof Event["Type"]

/** Capture record (contract v0.2 "Entry"). Raw transcript always preserved. */
export const EntryFields = {
  _tag: Schema.Literal("Entry"),
  transcript: Schema.NonEmptyString,
  authorId: Schema.NonEmptyString,
  createdAt: Schema.DateFromMillis,
  /** Per-entry publication state ONLY (v0.2 decision 1). */
  visibility: Schema.Literals(["draft", "published"]),
  /** May be empty — extraction failure never blocks capture. */
  events: Schema.Array(Event),
} satisfies Schema.Struct.Fields
export const Entry = Schema.Struct(EntryFields)
export type Entry = typeof Entry["Type"]

/** Correlation envelope (v0.2 interruption semantics). */
export const CaptureId = Schema.NonEmptyString
export type CaptureId = typeof CaptureId["Type"]
/** Monotonic per capture, starting at 0. */
export const ExtractionAttempt = Schema.Int
export type ExtractionAttempt = typeof ExtractionAttempt["Type"]

export const ExtractionRequest = Schema.Struct({
  captureId: CaptureId,
  attempt: ExtractionAttempt,
  transcript: Schema.NonEmptyString,
})
export type ExtractionRequest = typeof ExtractionRequest["Type"]

export const ExtractionResult = Schema.Struct({
  captureId: CaptureId,
  attempt: ExtractionAttempt,
  events: Schema.Array(Event),
})
export type ExtractionResult = typeof ExtractionResult["Type"]

/** Stale-result suppression + idempotent completion (v0.2 rules 2 and 3). */
export const applyExtractionResult = (
  applied: ReadonlyArray<ExtractionResult>,
  result: ExtractionResult,
): ReadonlyArray<ExtractionResult> => {
  // Rule 3: applying the same (captureId, attempt) twice is a no-op.
  if (
    applied.some(
      (a) => a.captureId === result.captureId && a.attempt === result.attempt,
    )
  ) {
    return applied
  }
  // Rule 2: superseded attempts are discarded, never merged.
  const others = applied.filter((a) => a.captureId !== result.captureId)
  const previous = applied.find(
    (a) => a.captureId === result.captureId,
  )
  if (previous && previous.attempt > result.attempt) return applied
  return [...others, previous].filter((a): a is ExtractionResult => a !== undefined).concat([result])
}

/** The latest applied attempt per capture is the current event set. */
export const currentEvents = (
  applied: ReadonlyArray<ExtractionResult>,
  captureId: string,
): ReadonlyArray<Event> =>
  applied
    .filter((a) => a.captureId === captureId)
    .sort((a, b) => a.attempt - b.attempt)
    .at(-1)?.events ?? []
