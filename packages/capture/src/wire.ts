/**
 * Wire codecs (grafted from candidate C): the ONLY place the capture
 * pipeline's wire vocabulary (`occurredAt`, structured `quantity`) meets the
 * canonical domain vocabulary (`timestamp`, `payload` from @journal/domain).
 *
 * Both directions are schema-derived — the encoded side of each schema is the
 * wire type, and decode goes through the CANONICAL `EventSchema`, so a
 * payload the canonical contract rejects can never enter storage regardless
 * of what produced it. Note: canonical events carry no `authorId`
 * (authorship lives on Entry; extraction lineage lives in `producedBy`), so
 * the corpus-required author id is mapped at the entry/event boundary here,
 * not stored on the canonical event.
 */
import { Schema } from "effect"

import { EventSchema } from "@journal/domain"

import { CapturedEventSchema } from "./event.js"

import type { Event } from "@journal/domain"
import type { CapturedEvent } from "./event.js"

const encodeCaptureEvent = Schema.encodeSync(CapturedEventSchema)
const decodeCanonicalEvent = Schema.decodeUnknownSync(EventSchema)
const encodeCanonicalEvent = Schema.encodeSync(EventSchema)

/** Encoded (wire) form of a captured event — what JSON over the wire looks like. */
export type EncodedCaptureEvent = ReturnType<typeof encodeCaptureEvent>

/** Encoded form of the canonical Event schema. */
export type EncodedCanonicalEvent = ReturnType<typeof encodeCanonicalEvent>

/**
 * Capture-wire event → canonical Event value. The wire's `occurredAt` millis
 * becomes the canonical `timestamp`; the structured quantity becomes the
 * canonical payload keyed by its unit (the corpus convention is "oz"). The
 * wire `authorId` is dropped here — canonical events do not carry it.
 */
export const toCanonicalEvent = (captured: CapturedEvent, householdId: string, childId: string): Event => {
  const wire = encodeCaptureEvent(captured)
  return decodeCanonicalEvent({
    householdId,
    childId,
    category: wire.category,
    timestamp: wire.occurredAt,
    ...(wire.quantity === undefined ? {} : { payload: { [wire.quantity.unit ?? "oz"]: wire.quantity.value } }),
    confidence: wire.confidence,
  })
}

/** Canonical Event value → capture-wire event (authorId supplied by the entry context). */
export const fromCanonicalEvent = (event: Event, authorId: string, note?: string): CapturedEvent => {
  const wire = encodeCanonicalEvent(event)
  const payloadEntries = wire.payload === undefined ? [] : Object.entries(wire.payload)
  const quantity =
    payloadEntries.length === 1
      ? { value: payloadEntries[0]![1] as number, unit: payloadEntries[0]![0] }
      : undefined
  return {
    _tag: "Event",
    category: wire.category,
    occurredAt: wire.timestamp,
    ...(quantity === undefined ? {} : { quantity }),
    confidence: wire.confidence,
    authorId,
    ...(note === undefined ? {} : { note }),
  }
}
