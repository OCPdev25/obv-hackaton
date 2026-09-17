import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import { EntrySchema, EventSchema } from "@journal/domain"

import { generateCorpus } from "../src/corpus.js"
import { answerQuery, resolveEntrySource } from "../src/engine.js"
import { HistoryQueryAnswer } from "../src/queryContracts.js"
import { fixtures } from "./expectedAnswers.js"

const corpus = generateCorpus()

describe("corpus validity", () => {
  test("every record decodes through the canonical domain schemas", () => {
    expect(corpus.records.length).toBeGreaterThan(50)
    for (const record of corpus.records) {
      expect(Schema.is(EntrySchema)(record.entry)).toBe(true)
      for (const event of record.events) {
        expect(Schema.is(EventSchema)(event)).toBe(true)
        expect(event.householdId).toBe(corpus.householdId)
      }
    }
  })

  test("coverage is exactly 30 days with the two pinned gap days empty", () => {
    expect(corpus.coverage.dayCount).toBe(30)
    for (const record of corpus.records) {
      const day = Math.floor((record.entry.createdAt - corpus.coverage.firstDayUtcMs) / 86_400_000)
      expect(day === 8 || day === 9).toBe(false)
    }
  })
})

describe("expected-answer fixtures (hand-derived)", () => {
  for (const fixture of fixtures) {
    test(fixture.id, () => {
      const actual = answerQuery(fixture.input, corpus)
      // The answer must satisfy the answer contract...
      expect(Schema.is(HistoryQueryAnswer)(actual)).toBe(true)
      // ...and deep-equal the hand-derived expectation (decoded for key normalization).
      expect(actual).toEqual(Schema.decodeUnknownSync(HistoryQueryAnswer)(fixture.expected))
    })
  }

  test("superseded events are never served as citation sources", () => {
    for (const fixture of fixtures) {
      if (fixture.expected._tag !== "found") continue
      for (const citation of fixture.expected.citations) {
        for (const eventId of citation.eventIds) {
          for (const correction of corpus.corrections) {
            expect(eventId).not.toBe(correction.supersedesEventId)
          }
        }
      }
    }
  })
})

describe("determinism", () => {
  test("two runs produce byte-identical corpora and answers", () => {
    const first = generateCorpus()
    const second = generateCorpus()
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    for (const fixture of fixtures) {
      const a = answerQuery(fixture.input, first)
      const b = answerQuery(fixture.input, second)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }
  })

  test("querying does not mutate the corpus", () => {
    const frozen = generateCorpus()
    const before = JSON.stringify(frozen)
    for (const fixture of fixtures) answerQuery(fixture.input, frozen)
    expect(JSON.stringify(frozen)).toBe(before)
  })
})

describe("source navigation", () => {
  test("a citation's entryId resolves to the verbatim record", () => {
    const source = resolveEntrySource(corpus, "en-nap-d29")
    expect(source).toBeDefined()
    expect(source?.entry.rawTranscript).toBe("Ada napped 45 minutes after lunch.")
    expect(source?.events.length).toBe(1)
  })

  test("an unknown entryId resolves to undefined instead of guessing", () => {
    expect(resolveEntrySource(corpus, "en-nope")).toBeUndefined()
  })

  test("every fixture citation entryId resolves", () => {
    for (const fixture of fixtures) {
      if (fixture.expected._tag !== "found") continue
      for (const citation of fixture.expected.citations) {
        expect(resolveEntrySource(corpus, citation.entryId)).toBeDefined()
      }
    }
  })
})
