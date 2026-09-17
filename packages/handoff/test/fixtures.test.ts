import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import {
  DigestInput,
  FollowUpAnswer,
  HandoffDigest,
  answerFollowUp,
  answerToText,
  assertCareNeutral,
  composeSinceLastSeen,
  digestToText,
} from "../src/index.js"

// The fixture envelope is itself schema-checked: DigestInput decodes the
// scenario input, ExpectationSchema guards the expectation block.
const ExpectationSchema = Schema.Struct({
  claimCountByCategory: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  statementContainsByCategory: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Array(Schema.String)),
  ),
  gapDates: Schema.optionalKey(Schema.Array(Schema.String)),
  coverageZero: Schema.optionalKey(Schema.Array(Schema.String)),
  questionTags: Schema.optionalKey(Schema.Array(Schema.String)),
  excludedFromDigest: Schema.optionalKey(Schema.Array(Schema.String)),
  digestContains: Schema.optionalKey(Schema.Array(Schema.String)),
  suggestedFollowUpsMin: Schema.optionalKey(Schema.Number),
  followUps: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        question: Schema.String,
        outcome: Schema.Literals(["answered", "not-logged", "refused-medical", "refused-out-of-window"]),
        answerContains: Schema.optionalKey(Schema.Array(Schema.String)),
        mustCite: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  ),
})

const HandoffFixtureSchema = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  input: DigestInput,
  expect: ExpectationSchema,
})

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures")
const fixtures = readdirSync(fixturesDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) =>
    Schema.decodeUnknownSync(HandoffFixtureSchema)(JSON.parse(readFileSync(join(fixturesDir, file), "utf8"))),
  )

expect(fixtures.length).toBeGreaterThanOrEqual(6)

const runFixture = (fixture: (typeof fixtures)[number]) => {
  const digest = composeSinceLastSeen(fixture.input)
  // The digest must satisfy the exported contract.
  expect(Schema.decodeUnknownSync(HandoffDigest)(digest)).toEqual(digest)

  const text = digestToText(digest)

  // Hard rules hold on every generated field of every fixture.
  for (const claim of [...digest.claims, ...digest.routineContext]) assertCareNeutral(claim.statement)
  for (const question of digest.unresolvedQuestions) assertCareNeutral(question.question)
  for (const gap of digest.gapDisclosures) assertCareNeutral(gap.disclosure)
  for (const row of digest.coverage) assertCareNeutral(row.note)

  // Source links: every claim and every question cites at least one source.
  for (const claim of digest.claims) expect(claim.sourceRefs.length).toBeGreaterThanOrEqual(1)
  for (const question of digest.unresolvedQuestions) expect(question.sourceRefs.length).toBeGreaterThanOrEqual(1)

  const expected = fixture.expect
  if (expected.claimCountByCategory) {
    const counts = new Map<string, number>()
    for (const claim of digest.claims) {
      const category = claim.category
      if (category) counts.set(category, (counts.get(category) ?? 0) + 1)
    }
    for (const [category, count] of Object.entries(expected.claimCountByCategory)) {
      expect(counts.get(category) ?? 0).toBe(count)
    }
  }
  if (expected.statementContainsByCategory) {
    for (const [category, substrings] of Object.entries(expected.statementContainsByCategory)) {
      const statements = digest.claims.filter((claim) => claim.category === category).map((claim) => claim.statement)
      for (const substring of substrings) {
        expect(statements.some((statement) => statement.includes(substring))).toBe(true)
      }
    }
  }
  if (expected.gapDates) {
    expect(digest.gapDisclosures.map((gap) => gap.day)).toEqual([...expected.gapDates])
  }
  if (expected.coverageZero) {
    const zeroCategories = digest.coverage.filter((row) => row.observed === 0).map((row) => `${row.category}`)
    expect(zeroCategories).toEqual([...expected.coverageZero])
  }
  if (expected.questionTags) {
    const reasons = digest.unresolvedQuestions.map((question) => `${question.reason}`).sort()
    expect(reasons).toEqual([...expected.questionTags].sort())
  }
  if (expected.excludedFromDigest) {
    for (const secret of expected.excludedFromDigest) {
      expect(text.includes(secret)).toBe(false)
    }
  }
  if (expected.digestContains) {
    for (const fragment of expected.digestContains) {
      expect(text.includes(fragment)).toBe(true)
    }
  }
  if (expected.suggestedFollowUpsMin !== undefined) {
    expect(digest.suggestedFollowUps.length).toBeGreaterThanOrEqual(expected.suggestedFollowUpsMin)
  }
  if (expected.followUps) {
    for (const probe of expected.followUps) {
      const answer = answerFollowUp(probe.question, fixture.input)
      expect(Schema.decodeUnknownSync(FollowUpAnswer)(answer)).toEqual(answer)
      expect(answer._tag).toBe(probe.outcome)
      if (probe.answerContains) {
        const rendered = answerToText(answer)
        for (const fragment of probe.answerContains) {
          expect(rendered.includes(fragment)).toBe(true)
        }
      }
      if (probe.mustCite && answer._tag === "answered") {
        expect(answer.claim.sourceRefs.length).toBeGreaterThanOrEqual(1)
      }
    }
  }
}

describe("handoff acceptance fixtures", () => {
  for (const fixture of fixtures) {
    test(`${fixture.id}: ${fixture.description}`, () => {
      runFixture(fixture)
    })
  }
})
