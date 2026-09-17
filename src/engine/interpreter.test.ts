import { describe, expect, it } from "vitest"
import { Effect, Schema } from "effect"
import { CaregiverId, CaptureId, ChildId } from "../domain/schema.js"
import { CaptureRepositoryService, ExtractionService, type ExtractionOutcome, type ExtractionRequest } from "../domain/services.js"
import { CaptureMessage, CaptureState, idleCaptureState } from "../domain/captureState.js"
import { makeInMemoryRepository } from "../services/repository.js"
import { makeDeterministicExtraction } from "../services/extraction.js"
import { runCaptureFlow } from "./interpreter.js"

const captureId = Schema.decodeSync(CaptureId)("cap-interpreter-1")
const authorId = Schema.decodeSync(CaregiverId)("caregiver-maya")
const childId = Schema.decodeSync(ChildId)("child-ada")

const statesSeen: CaptureState[] = []
const runHappyPath = async (first: CaptureMessage): Promise<CaptureState> => {
  const program = runCaptureFlow(idleCaptureState, [first], {
    onStateChange: (next) => statesSeen.push(next),
  }).pipe(
    Effect.provideService(ExtractionService, makeDeterministicExtraction()),
    Effect.provideService(CaptureRepositoryService, makeInMemoryRepository()),
  )
  return Effect.runPromise(program)
}

describe("interpreter with controlled doubles", () => {
  it("drives the full happy path through named commands to published", async () => {
    const recording = await runHappyPath({ type: "captureStarted", captureId, authorId, childId })
    expect(recording.status).toBe("recording")

    // Text entry ends at the caregiver review gate (publishing is an explicit
    // caregiver action, not an automatic side effect of extraction).
    const reviewed = await Effect.runPromise(
      runCaptureFlow(recording, [{ type: "textEntered", transcript: "milestone: Ada said mama" }], {
        onStateChange: (next) => statesSeen.push(next),
      }).pipe(
        Effect.provideService(ExtractionService, makeDeterministicExtraction()),
        Effect.provideService(CaptureRepositoryService, makeInMemoryRepository()),
      ),
    )
    expect(reviewed.status).toBe("review")

    const done = await Effect.runPromise(
      runCaptureFlow(reviewed, [{ type: "publishRequested" }], {
        onStateChange: (next) => statesSeen.push(next),
      }).pipe(
        Effect.provideService(ExtractionService, makeDeterministicExtraction()),
        Effect.provideService(CaptureRepositoryService, makeInMemoryRepository()),
      ),
    )
    expect(done.status).toBe("published")
    if (done.status === "published") {
      expect(done.recordId).toBe("mem-record-1")
    }
    const statuses = statesSeen.map((s) => s.status)
    expect(statuses).toContain("extracting")
    expect(statuses).toContain("review")
    expect(statuses).toContain("publishing")
  })

  it("surfaces extraction failure as data: validationFailed with raw transcript preserved", async () => {
    const recording = { status: "recording" as const, captureId, authorId, childId }
    const done = await Effect.runPromise(
      runCaptureFlow(recording, [{ type: "textEntered", transcript: "no rule matches this" }], {
        onStateChange: () => {},
      }).pipe(
        Effect.provideService(ExtractionService, makeDeterministicExtraction()),
        Effect.provideService(CaptureRepositoryService, makeInMemoryRepository()),
      ),
    )
    expect(done.status).toBe("validationFailed")
    if (done.status === "validationFailed") {
      expect(done.transcript).toBe("no rule matches this")
    }
  })

  it("retry re-runs extraction and publishes once (idempotent on captureId)", async () => {
    // First attempt: extraction deliberately fails, then succeeds on retry.
    const attempts: Array<ExtractionOutcome> = [
      { ok: false, reason: "simulated LLM garbage (domain schema rejected it)" },
      {
        ok: true,
        events: [
          {
            _tag: "Event",
            category: "meal",
            occurredAt: new Date(1758100000000),
            confidence: 1,
            authorId,
            note: "oats and banana",
          },
        ],
      },
    ]
    let call = 0
    const scriptedExtraction = {
      extract: (_request: ExtractionRequest) => {
        const outcome = attempts[call]!
        call += 1
        return Effect.succeed(outcome)
      },
    }
    const repository = makeInMemoryRepository()

    const recording = { status: "recording" as const, captureId, authorId, childId }
    const failed = await Effect.runPromise(
      runCaptureFlow(recording, [{ type: "textEntered", transcript: "meal: oats and banana" }], {
        onStateChange: () => {},
      }).pipe(
        Effect.provideService(ExtractionService, scriptedExtraction),
        Effect.provideService(CaptureRepositoryService, repository),
      ),
    )
    expect(failed.status).toBe("validationFailed")

    // Retry WITHOUT re-entering text: raw transcript rides inside the state.
    // Successful re-extraction lands at the review gate again.
    const reviewed = await Effect.runPromise(
      runCaptureFlow(failed, [{ type: "retryRequested" }], {
        onStateChange: () => {},
      }).pipe(
        Effect.provideService(ExtractionService, scriptedExtraction),
        Effect.provideService(CaptureRepositoryService, repository),
      ),
    )
    expect(reviewed.status).toBe("review")

    // Caregiver confirms: the entry publishes exactly once.
    const published = await Effect.runPromise(
      runCaptureFlow(reviewed, [{ type: "publishRequested" }], {
        onStateChange: () => {},
      }).pipe(
        Effect.provideService(ExtractionService, scriptedExtraction),
        Effect.provideService(CaptureRepositoryService, repository),
      ),
    )
    expect(published.status).toBe("published")
    if (published.status === "published") {
      expect(published.transcript).toBe("meal: oats and banana")
    }
    expect(repository.published.size).toBe(1)
    const [record] = repository.published.values()
    expect(record?.entry.events).toHaveLength(1)
    expect(record?.entry.events[0]?.category).toBe("meal")

    // A duplicate publish with the same captureId returns the original record.
    const republished = await Effect.runPromise(repository.publish(record!.entry))
    expect(republished.duplicate).toBe(true)
    expect(republished.recordId).toBe(published.status === "published" ? published.recordId : "")
  })
})
