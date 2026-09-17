import type { CaptureEvent } from "./events.js"
import type { CaptureRecovery, DiscardReceipt } from "./state.js"

/**
 * Pure recovery reducer. Total over (state, event): unexpected combinations
 * are recorded as bounded anomalies instead of throwing — a recovery path
 * must never crash the capture it is recovering.
 *
 * Deterministic: every timestamp comes from the event; the reducer never
 * reads the clock, generates ids, or performs I/O. Fixtures replay
 * identically in CI, on device, and in the evaluation harness.
 *
 * Invariants (each pinned by a test):
 * 1. Raw-before-events — only TranscriptChanged and an explicit
 *    DiscardRequested may touch `rawTranscript`; every other transition
 *    preserves it verbatim.
 * 2. Attempt monotonicity — `attempt` never decreases (canonical envelope).
 * 3. Stable submission identity — `submissionId` is assigned at first submit
 *    and reused across retries; foreign ids while active are anomalies.
 * 4. No optimistic truth — `saved` is reachable ONLY through SubmitAccepted
 *    (idempotent: a repeated accept is a no-op returning the same state).
 * 5. Stale-result suppression — envelope results with attempt < current are
 *    counted and discarded, never merged (contract v0.2 rule b).
 * 6. Discard leaves a receipt — the raw text is cleared, the receipt (time,
 *    length, attempt, submission id) survives so a discarded capture is
 *    distinguishable from a missing log.
 */

export const createCapture = (input: {
  captureId: string
  authorId: string
  at: number
}): CaptureRecovery => ({
  captureId: input.captureId,
  authorId: input.authorId,
  rawTranscript: "",
  phase: "drafting",
  attempt: 0,
  updatedAt: input.at,
})

const patch = (state: CaptureRecovery, fields: Partial<CaptureRecovery>): CaptureRecovery => {
  const next: Record<string, unknown> = { ...state }
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  return next as unknown as CaptureRecovery
}

const withAnomaly = (state: CaptureRecovery, event: CaptureEvent, why: string): CaptureRecovery => {
  const existing = state.anomalies ?? []
  return patch(state, {
    anomalies: [...existing.slice(-9), `${event._tag} ignored: ${why}`],
    updatedAt: event.at,
  })
}

const bumpDuplicates = (state: CaptureRecovery, at: number): CaptureRecovery =>
  patch(state, {
    duplicateSubmissionsSuppressed: (state.duplicateSubmissionsSuppressed ?? 0) + 1,
    updatedAt: at,
  })

const bumpStale = (state: CaptureRecovery, at: number): CaptureRecovery =>
  patch(state, {
    staleResultsSuppressed: (state.staleResultsSuppressed ?? 0) + 1,
    updatedAt: at,
  })

export const reduce = (state: CaptureRecovery, event: CaptureEvent): CaptureRecovery => {
  switch (event._tag) {
    case "TranscriptChanged": {
      if (state.phase !== "drafting") {
        return withAnomaly(state, event, `transcript change while ${state.phase}`)
      }
      return patch(state, {
        rawTranscript: event.text,
        interruptedAt: undefined,
        updatedAt: event.at,
      })
    }
    case "Interrupted": {
      if (state.phase !== "drafting" && state.phase !== "pending") {
        return withAnomaly(state, event, `interruption while ${state.phase}`)
      }
      return patch(state, { interruptedAt: event.at, updatedAt: event.at })
    }
    case "Resumed":
      return patch(state, { updatedAt: event.at })
    case "SubmitRequested": {
      if (state.phase === "drafting") {
        if (state.submissionId !== undefined) {
          return withAnomaly(state, event, "draft already carries a submissionId")
        }
        return patch(state, {
          phase: "pending",
          submissionId: event.submissionId,
          extractionStatus: "pending",
          updatedAt: event.at,
        })
      }
      if (state.phase === "pending" || state.phase === "saved") {
        if (state.submissionId === event.submissionId) return bumpDuplicates(state, event.at)
        return withAnomaly(state, event, `duplicate submit with foreign id while ${state.phase}`)
      }
      return withAnomaly(state, event, `submit while ${state.phase}`)
    }
    case "RetryRequested": {
      if (state.phase !== "failed") return withAnomaly(state, event, `retry while ${state.phase}`)
      return patch(state, {
        phase: "pending",
        attempt: state.attempt + 1,
        extractionStatus: "pending",
        updatedAt: event.at,
      })
    }
    case "SubmitAccepted": {
      if (state.phase === "pending") {
        return patch(state, { phase: "saved", updatedAt: event.at })
      }
      if (state.phase === "saved") return state // idempotent completion
      return withAnomaly(state, event, `accept while ${state.phase}`)
    }
    case "SubmitRejected": {
      if (state.phase !== "pending") return withAnomaly(state, event, `rejection while ${state.phase}`)
      if (event.attempt < state.attempt) return bumpStale(state, event.at)
      if (event.attempt > state.attempt) {
        return withAnomaly(state, event, "rejection for a future attempt")
      }
      return patch(state, {
        phase: "failed",
        lastFailure: { reason: event.reason, at: event.at },
        updatedAt: event.at,
      })
    }
    case "ExtractionResultArrived": {
      if (state.phase !== "pending" && state.phase !== "saved") {
        return withAnomaly(state, event, `result while ${state.phase}`)
      }
      if (event.attempt < state.attempt) return bumpStale(state, event.at)
      if (event.attempt > state.attempt) {
        return withAnomaly(state, event, "result for a future attempt")
      }
      return patch(state, { extractionStatus: event.outcome, updatedAt: event.at })
    }
    case "NetworkLost": {
      if (state.phase === "saved" || state.phase === "discarded") return state
      return patch(state, { networkLostAt: event.at, updatedAt: event.at })
    }
    case "NetworkRestored":
      return patch(state, { networkLostAt: undefined, updatedAt: event.at })
    case "DiscardRequested": {
      if (state.phase !== "drafting" && state.phase !== "failed") {
        return withAnomaly(state, event, `discard while ${state.phase}`)
      }
      const receipt: DiscardReceipt = {
        at: event.at,
        transcriptLength: state.rawTranscript.length,
        attempt: state.attempt,
        ...(state.submissionId !== undefined ? { submissionId: state.submissionId } : {}),
      }
      return patch(state, {
        phase: "discarded",
        rawTranscript: "",
        discardedReceipt: receipt,
        updatedAt: event.at,
      })
    }
  }
  // The union above is exhaustive; a decoded CaptureEvent cannot reach here.
  return state
}
