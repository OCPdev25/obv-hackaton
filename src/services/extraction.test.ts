import { describe, expect, it } from "vitest"
import { Effect, Schema } from "effect"
import { makeDeterministicExtraction } from "./extraction.js"
import { CaregiverId, CaptureId } from "../domain/schema.js"

const run = (transcript: string) =>
  Effect.runPromise(
    makeDeterministicExtraction().extract({
      captureId: Schema.decodeSync(CaptureId)("cap-x"),
      transcript,
      authorId: Schema.decodeSync(CaregiverId)("caregiver-maya"),
    }),
  )

describe("deterministic extraction double (no LLM, no cloud)", () => {
  it('maps "category: text" transcripts to one schema-valid event', async () => {
    const outcome = await run("milestone: Ada said her first word — mama")
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.events).toHaveLength(1)
      expect(outcome.events[0]?.category).toBe("milestone")
      expect(outcome.events[0]?.note).toBe("Ada said her first word — mama")
      // 0.9 = model guess from the deterministic double; 1 is reserved for
      // caregiver-confirmed events.
      expect(outcome.events[0]?.confidence).toBe(0.9)
      expect(outcome.events[0]?.occurredAt).toBeInstanceOf(Date)
    }
  })

  it("rejects transcripts it cannot classify — the reviewable failure path", async () => {
    const outcome = await run("just a sentence with no category prefix")
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reason).toContain("could not classify")
      expect(outcome.reason).toContain("potty|meal|sleep|mood|milestone|school")
    }
  })

  it("supports scripted attempt plans: invalid first, then classified (the retry demo)", async () => {
    const extraction = makeDeterministicExtraction(["invalid", "classify"])
    const request = {
      captureId: Schema.decodeSync(CaptureId)("cap-retry"),
      transcript: "sleep: down at 19:30",
      authorId: Schema.decodeSync(CaregiverId)("caregiver-maya"),
    }
    const first = await Effect.runPromise(extraction.extract(request))
    expect(first.ok).toBe(false)
    if (!first.ok) {
      expect(first.reason).toContain("schema validation")
    }
    const second = await Effect.runPromise(extraction.extract(request))
    expect(second.ok).toBe(true)
  })
})
