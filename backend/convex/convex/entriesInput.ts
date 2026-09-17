import { Schema } from "effect"

import { AppendEventsInput, CaptureId, EntryFields, EventFields, convexId } from "@journal/domain"

/**
 * Function-level operation contracts + pure decision logic for the entry
 * functions (`./entries.ts`) — the same validator-level evidence pattern the
 * knowledge functions established in `knowledgeInput.ts` (N1: no local Convex
 * runtime harness; handler wiring is proven by strict typecheck against the
 * generated API).
 *
 * Arena-integration grafts, kept OUT of packages/domain (rule-2 discipline —
 * canonical contracts are untouched; the raw-captures log and the append
 * lifecycle are backend-local until a contract fold promotes them):
 *
 *  - Candidate B's APPEND-ONLY RAW-CAPTURES LOG: the first durable write of a
 *    capture is the verbatim transcript, immutable afterwards. `entries` rows
 *    are mutable (extraction status, structured event links, and later the
 *    v0.4 retraction fold), so the recoverable, auditable raw text lives here.
 *  - Candidate B's RAW-BEFORE-EVENTS INVARIANT, enforced server-side: events
 *    may only attach to an entry whose capture has a durable raw-capture row
 *    (or which is a manual entry — the entry row itself is then the raw
 *    record).
 *  - Candidate A's SERVER-SIDE RE-DECODE: event payloads arriving from any
 *    client are decoded through the canonical `EventFields` schema here, in
 *    the handler's trust boundary — a confidence of 1.5 is rejected by the
 *    backend itself, not merely by a well-behaved client.
 *
 * Everything in this file is pure (no Convex runtime imports) so the decision
 * logic is executable as validator-level evidence.
 */

/**
 * The append-only raw-capture row. Composed from canonical field schemas —
 * `CaptureId` for idempotency-key compatibility with `CreateEntryInput`, the
 * entry's `rawTranscript`/`authorId` fields verbatim — never restated. No
 * mutation ever updates a raw-captures row: the log is append-only.
 */
export const RawCaptureFields = {
  captureId: CaptureId,
  childId: convexId("children"),
  authorId: EntryFields.authorId,
  rawTranscript: EntryFields.rawTranscript,
  /** Capture instant (Unix ms) — never process time. */
  capturedAt: Schema.Number,
  /** Server append instant (Unix ms). */
  createdAt: Schema.Number,
} satisfies Schema.Struct.Fields

/** The immutable raw-capture row for one capture session (append-only log). */
export const buildRawCaptureRow = (input: {
  readonly captureId: typeof CaptureId["Type"]
  readonly childId: string
  readonly authorId: string
  readonly rawTranscript: string
  readonly now: number
}): Schema.Schema.Type<Schema.Struct<typeof RawCaptureFields>> => ({
  captureId: input.captureId,
  childId: input.childId,
  authorId: input.authorId,
  rawTranscript: input.rawTranscript,
  // Capture instant == append instant here: the row is written at capture
  // time. Kept as distinct fields so a recovery-path backfill (an interrupted
  // capture whose raw text arrives late) can preserve the original instant.
  capturedAt: input.now,
  createdAt: input.now,
})

/** The entry row the append path needs — a structural subset of EntryFields. */
export interface EntryRef {
  readonly captureId?: string | undefined
  readonly structuredEventIds: ReadonlyArray<string>
  readonly extractionStatus: "pending" | "structured" | "failed"
}

/** The raw-capture evidence the append path needs. */
export interface RawCaptureRef {
  readonly captureId: string
}

/**
 * Candidate B's raw-before-events decision (pure): returns the fail-closed
 * rejection when events may not attach to this entry, or null when they may.
 * An entry produced by a capture session (captureId present) MUST have a
 * durable raw-capture row; a manual entry without a capture id is its own
 * raw record and may proceed.
 */
export const requireRawCaptureBeforeEvents = (
  entry: EntryRef,
  rawCapture: RawCaptureRef | undefined,
): string | null => {
  if (entry.captureId === undefined) return null
  if (rawCapture === undefined || rawCapture.captureId !== entry.captureId) {
    return `entry capture ${entry.captureId} has no durable raw capture — events cannot precede the caregiver's words`
  }
  return null
}

/**
 * Server-side re-decode (candidate A): decode the raw client args through the
 * canonical AppendEventsInput — whose events are `EventFields` — returning
 * the decoded value or the failure reason. A confidence of 1.5 fails here,
 * on the server, regardless of what the client validated.
 */
export const decodeAppendEvents = (
  rawArgs: unknown,
):
  | { readonly ok: true; readonly value: typeof AppendEventsInput["Type"] }
  | { readonly ok: false; readonly reason: string } => {
  try {
    return { ok: true, value: Schema.decodeUnknownSync(AppendEventsInput)(rawArgs) }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/** Set-once attach decision (pure): how the decoded events apply to the entry. */
export type AttachDecision =
  | {
      readonly kind: "attach"
      readonly eventRows: ReadonlyArray<Schema.Schema.Type<Schema.Struct<typeof EventFields>>>
    }
  | { readonly kind: "idempotent" }
  | { readonly kind: "conflict"; readonly reason: string }

/**
 * Decide how a decoded append applies to the entry's current state: first
 * attach wins and rows are built deriving household/child from the ENTRY
 * (never from client input — fail-closed tenancy), the pipeline's own retry
 * (same event count) is an idempotent no-op, and a DIFFERENT event set on an
 * entry that already carries events is a conflict, not an overwrite.
 */
export const decideAttach = (
  entry: EntryRef,
  events: typeof AppendEventsInput["Type"]["events"],
  context: { readonly householdId: string; readonly childId: string },
): AttachDecision => {
  if (events.length === 0) {
    // An empty append is invalid input, not a silent transition: attaching
    // nothing must not flip the entry to "structured".
    return {
      kind: "conflict",
      reason: "empty event append — extraction either failed or produced nothing; the entry stays pending",
    }
  }
  if (entry.structuredEventIds.length > 0) {
    if (entry.structuredEventIds.length === events.length) return { kind: "idempotent" }
    return {
      kind: "conflict",
      reason: `entry already carries ${entry.structuredEventIds.length} events; events are set-once per entry`,
    }
  }
  const eventRows = events.map((event) => ({
    householdId: context.householdId,
    childId: context.childId,
    category: event.category,
    timestamp: event.timestamp,
    ...(event.payload === undefined ? {} : { payload: event.payload }),
    confidence: event.confidence,
    ...(event.producedBy === undefined ? {} : { producedBy: event.producedBy }),
  }))
  return { kind: "attach", eventRows }
}
