import { Result } from "effect"
import { describe, expect, it } from "vitest"
import { decodeJournalEvent, encodeJournalEvent } from "../src/index.ts"

const NOW = 1765000000000

describe("decodeJournalEvent (schema = validation authority)", () => {
  it("decodes a valid meal event", () => {
    const result = decodeJournalEvent({ _tag: "meal", food: "pasta", amount: "most", occurredAt: NOW })
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success._tag).toBe("meal")
    }
  })

  it("rejects an unknown category", () => {
    const result = decodeJournalEvent({ _tag: "party", occurredAt: NOW })
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure.message.length).toBeGreaterThan(0)
    }
  })

  it("rejects a meal with an out-of-vocabulary amount", () => {
    const result = decodeJournalEvent({ _tag: "meal", food: "pasta", amount: "half", occurredAt: NOW })
    expect(Result.isFailure(result)).toBe(true)
  })

  it("rejects a potty event missing its success flag", () => {
    const result = decodeJournalEvent({ _tag: "potty", kind: "pee", occurredAt: NOW })
    expect(Result.isFailure(result)).toBe(true)
  })

  it("rejects non-object garbage", () => {
    expect(Result.isFailure(decodeJournalEvent("hello"))).toBe(true)
    expect(Result.isFailure(decodeJournalEvent(null))).toBe(true)
    expect(Result.isFailure(decodeJournalEvent(42))).toBe(true)
  })

  it("round-trips encode → decode", () => {
    const event = { _tag: "sleep" as const, kind: "night" as const, occurredAt: NOW }
    const encoded = encodeJournalEvent(event)
    const result = decodeJournalEvent(encoded)
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual(event)
    }
  })
})
