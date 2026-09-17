import { describe, expect, it } from "vitest"
import { Effect, Schema } from "effect"
import { makeInMemoryRepository } from "./repository.js"
import type { Entry } from "../domain/schema.js"
import { CaregiverId, CaptureId, ChildId } from "../domain/schema.js"

const entry = (captureId: string): Entry => ({
  _tag: "Entry",
  captureId: Schema.decodeSync(CaptureId)(captureId),
  childId: Schema.decodeSync(ChildId)("child-ada"),
  transcript: "mood: cheerful morning",
  authorId: Schema.decodeSync(CaregiverId)("caregiver-maya"),
  createdAt: new Date(1758100000000),
  status: "published",
  events: [
    { _tag: "Event", category: "mood", occurredAt: new Date(1758100000000), confidence: 1, authorId: Schema.decodeSync(CaregiverId)("caregiver-maya") },
  ],
})

describe("in-memory repository double (mirrors server idempotency contract)", () => {
  it("stores the first publish and returns duplicates for the same captureId", async () => {
    const repository = makeInMemoryRepository()
    const first = await Effect.runPromise(repository.publish(entry("cap-dup-1")))
    expect(first.duplicate).toBe(false)
    expect(first.recordId).toBe("mem-record-1")

    const second = await Effect.runPromise(repository.publish(entry("cap-dup-1")))
    expect(second.duplicate).toBe(true)
    expect(second.recordId).toBe("mem-record-1")

    // Exactly one record despite two publishes.
    expect(repository.published.size).toBe(1)
  })

  it("distinct captureIds get distinct records", async () => {
    const repository = makeInMemoryRepository()
    const a = await Effect.runPromise(repository.publish(entry("cap-a")))
    const b = await Effect.runPromise(repository.publish(entry("cap-b")))
    expect(a.recordId).not.toBe(b.recordId)
    expect(repository.published.size).toBe(2)
  })
})
