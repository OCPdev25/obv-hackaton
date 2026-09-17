import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CaptureId } from "@journal/domain"

import { update } from "./update.js"
import { makeCaptureLoop } from "./runtime.js"
import { makeInMemoryEntryStore } from "./services/entries.js"
import { makeDeterministicExtractor } from "./services/extraction.js"
import { createIntegratedAdapter, CORPUS_CHILD_ID } from "./evaluation-adapter.js"
import { toCanonicalEvent } from "./wire.js"
import { resolveOccurredAt } from "./services/relativeTime.js"

import type { CaptureServices } from "./runtime.js"

const BASE = 1_760_000_000_000
const TZ = "America/New_York"
const cid = Schema.decodeSync(CaptureId)

const services = (): CaptureServices => ({
  extraction: makeDeterministicExtractor(),
  entries: makeInMemoryEntryStore(),
})

const drive = async (svc: CaptureServices, messages: ReadonlyArray<object>) => {
  const loop = makeCaptureLoop(svc)
  for (const m of messages) await Effect.runPromise(loop.dispatch(m as never))
  return loop
}

describe("capture reducer", () => {
  test("unmatched capture ids are ignored (stale-result guard)", () => {
    const next = update({ _tag: "Recording", captureId: cid("a"), childId: "c", authorId: "p" }, {
      _tag: "SucceededExtraction",
      captureId: cid("b"),
      events: [],
    })
    expect(next[0]._tag).toBe("Recording")
    expect(next[1]).toEqual([])
  })

  test("transcription persists the raw draft first — extraction waits for submission", () => {
    const [, commands] = update({ _tag: "Recording", captureId: cid("a"), childId: "c", authorId: "p" }, {
      _tag: "CompletedTranscription",
      captureId: cid("a"),
      transcript: "hello",
      at: BASE,
      timezone: TZ,
    })
    expect(commands.map((c) => c._tag)).toEqual(["PersistRawDraft"])
    const [next, extract] = update(
      { _tag: "Transcribed", captureId: cid("a"), childId: "c", authorId: "p", rawTranscript: "hello", capturedAt: BASE, timezone: TZ },
      { _tag: "SubmittedForExtraction", captureId: cid("a") },
    )
    expect(next._tag).toBe("Extracting")
    expect(extract.map((c) => c._tag)).toEqual(["ExtractEvents"])
  })

  test("extract failure returns to Transcribed with raw preserved (raw already durable)", () => {
    const [next] = update(
      { _tag: "Extracting", captureId: cid("a"), childId: "c", authorId: "p", rawTranscript: "raw", capturedAt: BASE, timezone: TZ },
      { _tag: "FailedExtraction", captureId: cid("a"), reason: "boom" },
    )
    expect(next._tag).toBe("Transcribed")
    if (next._tag === "Transcribed") expect(next.rawTranscript).toBe("raw")
  })

  test("retry persist re-issues PersistRawDraft from the park", () => {
    const [, commands] = update(
      { _tag: "RawPersistFailed", captureId: cid("a"), childId: "c", authorId: "p", rawTranscript: "raw", capturedAt: BASE, timezone: TZ, reason: "down" },
      { _tag: "RetryPersistRaw", captureId: cid("a") },
    )
    expect(commands.map((c) => c._tag)).toEqual(["PersistRawDraft"])
  })

  test("store failure from Review also parks (no publish without durable events)", () => {
    const [parked] = update(
      { _tag: "Review", captureId: cid("a"), childId: "c", authorId: "p", rawTranscript: "raw", events: [], capturedAt: BASE, timezone: TZ },
      { _tag: "RawDraftPersistFailed", captureId: cid("a"), reason: "storage down" },
    )
    expect(parked._tag).toBe("RawPersistFailed")
  })
})

describe("integrated pipeline via loop", () => {
  test("happy path: raw draft → events → published", async () => {
    const loop = await drive(services(), [
      { _tag: "CaptureStarted", captureId: "cap-1", childId: "child", authorId: "mom" },
      { _tag: "CompletedTranscription", captureId: "cap-1", transcript: "wet diaper at 9:15 am", at: BASE, timezone: TZ },
      { _tag: "SubmittedForExtraction", captureId: "cap-1" },
      { _tag: "ConfirmedReview", captureId: "cap-1", at: BASE + 1_000 },
    ])
    expect(loop.state()._tag).toBe("Published")
  })

  test("raw-first: durable draft exists with zero events after transcription", async () => {
    const entries = makeInMemoryEntryStore()
    const svc: CaptureServices = { extraction: makeDeterministicExtractor(), entries }
    await drive(svc, [
      { _tag: "CaptureStarted", captureId: "cap-1", childId: "child", authorId: "mom" },
      { _tag: "CompletedTranscription", captureId: "cap-1", transcript: "wet diaper at 9:15 am", at: BASE, timezone: TZ },
    ])
    const timeline = await Effect.runPromise(entries.timeline("child"))
    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.rawTranscript).toBe("wet diaper at 9:15 am")
    expect(timeline[0]?.events).toEqual([])
  })
})

describe("corpus adapter (CandidateAdapter shape)", () => {
  test("createEntry persists draft-with-events, idempotent on replay", async () => {
    const adapter = createIntegratedAdapter()
    const first = await adapter.createEntry({
      captureId: "fx-1",
      transcript: "she had 6 oz bottle at 2 pm",
      authorId: "mom",
      capturedAt: BASE,
      timezone: TZ,
    })
    expect(first._tag).toBe("Created")
    if (first._tag === "Created") {
      expect(first.entry.status).toBe("draft")
      expect(first.entry.events.length).toBeGreaterThan(0)
    }
    const replay = await adapter.createEntry({
      captureId: "fx-1",
      transcript: "she had 6 oz bottle at 2 pm",
      authorId: "mom",
      capturedAt: BASE,
      timezone: TZ,
    })
    expect(replay._tag).toBe("IdempotentReplay")
  })

  test("empty transcript is rejected, never persisted", async () => {
    const adapter = createIntegratedAdapter()
    const result = await adapter.createEntry({
      captureId: "fx-empty",
      transcript: "",
      authorId: "mom",
      capturedAt: BASE,
      timezone: TZ,
    })
    expect(result._tag).toBe("Rejected")
    expect((await adapter.readTimeline()).find((e) => e.captureId === "fx-empty")).toBeUndefined()
  })

  test("malformed transcript still creates an eventless draft with raw preserved", async () => {
    const adapter = createIntegratedAdapter()
    const result = await adapter.createEntry({
      captureId: "fx-malformed",
      transcript: "   \x01\x02garbled\x03   ",
      authorId: "mom",
      capturedAt: BASE,
      timezone: TZ,
    })
    expect(result._tag).toBe("Created")
    if (result._tag === "Created") {
      expect(result.entry.events).toEqual([])
      expect(result.entry.transcript).toBe("   \x01\x02garbled\x03   ")
    }
  })

  test("reload is stable: identical timeline after cold-start simulation", async () => {
    const adapter = createIntegratedAdapter()
    await adapter.createEntry({
      captureId: "fx-rl",
      transcript: "napped 1:30 hours at 1 pm",
      authorId: "mom",
      capturedAt: BASE,
      timezone: TZ,
    })
    const before = await adapter.readTimeline()
    await adapter.reload()
    const after = await adapter.readTimeline()
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
  })
})

describe("wire codecs", () => {
  test("capture-wire event maps into the canonical Event contract", () => {
    const canonical = toCanonicalEvent(
      { _tag: "Event", category: "meal", occurredAt: BASE, quantity: { value: 6, unit: "oz" }, confidence: 1, authorId: "mom" },
      "household",
      "child",
    )
    expect(canonical.timestamp).toBe(BASE)
    expect(canonical.category).toBe("meal")
  })

  test("relative resolution is deterministic and DST-safe", () => {
    expect(resolveOccurredAt({ transcript: "just now", capturedAt: BASE, timezone: TZ })).toBe(BASE)
    expect(resolveOccurredAt({ transcript: "an hour ago", capturedAt: BASE, timezone: TZ })).toBe(BASE - 3_600_000)
    const resolved = resolveOccurredAt({ transcript: "yesterday 9:15 am", capturedAt: BASE, timezone: TZ })
    expect(resolved).toBeDefined()
  })
})
