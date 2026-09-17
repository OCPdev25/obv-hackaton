/**
 * Extraction implementations.
 *
 * PROVIDER LABEL — deterministic test double: the ONLY implementation wired in
 * this candidate is rule-based and fully deterministic (no network, no LLM).
 * The live LLM implementation is intentionally absent (labeled, not hidden):
 * no cloud provider is called anywhere in this slice.
 */
import { Effect, Schema } from "effect"
import { Event, EventCategory, type EventCategory as EventCategoryType } from "../domain/schema.js"
import type { ExtractionApi, ExtractionOutcome, ExtractionRequest } from "../domain/services.js"

const isCategory = Schema.is(EventCategory)

/**
 * Classification rule for the deterministic double: transcripts of the form
 * "<category>: <free text>" map to a structured Event; anything else is
 * unclassifiable (a realistic extraction failure the caregiver can retry
 * after rephrasing).
 */
export const classifyTranscript = (
  transcript: string,
): { category: EventCategoryType; note: string } | null => {
  const match = /^([a-z]+):\s*(.+)$/i.exec(transcript.trim())
  if (match === null) return null
  const candidate = match[1]?.toLowerCase() ?? ""
  const note = match[2]?.trim() ?? ""
  if (!isCategory(candidate)) return null
  return { category: candidate, note }
}

const decodeEventOrReason = (payload: unknown): { ok: true; event: Event } | { ok: false; reason: string } => {
  try {
    return { ok: true, event: Schema.decodeUnknownSync(Event)(payload) }
  } catch (error) {
    // Boundary decode: external (LLM-shaped) payloads that violate the domain
    // schema become data — the state machine renders the failure and the raw
    // transcript is preserved. Not a swallowed error: the reason is surfaced
    // to the caregiver.
    return {
      ok: false,
      reason: `extraction output failed domain schema validation: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Attempt plan: each entry is consumed per extract() call; the last one
 * repeats. "invalid" simulates an LLM producing a schema-violating payload
 * (unknown category + out-of-range confidence); "classify" runs the rule.
 */
export type ExtractionAttempt = "classify" | "invalid"

export const makeDeterministicExtraction = (
  attempts: ReadonlyArray<ExtractionAttempt> = ["classify"],
): ExtractionApi => {
  let attemptIndex = 0
  return {
    extract: (request: ExtractionRequest): Effect.Effect<ExtractionOutcome> =>
      Effect.sync(() => {
        const attempt = attempts[Math.min(attemptIndex, attempts.length - 1)] ?? "classify"
        attemptIndex += 1
        if (attempt === "invalid") {
          // Simulated raw LLM output that violates the domain schema.
          const rawModelOutput: unknown = {
            _tag: "Event",
            category: "naptime", // not in the six-category union
            occurredAt: Date.now(),
            confidence: 1.5, // outside [0, 1]
            authorId: request.authorId,
            note: "simulated malformed extraction output",
          }
          const decoded = decodeEventOrReason(rawModelOutput)
          if (decoded.ok) return { ok: true, events: [decoded.event] }
          return { ok: false, reason: decoded.reason }
        }
        const classified = classifyTranscript(request.transcript)
        if (classified === null) {
          return {
            ok: false,
            reason: `could not classify transcript — expected "<category>: <text>" with category in potty|meal|sleep|mood|milestone|school`,
          }
        }
        const event: Event = {
          _tag: "Event",
          category: classified.category,
          occurredAt: new Date(),
          confidence: 0.9, // deterministic double: caregiver-entered text via fixed rule
          authorId: request.authorId,
          ...(classified.note.length > 0 ? { note: classified.note } : {}),
        }
        return { ok: true, events: [event] }
      }),
  }
}
