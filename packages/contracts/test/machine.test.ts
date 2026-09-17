import { Effect, Result } from "effect"
import { describe, expect, it } from "vitest"
import {
  CaptureMessage,
  DeterministicExtractionLayer,
  ExtractionError,
  ExtractionService,
  extractDeterministic,
  newCaptureId,
  update,
  type CaptureState,
} from "../src/index.ts"

const CONTEXT = { childId: "child_test", authorCaregiverId: "cg_test" }
const CAPTURE_ID = newCaptureId()
const NOW = 1765000000000

const dispatch = (state: CaptureState, message: CaptureMessage) => update(state, message, CONTEXT)

describe("capture machine", () => {
  it("Idle + StartRecording → Recording", () => {
    const [next, commands] = dispatch({ _tag: "Idle" }, { _tag: "StartRecording" })
    expect(next._tag).toBe("Recording")
    expect(commands).toEqual([])
  })

  it("Recording + StopRecording → Transcribed and emits PersistCaptureRaw", () => {
    const [next, commands] = dispatch(
      { _tag: "Recording", startedAt: NOW },
      { _tag: "StopRecording", rawText: "she ate most of her pasta", captureId: CAPTURE_ID, occurredAt: NOW }
    )
    expect(next._tag).toBe("Transcribed")
    if (next._tag === "Transcribed") {
      expect(next.rawText).toBe("she ate most of her pasta")
    }
    expect(commands).toHaveLength(1)
    expect(commands[0]?._tag).toBe("PersistCaptureRaw")
    const command = commands[0]
    if (command?._tag === "PersistCaptureRaw") {
      expect(command.captureId).toBe(CAPTURE_ID)
      expect(command.childId).toBe("child_test")
      expect(command.authorCaregiverId).toBe("cg_test")
      expect(command.rawText).toBe("she ate most of her pasta")
    }
  })

  it("Transcribed + ExtractionRequested → Extracting and emits Extract", () => {
    const transcribed: CaptureState = {
      _tag: "Transcribed",
      captureId: CAPTURE_ID,
      rawText: "nap time",
      occurredAt: NOW,
    }
    const [next, commands] = dispatch(transcribed, { _tag: "ExtractionRequested" })
    expect(next._tag).toBe("Extracting")
    expect(commands).toHaveLength(1)
    expect(commands[0]?._tag).toBe("Extract")
  })

  it("Extracting + ExtractionSucceeded → Review with event", () => {
    const extracting: CaptureState = {
      _tag: "Extracting",
      captureId: CAPTURE_ID,
      rawText: "nap",
      occurredAt: NOW,
    }
    const [next, commands] = dispatch(extracting, {
      _tag: "ExtractionSucceeded",
      event: { _tag: "sleep", kind: "nap", minutes: 45, occurredAt: NOW },
    })
    expect(next._tag).toBe("Review")
    if (next._tag === "Review") {
      expect(next.event?._tag).toBe("sleep")
      expect(next.error).toBeUndefined()
      expect(next.rawText).toBe("nap")
    }
    expect(commands).toEqual([])
  })

  it("Extracting + ExtractionFailed → Review WITHOUT event but WITH raw text (never gates capture)", () => {
    const extracting: CaptureState = {
      _tag: "Extracting",
      captureId: CAPTURE_ID,
      rawText: "unclassifiable text",
      occurredAt: NOW,
    }
    const [next, commands] = dispatch(extracting, { _tag: "ExtractionFailed", reason: "unclassified" })
    expect(next._tag).toBe("Review")
    if (next._tag === "Review") {
      expect(next.event).toBeUndefined()
      expect(next.error).toBe("unclassified")
      expect(next.rawText).toBe("unclassifiable text")
    }
    expect(commands).toEqual([])
  })

  it("Review + PublishRequested emits PublishEvent when an event exists", () => {
    const review: CaptureState = {
      _tag: "Review",
      captureId: CAPTURE_ID,
      rawText: "raw",
      occurredAt: NOW,
      event: { _tag: "meal", food: "pasta", amount: "most", occurredAt: NOW },
    }
    const [next, commands] = dispatch(review, { _tag: "PublishRequested" })
    expect(next._tag).toBe("Review")
    expect(commands).toEqual([{ _tag: "PublishEvent", captureId: CAPTURE_ID, event: review.event }])
  })

  it("Review + PublishRequested emits PublishRawOnly when extraction failed", () => {
    const review: CaptureState = {
      _tag: "Review",
      captureId: CAPTURE_ID,
      rawText: "raw",
      occurredAt: NOW,
      error: "unclassified",
    }
    const [next, commands] = dispatch(review, { _tag: "PublishRequested" })
    expect(next._tag).toBe("Review")
    expect(commands).toEqual([{ _tag: "PublishRawOnly", captureId: CAPTURE_ID }])
  })

  it("Review + PublishSucceeded → Published keeping raw + event", () => {
    const event = { _tag: "meal" as const, food: "pasta", amount: "most" as const, occurredAt: NOW }
    const review: CaptureState = {
      _tag: "Review",
      captureId: CAPTURE_ID,
      rawText: "she ate most of her pasta",
      occurredAt: NOW,
      event,
    }
    const [next, commands] = dispatch(review, { _tag: "PublishSucceeded", entryId: "entry_1", publishedAt: NOW + 5 })
    expect(next._tag).toBe("Published")
    if (next._tag === "Published") {
      expect(next.entryId).toBe("entry_1")
      expect(next.rawText).toBe("she ate most of her pasta")
      expect(next.event?._tag).toBe("meal")
    }
    expect(commands).toEqual([])
  })

  it("Review + PublishFailed → Review retains raw text AND event (retry-safe)", () => {
    const event = { _tag: "meal" as const, food: "pasta", amount: "most" as const, occurredAt: NOW }
    const review: CaptureState = {
      _tag: "Review",
      captureId: CAPTURE_ID,
      rawText: "she ate most of her pasta",
      occurredAt: NOW,
      event,
    }
    const [next, commands] = dispatch(review, { _tag: "PublishFailed", reason: "EVENT_DECODE_FAILED: boom" })
    expect(next._tag).toBe("Review")
    if (next._tag === "Review") {
      expect(next.error).toContain("EVENT_DECODE_FAILED")
      expect(next.event?._tag).toBe("meal")
      expect(next.rawText).toBe("she ate most of her pasta")
    }
    expect(commands).toEqual([])
  })

  it("Transcribed + PersistCaptureFailed retains raw text with error", () => {
    const transcribed: CaptureState = {
      _tag: "Transcribed",
      captureId: CAPTURE_ID,
      rawText: "precious raw text",
      occurredAt: NOW,
    }
    const [next] = dispatch(transcribed, { _tag: "PersistCaptureFailed", reason: "network down" })
    expect(next._tag).toBe("Transcribed")
    if (next._tag === "Transcribed") {
      expect(next.rawText).toBe("precious raw text")
      expect(next.error).toBe("network down")
    }
  })

  it("Published + Reset → Idle", () => {
    const published: CaptureState = {
      _tag: "Published",
      captureId: CAPTURE_ID,
      rawText: "raw",
      occurredAt: NOW,
      entryId: "entry_1",
      publishedAt: NOW,
    }
    const [next] = dispatch(published, { _tag: "Reset" })
    expect(next._tag).toBe("Idle")
  })

  it("illegal message/state pairs are ignored, never throw", () => {
    const [next, commands] = dispatch({ _tag: "Idle" }, {
      _tag: "StopRecording",
      rawText: "x",
      captureId: CAPTURE_ID,
      occurredAt: NOW,
    })
    expect(next._tag).toBe("Idle")
    expect(commands).toEqual([])
  })
})

describe("deterministic extractor (CONTROLLED TEST DOUBLE)", () => {
  const extract = (rawText: string) => extractDeterministic({ captureId: CAPTURE_ID, rawText, occurredAt: NOW })

  it("classifies a meal with amount", () => {
    expect(extract("She ate most of her pasta at lunch")).toMatchObject({
      _tag: "meal",
      amount: "most",
    })
  })

  it("classifies a refused meal as none", () => {
    expect(extract("He didn't eat his breakfast")).toMatchObject({ _tag: "meal", amount: "none" })
  })

  it("classifies a successful potty event", () => {
    expect(extract("pooped in the potty, big success")).toMatchObject({ _tag: "potty", success: true, kind: "poop" })
  })

  it("classifies a potty accident as failure", () => {
    expect(extract("had a pee accident at school")).toMatchObject({ _tag: "potty", success: false, kind: "pee" })
  })

  it("classifies naps with duration", () => {
    expect(extract("She napped for 45 minutes")).toEqual({ _tag: "sleep", kind: "nap", minutes: 45, occurredAt: NOW })
  })

  it("classifies milestones", () => {
    expect(extract("first time riding the balance bike")).toMatchObject({ _tag: "milestone" })
  })

  it("classifies school notes", () => {
    expect(extract("drop-off was rough but she settled")).toMatchObject({ _tag: "school" })
  })

  it("classifies mood", () => {
    expect(extract("she was so proud of her tower")).toMatchObject({ _tag: "mood", mood: "happy" })
  })

  it("returns undefined for unclassifiable text (raw-only publish path)", () => {
    expect(extract("random words with no signal")).toBeUndefined()
    expect(extract("")).toBeUndefined()
  })

  it("ExtractionService layer fails with typed ExtractionError on unclassified text", async () => {
    const program = Effect.provide(
      Effect.result(
        Effect.gen(function*() {
          const service = yield* ExtractionService
          return yield* service.extract({ captureId: CAPTURE_ID, rawText: "nothing here", occurredAt: NOW })
        })
      ),
      DeterministicExtractionLayer
    )
    const result = await Effect.runPromise(program)
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      const failure = result.failure
      expect(failure).toBeInstanceOf(ExtractionError)
      if (failure instanceof ExtractionError) {
        expect(failure.reason).toBe("unclassified")
      }
    }
  })

  it("ExtractionService layer succeeds through the Layer wire", async () => {
    const program = Effect.provide(
      Effect.gen(function*() {
        const service = yield* ExtractionService
        return yield* service.extract({
          captureId: CAPTURE_ID,
          rawText: "she ate most of her pasta",
          occurredAt: NOW,
        })
      }),
      DeterministicExtractionLayer
    )
    const event = await Effect.runPromise(program)
    expect(event._tag).toBe("meal")
  })
})
