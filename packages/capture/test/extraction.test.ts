import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"

import type { CaptureId, CaregiverId } from "@journal/domain"
import { fixtureCaregiverAna, fixtureChild } from "@journal/domain"

import {
  ExtractionService,
  deterministicExtractionLayer,
  faultyExtractionLayer,
  makeDeterministicExtractor,
  unconfiguredLiveExtractionLayer,
} from "../src/services/extraction.js"

const ana = fixtureCaregiverAna.caregiverId
const childId = fixtureChild.childId
const captureId = "capture_extract_001" as CaptureId

const input = {
  captureId,
  childId,
  authorId: ana,
  transcript: "Mila used the potty today. She napped for 90 minutes.",
}

const FIXED_NOW = 1726500000000

describe("deterministic extractor (local test double that behaves)", () => {
  it("extracts schema-valid events for recognized categories", () => {
    const extractor = makeDeterministicExtractor(() => FIXED_NOW)
    const events = Effect.runSync(Effect.orDie(extractor.extract(input)))
    expect(events.map((e) => e.category).sort()).toEqual(["potty", "sleep"])
    for (const event of events) {
      expect(event.occurredAt.getTime()).toBe(FIXED_NOW)
      expect(event.confidence).toBe(0.8)
      expect(event.authorId).toBe(ana)
      expect(event.note?.length ?? 0).toBeGreaterThan(0)
    }
  })

  it("attaches a quantity when a duration is present", () => {
    const extractor = makeDeterministicExtractor(() => FIXED_NOW)
    const events = Effect.runSync(Effect.orDie(extractor.extract(input)))
    const sleep = events.find((e) => e.category === "sleep")
    expect(sleep?.quantity).toEqual({ value: 90, unit: "minutes" })
  })

  it("returns an empty event list for an unrecognized transcript (capture is never blocked)", () => {
    const extractor = makeDeterministicExtractor(() => FIXED_NOW)
    const events = Effect.runSync(Effect.orDie(extractor.extract({ ...input, transcript: "hello there" })))
    expect(events).toEqual([])
  })
})

describe("faulty extractor (misbehaving-LLM double)", () => {
  it("model output that fails the Event schema dies at the validation boundary", async () => {
    const program = Effect.gen(function* () {
      const service = yield* ExtractionService
      return yield* service.extract(input)
    }).pipe(Effect.provide(faultyExtractionLayer))
    const failure = await Effect.runPromise(Effect.flip(program))
    expect(failure._tag).toBe("ExtractionError")
    expect(failure.reason).toContain("failed schema validation")
    expect(failure.reason).toContain("confidence")
  })
})

describe("layer plumbing", () => {
  it("extraction service resolves through Context + Layer", async () => {
    const program = Effect.gen(function* () {
      const service = yield* ExtractionService
      return yield* service.extract(input)
    }).pipe(Effect.provide(deterministicExtractionLayer))
    const events = await Effect.runPromise(Effect.orDie(program))
    expect(events.length).toBeGreaterThan(0)
  })

  it("unconfigured live layer fails with an explicit, labeled reason", async () => {
    const program = Effect.gen(function* () {
      const service = yield* ExtractionService
      return yield* service.extract(input)
    }).pipe(Effect.provide(unconfiguredLiveExtractionLayer))
    const failure = await Effect.runPromise(Effect.flip(program))
    expect(failure.reason).toContain("live LLM provider is not wired in candidate D")
  })
})
