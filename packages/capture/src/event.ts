/**
 * Capture-surface event and entry schemas (arena integration of candidate D's
 * base onto the canonical master contract).
 *
 * These are PIPELINE types for the capture slice: they speak the corpus wire
 * vocabulary (art_I2TCG08V — `_tag` literals, `occurredAt` millis, structured
 * `quantity`) because the acceptance corpus and the capture UX hold the
 * pipeline to that shape. Domain authority is preserved by composition, not
 * restatement: the category taxonomy and the confidence range come straight
 * from the canonical `EventFields` in @journal/domain, so a change to the
 * canonical contract fails to compile here instead of drifting silently.
 *
 * The mapping to the canonical storage shape (timestamp / payload) lives in
 * `./wire.ts` and is the only place the two vocabularies meet.
 */
import { Schema } from "effect"

import { CaptureId, EventFields } from "@journal/domain"

export const CapturedEventSchema = Schema.Struct({
  _tag: Schema.Literals(["Event"]),
  category: EventFields.category,
  /** Absolute instant, Unix ms — relative expressions are resolved before this point. */
  occurredAt: Schema.Number,
  quantity: Schema.optionalKey(
    Schema.Struct({
      value: Schema.Number,
      unit: Schema.optionalKey(Schema.NonEmptyString),
    }),
  ),
  confidence: EventFields.confidence,
  authorId: Schema.String,
  /** Optional free text; the source sentence for deterministic extraction. */
  note: Schema.optionalKey(Schema.NonEmptyString),
})
export type CapturedEvent = Schema.Schema.Type<typeof CapturedEventSchema>

export const EntryStatus = Schema.Literals(["draft", "published"])
export type EntryStatus = Schema.Schema.Type<typeof EntryStatus>

/**
 * The capture pipeline's entry: created as a DRAFT at raw capture (raw-first)
 * with empty events; extracted events attach to the draft; the caregiver
 * confirm flips the status. `createdAt` is the capture instant in millis —
 * never process time.
 */
export const CapturedEntrySchema = Schema.Struct({
  _tag: Schema.Literals(["Entry"]),
  captureId: CaptureId,
  childId: Schema.NonEmptyString,
  authorId: Schema.NonEmptyString,
  /** Verbatim dictated text — never trimmed, normalized, or re-encoded. */
  rawTranscript: Schema.NonEmptyString,
  createdAt: Schema.Number,
  status: EntryStatus,
  /** May be empty — extraction failure never blocks capture. */
  events: Schema.Array(CapturedEventSchema),
})
export type CapturedEntry = Schema.Schema.Type<typeof CapturedEntrySchema>
