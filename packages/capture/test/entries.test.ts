import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import type { CaptureId } from "@journal/domain"
import { fixtureCaregiverAna, fixtureChild } from "@journal/domain"

import { makeInMemoryEntryStore } from "../src/services/entries.js"

const ana = fixtureCaregiverAna.caregiverId
const childId = fixtureChild.childId
const createdAt = new Date(1726500010000)

const draft = (captureId: CaptureId) => ({
  _tag: "Entry" as const,
  captureId,
  childId,
  transcript: "Mila used the potty today.",
  authorId: ana,
  createdAt,
  status: "draft" as const,
  events: [],
})

const run = <A>(effect: Effect.Effect<A, unknown, never>) => Effect.runPromise(Effect.orDie(effect))

describe("in-memory EntryStore (controlled test double of persistence)", () => {
  it("idempotency: publishing the same captureId twice stores ONE entry and returns the same id", async () => {
    const store = makeInMemoryEntryStore()
    const first = await run(store.publish(draft("capture_idem_001" as CaptureId)))
    const second = await run(store.publish(draft("capture_idem_001" as CaptureId)))
    expect(second.entryId).toBe(first.entryId)
    const timeline = await run(store.timeline(childId))
    expect(timeline).toHaveLength(1)
  })

  it("different captureIds produce distinct entries", async () => {
    const store = makeInMemoryEntryStore()
    await run(store.publish(draft("capture_a" as CaptureId)))
    await run(store.publish(draft("capture_b" as CaptureId)))
    const timeline = await run(store.timeline(childId))
    expect(timeline).toHaveLength(2)
  })

  it("timeline is scoped to the child and sorted newest-first", async () => {
    const store = makeInMemoryEntryStore()
    await run(store.publish({ ...draft("capture_older" as CaptureId), createdAt: new Date(1726500000000) }))
    await run(store.publish({ ...draft("capture_newer" as CaptureId), createdAt: new Date(1726500050000) }))
    const timeline = await run(store.timeline(childId))
    expect(timeline.map((e) => e.captureId)).toEqual(["capture_newer", "capture_older"])
  })
})
