/**
 * Executable proofs for the ambiguous-reference clarify + correction-driven
 * answer invalidation spike (art_gCDrtx4S, synthesis art_gfwpdmWF §3/§6).
 *
 * Every fixture case runs against the pure reducers in reducer.ts with fixed
 * times and synthetic fx_* ids only — no provider, no clock, no randomness.
 * The `expected` blocks in the fixture JSON drive the exact-string asserts.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Schema } from "effect"
import {
  bumpWatermark,
  changedRecordSet,
  commitRevision,
  computeClarify,
  invalidateAnswers,
  serveAnswer,
  type ReferenceStore,
} from "./reducer.js"
import {
  Answered,
  Citation,
  ClarifyOption,
  ClarifyOutcome,
  LineageWatermark,
  ProvenanceSource,
  ReferenceEnvelope,
  RevisionLink,
  UnresolvedReference,
} from "./schema.js"

// ---- fixture loading + schema bridges ----

interface Fixture {
  fixtureId: string
  input: Record<string, unknown>
  expected: Record<string, unknown>
}

const loadFixture = (name: string): Fixture =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures", `${name}.json`), "utf8"))

const decodeEnvelope = (value: unknown): ReferenceEnvelope =>
  Schema.decodeUnknownSync(ReferenceEnvelope)(value)

/** Decode + encodeSync round-trip: the wire shape survives the full cycle. */
const envelopeRoundTrip = (value: unknown): ReferenceEnvelope => {
  const decoded = decodeEnvelope(value)
  // the wire value provably decodes (line above) — comparing shapes against the same value
  expect(Schema.encodeSync(ReferenceEnvelope)(decoded)).toEqual(value as ReferenceEnvelope)
  return decoded
}

const decodeAnswered = (value: unknown): Answered => Schema.decodeUnknownSync(Answered)(value)

const decodeRevision = (value: unknown): RevisionLink => Schema.decodeUnknownSync(RevisionLink)(value)

const expectTag = <Tag extends ClarifyOutcome["_tag"]>(
  outcome: ClarifyOutcome,
  tag: Tag,
): Extract<ClarifyOutcome, { _tag: Tag }> => {
  if (outcome._tag !== tag) throw new Error(`expected ${tag}, got ${outcome._tag}`)
  return outcome as Extract<ClarifyOutcome, { _tag: Tag }>
}

const emptyStore = (...answers: readonly Answered[]): ReferenceStore => ({
  householdId: "fx_household_1",
  watermarkVersion: 0,
  answers: [...answers],
  committedRevisionIds: [],
})

// ---- schema decode round-trips ----

describe("schema decode round-trips", () => {
  test("every fixture envelope decodes and encodes to identical JSON", () => {
    envelopeRoundTrip(loadFixture("F-AX-CLARIFY-001").input.envelope)
    const correct = loadFixture("F-AX-CORRECT-ANSWER-001")
    envelopeRoundTrip(correct.input.envelopeAsk)
    envelopeRoundTrip(correct.input.envelopeCorrect)
    const resume = loadFixture("F-AX-RESUME-REFS-001")
    envelopeRoundTrip(resume.input.originalEnvelope)
    envelopeRoundTrip(resume.input.resumedEnvelope)
    envelopeRoundTrip(loadFixture("F-AX-UNRESOLVED-CORRECTION-001").input.envelope)
    envelopeRoundTrip(loadFixture("F-AX-LEAK-001").input.envelope)
  })

  test("fixture answers, revision, and watermark decode and round-trip", () => {
    const correct = loadFixture("F-AX-CORRECT-ANSWER-001")
    const a1 = decodeAnswered(correct.input.answerA1)
    const a2 = decodeAnswered(correct.input.answerA2)
    const revision = decodeRevision(correct.input.revision)
    const stale = loadFixture("F-AX-STALE-ANSWER-001")
    const superseded = decodeAnswered(stale.input.storedAnswerA1)
    expect(Schema.encodeSync(Answered)(a1)).toEqual(a1)
    expect(Schema.encodeSync(Answered)(a2)).toEqual(a2)
    expect(Schema.encodeSync(Answered)(superseded)).toEqual(superseded)
    expect(Schema.encodeSync(RevisionLink)(revision)).toEqual(revision)
    expect(Schema.encodeSync(LineageWatermark)(a1.readWatermark)).toEqual(a1.readWatermark)
    expect(Schema.encodeSync(LineageWatermark)(a2.readWatermark)).toEqual(a2.readWatermark)
    expect(a1.status).toBe("current")
    expect(superseded.status).toBe("superseded")
  })

  test("malformed values fail closed at decode", () => {
    expect(() => Schema.decodeUnknownSync(ProvenanceSource)("guessed")).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(UnresolvedReference)({
        _tag: "unresolved-reference",
        envelopeId: "fx_env_x",
        reason: "most-recent-guess",
        retryable: false,
      }),
    ).toThrow()
  })

  test("every fixture clarify outcome decodes against the read-only union", () => {
    const outcomes = [
      computeClarify(envelopeRoundTrip(loadFixture("F-AX-CLARIFY-001").input.envelope)),
      computeClarify(decodeEnvelope(loadFixture("F-AX-CORRECT-ANSWER-001").input.envelopeCorrect)),
      computeClarify(decodeEnvelope(loadFixture("F-AX-RESUME-REFS-001").input.resumedEnvelope)),
      computeClarify(decodeEnvelope(loadFixture("F-AX-UNRESOLVED-CORRECTION-001").input.envelope)),
      computeClarify(decodeEnvelope(loadFixture("F-AX-LEAK-001").input.envelope)),
    ]
    for (const outcome of outcomes) {
      expect(Schema.decodeUnknownSync(ClarifyOutcome)(outcome)).toEqual(outcome)
      expect(Schema.encodeSync(ClarifyOutcome)(outcome)).toEqual(outcome)
    }
  })
})

// ---- F-AX-CLARIFY-001 ----

describe("F-AX-CLARIFY-001", () => {
  test("two in-scope children produce one bounded clarification with exact options", () => {
    const fixture = loadFixture("F-AX-CLARIFY-001")
    const expected = fixture.expected as {
      question: string
      optionCount: number
      optionTargetIds: string[]
      optionKinds: ClarifyOption["kind"][]
      optionLabels: string[]
      optionProvenance: ProvenanceSource[]
      ambiguousReferenceIds: string[]
    }
    const outcome = computeClarify(envelopeRoundTrip(fixture.input.envelope))
    const question = expectTag(outcome, "clarify-question")

    expect(question.question).toBe(expected.question)
    expect(question.options).toHaveLength(expected.optionCount)
    expect(question.options.map((option) => option.targetId)).toEqual(expected.optionTargetIds)
    expect(question.options.map((option) => option.kind)).toEqual(expected.optionKinds)
    expect(question.options.map((option) => option.label)).toEqual(expected.optionLabels)
    expect(question.options.map((option) => option.provenance)).toEqual(expected.optionProvenance)
    expect(question.ambiguousReferenceIds).toEqual(expected.ambiguousReferenceIds)
  })

  test("clarification is read-scoped: input untouched, no write payload anywhere", () => {
    const fixture = loadFixture("F-AX-CLARIFY-001")
    const envelope = decodeEnvelope(fixture.input.envelope)
    const snapshot = structuredClone(envelope)
    const outcome = computeClarify(envelope)

    expect(envelope).toEqual(snapshot)
    expect(Object.keys(outcome).sort()).toEqual(
      ["_tag", "ambiguousReferenceIds", "envelopeId", "options", "question"].sort(),
    )
    for (const option of expectTag(outcome, "clarify-question").options) {
      expect(Object.keys(option).sort()).toEqual(["kind", "label", "provenance", "targetId"].sort())
    }
  })
})

// ---- F-AX-CLARIFY-002 (review finding F1: dedup BEFORE the count checks) ----

describe("F-AX-CLARIFY-002", () => {
  const fixture = loadFixture("F-AX-CLARIFY-002")
  const expected = fixture.expected as {
    outcomeTag: string
    targetId: string
    kind: "child" | "entry" | "event" | "message"
    provenance: ProvenanceSource
    basis: string
    clarifyQuestionEmitted: boolean
    zeroWrites: boolean
  }

  test("two visible references to the same child collapse to ONE candidate — a resolved binding, never a 1-option question", () => {
    const envelope = decodeEnvelope(fixture.input.envelope)
    const snapshot = structuredClone(envelope)
    const outcome = computeClarify(envelope)

    expect((outcome._tag === "clarify-question")).toBe(expected.clarifyQuestionEmitted)
    const resolved = expectTag(outcome, "resolved")
    expect(resolved.targetId).toBe(expected.targetId)
    expect(resolved.kind).toBe(expected.kind)
    expect(resolved.provenance).toBe(expected.provenance)
    expect(resolved.basis).toBe(expected.basis)

    // the outcome decodes against the read-only union and writes nothing
    expect(Schema.decodeUnknownSync(ClarifyOutcome)(outcome)).toEqual(outcome)
    expect(envelope).toEqual(snapshot)
  })
})

// ---- F-AX-CLARIFY-003 (review finding F1: dedup AFTER the currentChild tiebreak) ----

describe("F-AX-CLARIFY-003", () => {
  const fixture = loadFixture("F-AX-CLARIFY-003")
  const expected = fixture.expected as {
    outcomeTag: string
    targetId: string
    kind: "child" | "entry" | "event" | "message"
    provenance: ProvenanceSource
    basis: string
    clarifyQuestionEmitted: boolean
    zeroWrites: boolean
  }

  test("with currentChild asserted, tiebreak keeps both same-child candidates and dedup still resolves — never a 1-option question", () => {
    const envelope = decodeEnvelope(fixture.input.envelope)
    const snapshot = structuredClone(envelope)
    const outcome = computeClarify(envelope)

    expect((outcome._tag === "clarify-question")).toBe(expected.clarifyQuestionEmitted)
    const resolved = expectTag(outcome, "resolved")
    expect(resolved.targetId).toBe(expected.targetId)
    expect(resolved.kind).toBe(expected.kind)
    expect(resolved.provenance).toBe(expected.provenance)
    expect(resolved.basis).toBe(expected.basis)

    expect(Schema.decodeUnknownSync(ClarifyOutcome)(outcome)).toEqual(outcome)
    expect(envelope).toEqual(snapshot)
  })
})

// ---- F-AX-CORRECT-ANSWER-001 ----

describe("F-AX-CORRECT-ANSWER-001", () => {
  const fixture = loadFixture("F-AX-CORRECT-ANSWER-001")
  const expected = fixture.expected as {
    clarifyOnCorrectionEnvelope: { outcomeTag: string; targetId: string; kind: ClarifyOption["kind"]; provenance: ProvenanceSource }
    a2Status: Answered["status"]
    a1ReadWatermarkVersion: number
    a2ReadWatermarkVersion: number
    a2VersionStrictlyGreaterThanA1: boolean
    a2ResponseStates: string
    a2CitationRecordIds: string[]
    a2CitationRecordKinds: Citation["recordKind"][]
    a2RevisionChainLength: number
    a2RevisionChainSummary: string
    a1FinalStatus: Answered["status"]
    a1SupersededByRevisionId: string
    a1RetrievableAfterRevision: boolean
    a1ServableAsCurrent: boolean
    zeroWritesFromAnswerOps: boolean
  }
  const a1 = decodeAnswered(fixture.input.answerA1)
  const a2 = decodeAnswered(fixture.input.answerA2)
  const revision = decodeRevision(fixture.input.revision)
  const correctionEnvelope = decodeEnvelope(fixture.input.envelopeCorrect)

  test("the correction envelope resolves its target from viewContext alone", () => {
    const outcome = computeClarify(correctionEnvelope)
    const binding = expectTag(outcome, "resolved")
    const expectedTarget = expected.clarifyOnCorrectionEnvelope
    expect(binding.targetId).toBe(expectedTarget.targetId)
    expect(binding.kind).toBe(expectedTarget.kind)
    expect(binding.provenance).toBe(expectedTarget.provenance)
  })

  test("committing the revision supersedes A1 exhaustively and bumps the watermark exactly once", () => {
    const { store, supersededAnswerIds } = commitRevision(emptyStore(a1), revision)

    expect(store.watermarkVersion).toBe(expected.a2ReadWatermarkVersion)
    expect(supersededAnswerIds).toEqual(["fx_ans_001"])
    // marked, never deleted
    expect(store.answers).toHaveLength(1)
    const a1After = store.answers[0]
    expect(a1After?.status).toBe(expected.a1FinalStatus)
    // RevisionId is a branded string — normalize for the comparison
    expect(String(a1After?.supersededByRevisionId)).toBe(expected.a1SupersededByRevisionId)
    expect(store.committedRevisionIds).toEqual(["fx_rev_001"])
  })

  test("A2 cites the revision chain and is servable; A1 is never servable as current", () => {
    expect(a2.status).toBe(expected.a2Status)
    expect(a2.readWatermark.version > a1.readWatermark.version).toBe(expected.a2VersionStrictlyGreaterThanA1)
    expect(a2.citations.map((citation) => citation.recordId)).toEqual(expected.a2CitationRecordIds)
    expect(a2.citations.map((citation) => citation.recordKind)).toEqual(expected.a2CitationRecordKinds)
    const chain = a2.revisionChain ?? []
    expect(chain).toHaveLength(expected.a2RevisionChainLength)
    expect(chain[0]?.summary).toBe(expected.a2RevisionChainSummary)

    const servedA2 = serveAnswer(a2, 1)
    expect(servedA2).toBe(a2) // current answer served as-is

    const { store } = commitRevision(emptyStore(a1), revision)
    const servedA1 = serveAnswer(store.answers[0], 1)
    if (servedA1 === undefined || servedA1._tag !== "watermark-moved") {
      throw new Error(`expected watermark-moved, got ${JSON.stringify(servedA1)}`)
    }
    expect(servedA1.observedVersion).toBe(expected.a1ReadWatermarkVersion)
    expect(servedA1.currentVersion).toBe(expected.a2ReadWatermarkVersion)
    expect(JSON.stringify(servedA1)).not.toContain("1 hour")
  })
})

// ---- F-AX-RESUME-REFS-001 ----

describe("F-AX-RESUME-REFS-001", () => {
  const fixture = loadFixture("F-AX-RESUME-REFS-001")
  const expected = fixture.expected as {
    sameReferenceIds: string[]
    sameTargetIds: string[]
    sameVisibleToActor: boolean[]
    resumedCurrentChildSource: ProvenanceSource
    resumedCurrentChildChildId: string
    reClarifyOutcomeTag: string
    reClarifyTargetId: string
    reClarifyProvenance: ProvenanceSource
    historicalAnswerStatusAfterRestore: Answered["status"]
    historicalAnswerSupersededByRevisionId: string
    historicalAnswerServableAsCurrent: boolean
  }
  const original = decodeEnvelope(fixture.input.originalEnvelope)
  const resumed = decodeEnvelope(fixture.input.resumedEnvelope)
  const historical = decodeAnswered(fixture.input.historicalAnswerA1)
  const revision = decodeRevision(fixture.input.revisionWhileClosed)

  test("the resumed envelope carries the same references with currentChild user-asserted", () => {
    const projected = (envelope: ReferenceEnvelope) =>
      envelope.references?.map((reference) => ({
        referenceId: reference.referenceId,
        targetId: reference.targetId,
        visibleToActor: reference.visibleToActor,
      }))
    expect(projected(resumed)).toEqual(projected(original))
    expect(projected(resumed)?.map((reference) => reference.referenceId)).toEqual(expected.sameReferenceIds)
    expect(projected(resumed)?.map((reference) => reference.targetId)).toEqual(expected.sameTargetIds)
    expect(projected(resumed)?.map((reference) => reference.visibleToActor)).toEqual(expected.sameVisibleToActor)
    expect(resumed.currentChild?.source).toBe(expected.resumedCurrentChildSource)
    expect(resumed.currentChild?.value.childId).toBe(expected.resumedCurrentChildChildId)
  })

  test("the spoken answer resolves by user-asserted provenance, not by re-guessing", () => {
    const outcome = computeClarify(resumed)
    const binding = expectTag(outcome, "resolved")
    expect(binding.targetId).toBe(expected.reClarifyTargetId)
    expect(binding.provenance).toBe(expected.reClarifyProvenance)
  })

  test("a historical answer renders superseded after restore — never as current truth", () => {
    const { store } = commitRevision(emptyStore(historical), revision)
    const restored = store.answers[0]
    expect(restored?.status).toBe(expected.historicalAnswerStatusAfterRestore)
    // RevisionId is a branded string — normalize for the comparison
    expect(String(restored?.supersededByRevisionId)).toBe(expected.historicalAnswerSupersededByRevisionId)
    const served = serveAnswer(restored, store.watermarkVersion)
    if (served === undefined || served._tag !== "watermark-moved") {
      throw new Error(`expected watermark-moved, got ${JSON.stringify(served)}`)
    }
    expect(served.observedVersion).toBe(historical.readWatermark.version)
  })
})

// ---- F-AX-STALE-ANSWER-001 ----

describe("F-AX-STALE-ANSWER-001", () => {
  const fixture = loadFixture("F-AX-STALE-ANSWER-001")
  const expected = fixture.expected as {
    everyPathOutcomeTag: string
    observedVersion: number
    currentVersion: number
    errorRetryable: boolean
    serializedErrorMustNotContain: string[]
    preCorrectionValueNeverCurrent: boolean
    recomputedAnswerCitesRevisionId: string
  }
  const stale = decodeAnswered(fixture.input.storedAnswerA1)
  const currentVersion = fixture.input.currentWatermarkVersion as number

  test("every serving path gets the typed retryable error — never the pre-correction value", () => {
    for (const path of fixture.input.servingPaths as string[]) {
      const served = serveAnswer(stale, currentVersion)
      if (served === undefined || served._tag !== "watermark-moved") {
        throw new Error(`path ${path}: expected watermark-moved, got ${JSON.stringify(served)}`)
      }
      expect(served.observedVersion).toBe(expected.observedVersion)
      expect(served.currentVersion).toBe(expected.currentVersion)
      expect(served.retryable).toBe(expected.errorRetryable)
      const serialized = JSON.stringify(served)
      for (const forbidden of expected.serializedErrorMustNotContain) {
        expect(serialized).not.toContain(forbidden)
      }
      // never the stored response, never the stored object
      expect(served).not.toBe(stale)
      expect(served).not.toHaveProperty("response")
    }
  })

  test("the recomputed answer cites the revision and is servable at the current watermark", () => {
    const a2 = decodeAnswered(loadFixture("F-AX-CORRECT-ANSWER-001").input.answerA2)
    expect(a2.citations.some((citation) => citation.recordId === expected.recomputedAnswerCitesRevisionId)).toBe(
      true,
    )
    expect(serveAnswer(a2, currentVersion)).toBe(a2)
  })
})

// ---- F-AX-UNRESOLVED-CORRECTION-001 ----

describe("F-AX-UNRESOLVED-CORRECTION-001", () => {
  const fixture = loadFixture("F-AX-UNRESOLVED-CORRECTION-001")
  const expected = fixture.expected as {
    outcomeTag: string
    reason: UnresolvedReference["reason"]
    retryable: boolean
    detailAbsent: boolean
    serializedOutcomeMustNotContain: string[]
    zeroWrites: boolean
  }

  test("a correction with no resolvable target returns the typed error and invents nothing", () => {
    const envelope = decodeEnvelope(fixture.input.envelope)
    const snapshot = structuredClone(envelope)
    const outcome = computeClarify(envelope)
    const unresolved = expectTag(outcome, "unresolved-reference")

    expect(unresolved.reason).toBe(expected.reason)
    expect(unresolved.retryable).toBe(expected.retryable)
    expect("detail" in unresolved).toBe(false)

    const serialized = JSON.stringify(outcome)
    for (const forbidden of expected.serializedOutcomeMustNotContain) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(envelope).toEqual(snapshot)
  })
})

// ---- F-AX-LEAK-001 ----

describe("F-AX-LEAK-001", () => {
  const fixture = loadFixture("F-AX-LEAK-001")
  const expected = fixture.expected as {
    outcomeTag: string
    reason: UnresolvedReference["reason"]
    retryable: boolean
    detailAbsent: boolean
    serializedOutcomeMustNotContain: string[]
    roleNeverWidensScope: boolean
    zeroWrites: boolean
  }

  test("an invisible private reference fails typed and leaks neither id nor content", () => {
    const envelope = decodeEnvelope(fixture.input.envelope)
    const snapshot = structuredClone(envelope)
    const outcome = computeClarify(envelope)
    const unresolved = expectTag(outcome, "unresolved-reference")

    expect(unresolved.reason).toBe(expected.reason)
    expect(unresolved.retryable).toBe(expected.retryable)
    expect("detail" in unresolved).toBe(false)

    const serialized = JSON.stringify(outcome)
    for (const forbidden of expected.serializedOutcomeMustNotContain) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(envelope).toEqual(snapshot)
  })

  test("publication state and audience hold separately, and role never widens scope", () => {
    const envelope = decodeEnvelope(fixture.input.envelope)
    const privateRecord = fixture.input.privateRecord as {
      publicationState: string
      audience: string[]
    }
    // two independent exclusion reasons, never fused into one field
    expect(privateRecord.publicationState).toBe("draft")
    expect(privateRecord.audience).not.toContain("fx_caregiver_1")

    const baseline = computeClarify(envelope)
    // flipping the role to parent without touching per-record visibility must not widen scope
    const flipped = { ...envelope, actor: { authorId: "fx_caregiver_1", role: "parent" as const } }
    const flippedOutcome = computeClarify(flipped)
    expect(flippedOutcome).toEqual(baseline)
    expect(expectTag(flippedOutcome, "unresolved-reference").reason).toBe("target-not-visible")
  })
})

// ---- invariants beyond the six fixtures ----

describe("invariants beyond the fixtures", () => {
  test("no emitted clarify question ever has fewer than two or more than four options (F1 invariant, all fixtures)", () => {
    const envelopeInputs = [
      loadFixture("F-AX-CLARIFY-001").input.envelope,
      loadFixture("F-AX-CLARIFY-002").input.envelope,
      loadFixture("F-AX-CLARIFY-003").input.envelope,
      loadFixture("F-AX-CORRECT-ANSWER-001").input.envelopeCorrect,
      loadFixture("F-AX-RESUME-REFS-001").input.resumedEnvelope,
      loadFixture("F-AX-UNRESOLVED-CORRECTION-001").input.envelope,
      loadFixture("F-AX-LEAK-001").input.envelope,
    ]
    for (const value of envelopeInputs) {
      const outcome = computeClarify(decodeEnvelope(value))
      if (outcome._tag === "clarify-question") {
        expect(outcome.options.length >= 2 && outcome.options.length <= 4).toBe(true)
      }
    }
  })
  test("changedRecordSet covers the event and its containing entry", () => {
    const withEntry = decodeRevision({
      revisionId: "fx_rev_t001",
      targetRecordId: "fx_evt_sleep_001",
      containingEntryId: "fx_entry_sleep_001",
      revisedAt: 1789677000000,
      summary: "test revision",
    })
    const withoutEntry = decodeRevision({
      revisionId: "fx_rev_t002",
      targetRecordId: "fx_evt_sleep_001",
      revisedAt: 1789677000000,
      summary: "test revision",
    })
    expect([...changedRecordSet(withEntry)]).toEqual(["fx_evt_sleep_001", "fx_entry_sleep_001"])
    expect([...changedRecordSet(withoutEntry)]).toEqual(["fx_evt_sleep_001"])
  })

  test("invalidation is exhaustive over cited records and catches entry-level citations", () => {
    const citesEvent = decodeAnswered({
      _tag: "answered",
      envelopeId: "fx_env_t001",
      response: "test answer citing the event",
      citations: [{ recordId: "fx_evt_sleep_001", recordKind: "event" }],
      answerId: "fx_ans_t001",
      readWatermark: { householdId: "fx_household_1", version: 0 },
      status: "current",
    })
    const citesEntryOnly = decodeAnswered({
      _tag: "answered",
      envelopeId: "fx_env_t002",
      response: "test answer citing only the containing entry",
      citations: [{ recordId: "fx_entry_sleep_001", recordKind: "entry" }],
      answerId: "fx_ans_t002",
      readWatermark: { householdId: "fx_household_1", version: 0 },
      status: "current",
    })
    const citesElsewhere = decodeAnswered({
      _tag: "answered",
      envelopeId: "fx_env_t003",
      response: "test answer citing unrelated records",
      citations: [{ recordId: "fx_evt_leo_nap_001", recordKind: "event" }],
      answerId: "fx_ans_t003",
      readWatermark: { householdId: "fx_household_1", version: 0 },
      status: "current",
    })
    const revision = decodeRevision({
      revisionId: "fx_rev_t003",
      targetRecordId: "fx_evt_sleep_001",
      containingEntryId: "fx_entry_sleep_001",
      revisedAt: 1789677000000,
      summary: "test revision",
    })

    const { answers, supersededAnswerIds } = invalidateAnswers(
      [citesEvent, citesEntryOnly, citesElsewhere],
      revision,
    )
    expect(supersededAnswerIds).toEqual(["fx_ans_t001", "fx_ans_t002"])
    expect(answers).toHaveLength(3)
    expect(answers[2]?.status).toBe("current")
    // RevisionId is a branded string — normalize for the comparison
    expect(String(answers[0]?.supersededByRevisionId)).toBe("fx_rev_t003")
  })

  test("re-committing the same revision is a recorded no-op — one bump, one invalidation", () => {
    const revision = decodeRevision({
      revisionId: "fx_rev_t004",
      targetRecordId: "fx_evt_sleep_001",
      revisedAt: 1789677000000,
      summary: "test revision",
    })
    const answer = decodeAnswered({
      _tag: "answered",
      envelopeId: "fx_env_t004",
      response: "test answer",
      citations: [{ recordId: "fx_evt_sleep_001", recordKind: "event" }],
      answerId: "fx_ans_t004",
      readWatermark: { householdId: "fx_household_1", version: 0 },
      status: "current",
    })
    const first = commitRevision(emptyStore(answer), revision)
    expect(first.store.watermarkVersion).toBe(1)
    expect(first.supersededAnswerIds).toEqual(["fx_ans_t004"])
    const second = commitRevision(first.store, revision)
    expect(second.store.watermarkVersion).toBe(1)
    expect(second.supersededAnswerIds).toEqual([])
  })

  test("an unrelated revision bumps the watermark but leaves truthful answers servable", () => {
    const answer = decodeAnswered({
      _tag: "answered",
      envelopeId: "fx_env_t005",
      response: "test answer about unrelated records",
      citations: [{ recordId: "fx_evt_sleep_001", recordKind: "event" }],
      answerId: "fx_ans_t005",
      readWatermark: { householdId: "fx_household_1", version: 0 },
      status: "current",
    })
    const unrelated = decodeRevision({
      revisionId: "fx_rev_t005",
      targetRecordId: "fx_evt_other_999",
      revisedAt: 1789677000000,
      summary: "test revision elsewhere",
    })
    const { store, supersededAnswerIds } = commitRevision(emptyStore(answer), unrelated)
    expect(store.watermarkVersion).toBe(1)
    expect(supersededAnswerIds).toEqual([])
    expect(serveAnswer(store.answers[0], store.watermarkVersion)).toBe(store.answers[0])
  })

  test("more candidates than the option bound fail typed as ambiguous", () => {
    const envelope = decodeEnvelope({
      envelopeId: "fx_env_t006",
      captureId: "fx_capture_t006",
      capturedAt: 1789669800000,
      capturedAtTimezone: {
        value: "America/New_York",
        source: "app-known",
        basis: "device settings at capture time",
      },
      utterance: "test utterance",
      actor: { authorId: "fx_parent_a", role: "parent" },
      householdId: "fx_household_1",
      references: [1, 2, 3, 4, 5].map((n) => ({
        referenceId: `fx_ref_t00${n}`,
        kind: "event",
        targetId: `fx_evt_t00${n}`,
        snippet: `test event ${n}`,
        source: "app-known",
        visibleToActor: true,
      })),
    })
    const outcome = computeClarify(envelope)
    const unresolved = expectTag(outcome, "unresolved-reference")
    expect(unresolved.reason).toBe("ambiguous")
    expect(unresolved.retryable).toBe(false)
  })

  test("bumpWatermark is strictly monotonic by one", () => {
    let watermark: LineageWatermark = { householdId: "fx_household_1", version: 0 }
    watermark = bumpWatermark(watermark)
    expect(watermark.version).toBe(1)
    watermark = bumpWatermark(watermark)
    expect(watermark.version).toBe(2)
  })
})
