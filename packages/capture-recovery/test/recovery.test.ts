import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { Schema } from "effect"

import {
  CaptureEvent,
  CaptureRecoveryState,
  Fixture,
  InMemoryCaptureStorage,
  bannerFor,
  createCapture,
  decodeStoredState,
  reduce,
  runFixture,
  successChip,
  type CapturePhase,
  type CaptureRecovery,
  type FixtureRunResult,
} from "../src/index.js"

const fixturesDir = join(import.meta.dir, "..", "fixtures")

const loadRuns = (): FixtureRunResult[] =>
  readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, name), "utf8"))
      const fixture = Schema.decodeUnknownSync(Fixture)(raw)
      return runFixture(fixture)
    })

const runs = loadRuns()

const runById = (id: string): FixtureRunResult => {
  const run = runs.find((r) => r.fixtureId === id)
  if (run === undefined) throw new Error(`missing fixture run: ${id}`)
  return run
}

describe("recovery fixture replay", () => {
  test("every fixture replays to its expected final state", () => {
    for (const run of runs) {
      const failed = run.checks.filter((c) => !c.pass)
      expect(failed).toEqual([])
      expect(run.passed).toBe(true)
    }
  })

  test("covers the four brief scenarios plus failure/retry, stale result, and discard receipt", () => {
    expect(runs.length).toBe(7)
    const ids = new Set(runs.map((r) => r.fixtureId))
    expect(ids.has("interruption-mid-draft")).toBe(true)
    expect(ids.has("backgrounding-process-death")).toBe(true)
    expect(ids.has("network-loss-pending")).toBe(true)
    expect(ids.has("failed-retry-success")).toBe(true)
    expect(ids.has("duplicate-submission")).toBe(true)
    expect(ids.has("stale-result")).toBe(true)
    expect(ids.has("discard-receipt")).toBe(true)
  })

  test("interruption: the reload rehydrates the persisted draft verbatim", () => {
    const run = runById("interruption-mid-draft")
    const reloads = run.timeline.filter((t) => t.kind === "reload")
    expect(reloads.length).toBe(1)
    expect(reloads[0]?.phase).toBe("drafting")
    expect(reloads[0]?.rawLength).toBe("Ava had a huge meltdown after preschool".length)
    expect(run.state.rawTranscript).toBe(
      "Ava had a huge meltdown after preschool, calmed by her plush rabbit.",
    )
  })

  test("backgrounding + process death: raw text and attribution survive the cold start", () => {
    const run = runById("backgrounding-process-death")
    const reloads = run.timeline.filter((t) => t.kind === "reload")
    expect(reloads[0]?.rawLength).toBe("Ava ate all of her pasta at dinner".length)
    expect(run.state.authorId).toBe("caregiver-1")
    expect(run.state.phase).toBe("saved")
  })

  test("network loss during pending never fabricates a failure or a save", () => {
    const run = runById("network-loss-pending")
    // timeline: start, SubmitRequested, NetworkLost, NetworkRestored, SubmitAccepted
    expect(run.timeline[2]?.tag).toBe("NetworkLost")
    expect(run.timeline[2]?.phase).toBe("pending")
    expect(run.timeline[3]?.tag).toBe("NetworkRestored")
    expect(run.timeline[3]?.phase).toBe("pending")
    expect(run.state.phase).toBe("saved")
  })

  test("failed then retried: same submissionId, attempt bumped, latest result applied", () => {
    const run = runById("failed-retry-success")
    expect(run.state.submissionId).toBe("sub-recover-004")
    expect(run.state.attempt).toBe(1)
    expect(run.state.extractionStatus).toBe("structured")
  })

  test("duplicate submission: three submits, two suppressed, one saved", () => {
    const run = runById("duplicate-submission")
    expect(run.state.duplicateSubmissionsSuppressed).toBe(2)
    expect(run.state.phase).toBe("saved")
  })

  test("stale extraction result (superseded attempt) is suppressed, never merged", () => {
    const run = runById("stale-result")
    expect(run.state.staleResultsSuppressed).toBe(1)
    expect(run.state.attempt).toBe(1)
    expect(run.state.extractionStatus).toBe("structured")
  })

  test("discard leaves a receipt, clears raw, survives reload, resists resurrection", () => {
    const run = runById("discard-receipt")
    expect(run.state.phase).toBe("discarded")
    expect(run.state.rawTranscript).toBe("")
    expect(run.state.discardedReceipt?.transcriptLength).toBe(
      "Ava bit her friend at pickup, we talked about it".length,
    )
    const reloads = run.timeline.filter((t) => t.kind === "reload")
    expect(reloads[0]?.phase).toBe("discarded")
    expect(run.state.anomalies?.length).toBe(1)
  })
})

describe("reducer invariants", () => {
  const base: CaptureRecovery = createCapture({
    captureId: "cap-invariant",
    authorId: "caregiver-1",
    at: 1_000,
  })

  const stream: readonly { event: CaptureEvent; expectPhase: CapturePhase }[] = [
    { event: { _tag: "TranscriptChanged", at: 2_000, text: "she napped 45 minutes" }, expectPhase: "drafting" },
    { event: { _tag: "Interrupted", at: 3_000, kind: "call" }, expectPhase: "drafting" },
    { event: { _tag: "Resumed", at: 4_000 }, expectPhase: "drafting" },
    { event: { _tag: "NetworkLost", at: 5_000 }, expectPhase: "drafting" },
    { event: { _tag: "NetworkRestored", at: 6_000 }, expectPhase: "drafting" },
    { event: { _tag: "SubmitRequested", at: 7_000, submissionId: "sub-invariant" }, expectPhase: "pending" },
    { event: { _tag: "SubmitRejected", at: 8_000, attempt: 0, reason: "network" }, expectPhase: "failed" },
    { event: { _tag: "RetryRequested", at: 9_000 }, expectPhase: "pending" },
    { event: { _tag: "SubmitAccepted", at: 10_000 }, expectPhase: "saved" },
    {
      event: { _tag: "ExtractionResultArrived", at: 11_000, attempt: 1, outcome: "structured" },
      expectPhase: "saved",
    },
    { event: { _tag: "SubmitAccepted", at: 12_000 }, expectPhase: "saved" },
  ]

  test("raw transcript is touched only by TranscriptChanged (and DiscardRequested)", () => {
    let state = base
    for (const step of stream) {
      const before = state.rawTranscript
      state = reduce(state, step.event)
      expect(state.phase).toBe(step.expectPhase)
      if (step.event._tag !== "TranscriptChanged" && step.event._tag !== "DiscardRequested") {
        expect(state.rawTranscript).toBe(before)
      }
    }
  })

  test("attempt is monotonic and submissionId is stable across the whole stream", () => {
    let state = base
    let attempt = 0
    let submissionId: string | undefined = undefined
    for (const step of stream) {
      state = reduce(state, step.event)
      expect(state.attempt).toBeGreaterThanOrEqual(attempt)
      attempt = state.attempt
      if (state.submissionId !== undefined) {
        if (submissionId === undefined) submissionId = state.submissionId
        expect(state.submissionId).toBe(submissionId)
      }
    }
  })

  test("idempotent completion: a repeated SubmitAccepted returns the SAME state object", () => {
    let state = base
    state = reduce(state, { _tag: "TranscriptChanged", at: 2_000, text: "hello" })
    state = reduce(state, { _tag: "SubmitRequested", at: 3_000, submissionId: "sub-idem" })
    state = reduce(state, { _tag: "SubmitAccepted", at: 4_000 })
    const again = reduce(state, { _tag: "SubmitAccepted", at: 5_000 })
    expect(again).toBe(state)
  })

  test("saved is unreachable without SubmitAccepted (no optimistic truth)", () => {
    let state = base
    state = reduce(state, { _tag: "TranscriptChanged", at: 2_000, text: "hello" })
    state = reduce(state, { _tag: "SubmitRequested", at: 3_000, submissionId: "sub-nopt" })
    state = reduce(state, { _tag: "NetworkLost", at: 4_000 })
    state = reduce(state, { _tag: "NetworkRestored", at: 5_000 })
    state = reduce(state, { _tag: "Resumed", at: 6_000 })
    state = reduce(state, { _tag: "ExtractionResultArrived", at: 7_000, attempt: 0, outcome: "structured" })
    expect(state.phase).toBe("pending")
  })

  test("foreign submissionId while active is an anomaly, never a takeover", () => {
    let state = base
    state = reduce(state, { _tag: "TranscriptChanged", at: 2_000, text: "hello" })
    state = reduce(state, { _tag: "SubmitRequested", at: 3_000, submissionId: "sub-mine" })
    state = reduce(state, { _tag: "SubmitRequested", at: 4_000, submissionId: "sub-foreign" })
    expect(state.phase).toBe("pending")
    expect(state.submissionId).toBe("sub-mine")
    expect(state.anomalies?.length).toBe(1)
  })
})

describe("truthful UI projection", () => {
  const base = createCapture({ captureId: "cap-ui", authorId: "caregiver-1", at: 1_000 })

  test("pending never claims saved; failed copy names the problem and keeps the raw safe", () => {
    let state = base
    state = reduce(state, { _tag: "TranscriptChanged", at: 2_000, text: "hello" })
    state = reduce(state, { _tag: "SubmitRequested", at: 3_000, submissionId: "sub-ui" })
    const sending = bannerFor(state)
    expect(sending.title).toBe("Sending…")
    expect(sending.detail).toContain("Not saved to the journal yet")

    state = reduce(state, { _tag: "NetworkLost", at: 4_000 })
    const waiting = bannerFor(state)
    expect(waiting.title).toBe("Waiting for network")

    state = reduce(state, { _tag: "SubmitRejected", at: 5_000, attempt: 0, reason: "network" })
    const failed = bannerFor(state)
    expect(failed.title).toBe("Couldn't send — network problem")
    expect(failed.detail).toContain("safe on this device")
    expect(failed.primary?.action).toBe("retry")
    expect(failed.secondary?.action).toBe("discard")
  })

  test("one-handed encoding: bottom-anchored, 48pt targets, at most two actions", () => {
    let state = base
    state = reduce(state, { _tag: "TranscriptChanged", at: 2_000, text: "hello" })
    state = reduce(state, { _tag: "SubmitRequested", at: 3_000, submissionId: "sub-1h" })
    state = reduce(state, { _tag: "SubmitRejected", at: 4_000, attempt: 0, reason: "server" })
    const banner = bannerFor(state)
    expect(banner.anchored).toBe("bottom")
    expect(banner.touchTargetPt).toBe(48)
    expect(banner.primary).toBeDefined()
    expect(banner.secondary).toBeDefined()
  })

  test("saved hides the recovery banner and surfaces the success chip", () => {
    let state = base
    state = reduce(state, { _tag: "TranscriptChanged", at: 2_000, text: "hello" })
    state = reduce(state, { _tag: "SubmitRequested", at: 3_000, submissionId: "sub-chip" })
    state = reduce(state, { _tag: "SubmitAccepted", at: 4_000 })
    const banner = bannerFor(state)
    expect(banner.visible).toBe(false)
    expect(successChip).toBe("Saved to the journal")
  })
})

describe("storage contract", () => {
  test("state survives an encode -> wire -> decode roundtrip unchanged", () => {
    const run = runById("interruption-mid-draft")
    const encoded = Schema.encodeSync(CaptureRecoveryState)(run.state)
    const wire: unknown = JSON.parse(JSON.stringify(encoded))
    const decoded = decodeStoredState(wire)
    expect(decoded).toEqual(run.state)
  })

  test("unresolved captures and discard receipts are listed separately", () => {
    const storage = new InMemoryCaptureStorage()
    const live = createCapture({ captureId: "cap-live", authorId: "caregiver-1", at: 1_000 })
    let dead = createCapture({ captureId: "cap-dead", authorId: "caregiver-1", at: 2_000 })
    dead = reduce(dead, { _tag: "TranscriptChanged", at: 3_000, text: "private note" })
    dead = reduce(dead, { _tag: "DiscardRequested", at: 4_000 })
    storage.save(live)
    storage.save(dead)
    expect(storage.listUnresolved().map((s) => s.captureId)).toEqual(["cap-live"])
    expect(storage.listReceipts().map((s) => s.captureId)).toEqual(["cap-dead"])
  })

  test("fail-closed read: a corrupt stored record cannot enter the machine", () => {
    expect(() => decodeStoredState({ captureId: "cap-x", phase: "not-a-phase" })).toThrow()
  })
})
