import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import {
  CareQuestionActivityDocument,
  CareQuestionActivitySchema,
  CareQuestionDocument,
  CareQuestionSchema,
  AskQuestionInput,
  buildHandoffDigest,
  canAnswerQuestion,
  canAskQuestion,
  canReopenQuestion,
  canResolveQuestion,
  canViewQuestion,
  deriveQuestionState,
  HandoffDigestOutput,
  visibleQuestions,
  type CareQuestionDocument as CareQuestionDocumentType,
  type CareQuestionActivityDocument as CareQuestionActivityDocumentType,
  type QuestionPrincipal,
  type QuestionDenyCode,
  type QuestionTargetFacts,
} from "../src/index.js"
import { convexFields } from "../src/convexAdapter.js"

/**
 * Caregiver-question contract tests: fixture-driven decode/derive/policy/digest
 * checks plus adapter coverage for the two proposed tables. Fixtures live in
 * evaluation/fixtures/agent-experience/caregiver-questions/ and decode through
 * the canonical schemas — the fixtures are executable evidence, not prose.
 */

interface FixtureEntry {
  readonly _id: string
  readonly authorId: string
  readonly visibility: string
}
interface QuestionFixture {
  readonly id: string
  readonly household: { readonly householdId: string; readonly memberIds: readonly string[] }
  readonly childId: string
  readonly entries: readonly FixtureEntry[]
  readonly questions: readonly unknown[]
  readonly activities: readonly unknown[]
  readonly expected: {
    readonly derived: readonly {
      readonly questionId: string
      readonly status: "open" | "answered" | "resolved"
      readonly reopenedCount: number
      readonly answerCount: number
      readonly handoffIncluded: boolean
    }[]
    readonly visibility: readonly {
      readonly questionId: string
      readonly allow: readonly string[]
      readonly deny: readonly { readonly caregiverId: string; readonly code: QuestionDenyCode }[]
    }[]
    readonly askDenies: readonly {
      readonly asCaregiverId: string
      readonly targetEntryId: string
      readonly audienceKind: "directed" | "household"
      readonly addresseeIds: readonly string[]
      readonly expectedCode: QuestionDenyCode
    }[]
    readonly digest: {
      readonly windowStart: number
      readonly perViewer: readonly {
        readonly caregiverId: string
        readonly hasQuestions: boolean
        readonly unresolved: readonly string[]
        readonly resolvedInWindow: readonly string[]
      }[]
      readonly explicitNegativePreserved?: { readonly questionId: string; readonly latestAnswerText: string }
      readonly excludedQuestionAbsentFromDigest?: string
    }
  }
}

const fixtureDir = new URL("../../../evaluation/fixtures/agent-experience/caregiver-questions/", import.meta.url)
const loadFixture = (file: string): QuestionFixture =>
  JSON.parse(readFileSync(new URL(file, fixtureDir), "utf8")) as QuestionFixture

const decodeQuestion = (raw: unknown): CareQuestionDocumentType => Schema.decodeUnknownSync(CareQuestionDocument)(raw)
const decodeActivity = (raw: unknown): CareQuestionActivityDocumentType =>
  Schema.decodeUnknownSync(CareQuestionActivityDocument)(raw)

const HOUSEHOLD_A = "fxhousehold0000000000000"
const HOUSEHOLD_B = "fxhouseholdb000000000000"

describe("Caregiver-question fixtures decode through the canonical schemas", () => {
  const fixtures = [loadFixture("household-a.json"), loadFixture("household-b.json")]

  for (const fixture of fixtures) {
    test(`${fixture.id}: every question and activity decodes (wire format, epoch millis)`, () => {
      for (const raw of fixture.questions) {
        const decoded = decodeQuestion(raw)
        expect(typeof decoded.createdAt).toBe("number")
      }
      for (const raw of fixture.activities) {
        const decoded = decodeActivity(raw)
        expect(typeof decoded.at).toBe("number")
      }
    })

    test(`${fixture.id}: event-target questions always carry entryId AND eventId`, () => {
      for (const raw of fixture.questions) {
        const question = decodeQuestion(raw)
        if (question.targetKind === "event") {
          expect(question.eventId).toBeDefined()
          expect(question.eventId?.length ?? 0).toBeGreaterThan(0)
        } else {
          expect(question.eventId).toBeUndefined()
        }
      }
    })
  }

  test("representative question round-trips: decode -> encode -> re-decode is identity", () => {
    const fixture = fixtures[0]
    if (!fixture) throw new Error("household-a fixture missing")
    const question = decodeQuestion(fixture.questions[0])
    const encoded = Schema.encodeSync(CareQuestionDocument)(question)
    const redecoded = decodeQuestion(encoded)
    expect(redecoded).toEqual(question)
  })
})

describe("Lifecycle derivation (deriveQuestionState)", () => {
  const fixture = loadFixture("household-a.json")
  const questions = fixture.questions.map(decodeQuestion)
  const activities = fixture.activities.map(decodeActivity)
  const activitiesFor = (questionId: string) => activities.filter((a) => a.questionId === questionId)
  const stateOf = (questionId: string) => {
    const question = questions.find((q) => q._id === questionId)
    if (!question) throw new Error(`unknown question ${questionId}`)
    return deriveQuestionState(question, activitiesFor(questionId))
  }

  for (const expected of fixture.expected.derived) {
    test(`${expected.questionId}: status=${expected.status} reopened=${expected.reopenedCount} answers=${expected.answerCount}`, () => {
      const state = stateOf(expected.questionId)
      expect(state.status).toBe(expected.status)
      expect(state.reopenedCount).toBe(expected.reopenedCount)
      expect(state.answers).toHaveLength(expected.answerCount)
      expect(state.handoffIncluded).toBe(expected.handoffIncluded)
    })
  }

  test("reopening clears the resolution and returns the question to open (lineage keeps both)", () => {
    const state = stateOf("fxqreopen000000000000000")
    expect(state.status).toBe("open")
    expect(state.reopenedCount).toBe(1)
    expect(state.resolution).toBeUndefined()
    expect(state.answers).toHaveLength(1)
  })

  test("resolution is a receipt: attributed actor, timestamp, and the answer it settles", () => {
    const state = stateOf("fxqpottyresolved00000000")
    expect(state.status).toBe("resolved")
    expect(state.resolution?.resolvedById).toBe("caregiver-mom")
    expect(state.resolution?.settlesActivityId).toBe("fxact00000000000000000002")
  })

  test("unsorted activity input derives identically (sort is defensive)", () => {
    const question = questions.find((q) => q._id === "fxqpottyresolved00000000")
    if (!question) throw new Error("missing fixture question")
    const shuffled = [activities[2], activities[0], activities[1]].filter(
      (a): a is CareQuestionActivityDocumentType => a !== undefined && a.questionId === question._id,
    )
    const state = deriveQuestionState(question, shuffled)
    expect(state.status).toBe("resolved")
    expect(state.answers[0]?.text).toBe("None today.")
  })
})

describe("Fail-closed question policy (fixture visibility matrix)", () => {
  const fixtures = [loadFixture("household-a.json"), loadFixture("household-b.json")]

  const targetOf = (fixture: QuestionFixture, entryId: string): QuestionTargetFacts => {
    const entry = fixture.entries.find((e) => e._id === entryId)
    if (!entry) throw new Error(`unknown entry ${entryId}`)
    return {
      householdId: fixture.household.householdId,
      childId: fixture.childId,
      authorId: entry.authorId,
      visibility: entry.visibility === "draft" ? "draft" : "published",
    }
  }

  const principalFor = (caregiverId: string): QuestionPrincipal => ({
    kind: "caregiver",
    caregiverId,
    householdIds: fixtures
      .filter((f) => f.household.memberIds.includes(caregiverId))
      .map((f) => f.household.householdId),
  })

  for (const fixture of fixtures) {
    const questions = fixture.questions.map(decodeQuestion)

    for (const matrix of fixture.expected.visibility) {
      test(`${fixture.id}/${matrix.questionId}: visibility matrix`, () => {
        const question = questions.find((q) => q._id === matrix.questionId)
        if (!question) throw new Error(`unknown question ${matrix.questionId}`)
        const target = targetOf(fixture, question.entryId)

        for (const caregiverId of matrix.allow) {
          const decision = canViewQuestion(principalFor(caregiverId), question, target)
          expect(decision.outcome).toBe("ALLOW")
        }
        for (const { caregiverId, code } of matrix.deny) {
          const decision = canViewQuestion(principalFor(caregiverId), question, target)
          expect(decision.outcome).toBe("DENY")
          if (decision.outcome === "DENY") expect(decision.code).toBe(code)
        }
      })
    }

    for (const ask of fixture.expected.askDenies) {
      test(`${fixture.id}: ask as ${ask.asCaregiverId} denies with ${ask.expectedCode}`, () => {
        const target = targetOf(fixture, ask.targetEntryId)
        const decision = canAskQuestion(
          principalFor(ask.asCaregiverId),
          {
            asAskedById: ask.asCaregiverId,
            householdId: fixture.household.householdId,
            childId: fixture.childId,
            targetKind: "entry",
            audienceKind: ask.audienceKind,
            addresseeIds: ask.addresseeIds,
          },
          target,
          fixture.household.memberIds,
        )
        expect(decision.outcome).toBe("DENY")
        if (decision.outcome === "DENY") expect(decision.code).toBe(ask.expectedCode)
      })
    }
  }

  test("anonymous principal is denied at the authentication edge, before any addressing logic", () => {
    const fixture = fixtures[0]
    if (!fixture) throw new Error("household-a fixture missing")
    const question = decodeQuestion(fixture.questions[0])
    const target = targetOf(fixture, question.entryId)
    const decision = canViewQuestion({ kind: "anonymous" }, question, target)
    expect(decision.outcome === "DENY" && decision.code).toBe("DENY_Q_ANONYMOUS")
  })

  test("an ask attributed to someone else is an attribution mismatch", () => {
    const fixture = fixtures[0]
    if (!fixture) throw new Error("household-a fixture missing")
    const decision = canAskQuestion(
      principalFor("caregiver-mom"),
      {
        asAskedById: "caregiver-dad",
        householdId: fixture.household.householdId,
        childId: fixture.childId,
        targetKind: "entry",
        audienceKind: "household",
        addresseeIds: [],
      },
      targetOf(fixture, "fxentrymeal0000000000000"),
      fixture.household.memberIds,
    )
    expect(decision.outcome === "DENY" && decision.code).toBe("DENY_Q_ATTRIBUTION_MISMATCH")
  })

  test("event-target ask without eventId and cross-household ask are invalid targets", () => {
    const fixture = fixtures[0]
    if (!fixture) throw new Error("household-a fixture missing")
    const mom = principalFor("caregiver-mom")
    const noEvent = canAskQuestion(
      mom,
      {
        asAskedById: "caregiver-mom",
        householdId: fixture.household.householdId,
        childId: fixture.childId,
        targetKind: "event",
        audienceKind: "household",
        addresseeIds: [],
      },
      targetOf(fixture, "fxentrysleep000000000000"),
      fixture.household.memberIds,
    )
    expect(noEvent.outcome === "DENY" && noEvent.code).toBe("DENY_Q_INVALID_TARGET")

    const wrongHousehold = canAskQuestion(
      mom,
      {
        asAskedById: "caregiver-mom",
        householdId: HOUSEHOLD_B,
        childId: fixture.childId,
        targetKind: "entry",
        audienceKind: "household",
        addresseeIds: [],
      },
      targetOf(fixture, "fxentrymeal0000000000000"),
      fixture.household.memberIds,
    )
    expect(wrongHousehold.outcome === "DENY" && wrongHousehold.code).toBe("DENY_Q_INVALID_TARGET")
  })

  test("directed ask with empty addressee list is an invalid audience", () => {
    const fixture = fixtures[0]
    if (!fixture) throw new Error("household-a fixture missing")
    const decision = canAskQuestion(
      principalFor("caregiver-mom"),
      {
        asAskedById: "caregiver-mom",
        householdId: fixture.household.householdId,
        childId: fixture.childId,
        targetKind: "entry",
        audienceKind: "directed",
        addresseeIds: [],
      },
      targetOf(fixture, "fxentrymeal0000000000000"),
      fixture.household.memberIds,
    )
    expect(decision.outcome === "DENY" && decision.code).toBe("DENY_Q_INVALID_AUDIENCE")
  })

  test("lifecycle edges: no answers under resolution, no reopen unless resolved, no asker-self-answer on directed questions", () => {
    const fixture = fixtures[0]
    if (!fixture) throw new Error("household-a fixture missing")
    const questions = fixture.questions.map(decodeQuestion)
    const activities = fixture.activities.map(decodeActivity)
    const target = targetOf(fixture, "fxentrymeal0000000000000")

    const byId = (id: string) => {
      const q = questions.find((x) => x._id === id)
      if (!q) throw new Error(`unknown question ${id}`)
      return q
    }
    const statusOf = (id: string) =>
      deriveQuestionState(byId(id), activities.filter((a) => a.questionId === id)).status

    // Answering a resolved question would launder the resolution.
    const answerResolved = canAnswerQuestion(
      principalFor("caregiver-dad"),
      "caregiver-dad",
      byId("fxqpottyresolved00000000"),
      target,
      statusOf("fxqpottyresolved00000000"),
    )
    expect(answerResolved.outcome === "DENY" && answerResolved.code).toBe("DENY_Q_ALREADY_RESOLVED")

    // The asker of a DIRECTED question may not answer it themselves — they resolve.
    const selfAnswer = canAnswerQuestion(
      principalFor("caregiver-mom"),
      "caregiver-mom",
      byId("fxqnapcheck0000000000000"),
      targetOf(fixture, "fxentrysleep000000000000"),
      statusOf("fxqnapcheck0000000000000"),
    )
    expect(selfAnswer.outcome === "DENY" && selfAnswer.code).toBe("DENY_Q_NOT_ANSWERABLE")

    // Reopening an open question is a no-op attempt; reopening a resolved one is allowed.
    const reopenOpen = canReopenQuestion(
      principalFor("caregiver-mom"),
      "caregiver-mom",
      byId("fxqopenwater000000000000"),
      target,
      statusOf("fxqopenwater000000000000"),
    )
    expect(reopenOpen.outcome === "DENY" && reopenOpen.code).toBe("DENY_Q_NOT_RESOLVED")

    const reopenResolved = canReopenQuestion(
      principalFor("caregiver-mom"),
      "caregiver-mom",
      byId("fxqexcluded0000000000000"),
      target,
      statusOf("fxqexcluded0000000000000"),
    )
    expect(reopenResolved.outcome).toBe("ALLOW")

    // Resolving an already-resolved question denies.
    const reResolve = canResolveQuestion(
      principalFor("caregiver-mom"),
      "caregiver-mom",
      byId("fxqpottyresolved00000000"),
      target,
      statusOf("fxqpottyresolved00000000"),
    )
    expect(reResolve.outcome === "DENY" && reResolve.code).toBe("DENY_Q_ALREADY_RESOLVED")
  })

  test("visibleQuestions projection: invisible questions are excluded, not errors", () => {
    const fixture = fixtures[0]
    if (!fixture) throw new Error("household-a fixture missing")
    const questions = fixture.questions.map(decodeQuestion)
    const pairs = questions.map((question) => ({
      question,
      target: targetOf(fixture, question.entryId),
    }))
    expect(visibleQuestions(principalFor("caregiver-grandma"), pairs)).toHaveLength(4)
    expect(visibleQuestions(principalFor("caregiver-mom"), pairs)).toHaveLength(6)
  })
})

describe("Handoff digest (missing-vs-zero discipline)", () => {
  const fixtures = [loadFixture("household-a.json"), loadFixture("household-b.json")]

  const digestFor = (fixture: QuestionFixture, caregiverId: string) => {
    const principal: QuestionPrincipal = {
      kind: "caregiver",
      caregiverId,
      householdIds: fixtures
        .filter((f) => f.household.memberIds.includes(caregiverId))
        .map((f) => f.household.householdId),
    }
    const questions = fixture.questions.map(decodeQuestion)
    const activities = fixture.activities.map(decodeActivity)
    const targetFor = (entryId: string) => {
      const entry = fixture.entries.find((e) => e._id === entryId)
      if (!entry) throw new Error(`unknown entry ${entryId}`)
      return {
        householdId: fixture.household.householdId,
        childId: fixture.childId,
        authorId: entry.authorId,
        visibility: entry.visibility === "draft" ? ("draft" as const) : ("published" as const),
      }
    }
    const inputs = questions
      .filter((q) => canViewQuestion(principal, q, targetFor(q.entryId)).outcome === "ALLOW")
      .map((q) => ({ question: q, activities: activities.filter((a) => a.questionId === q._id) }))
    return buildHandoffDigest(inputs, { windowStart: fixture.expected.digest.windowStart })
  }

  for (const fixture of fixtures) {
    for (const expected of fixture.expected.digest.perViewer) {
      test(`${fixture.id}: digest for ${expected.caregiverId}`, () => {
        const digest = digestFor(fixture, expected.caregiverId)
        expect(digest.hasQuestions).toBe(expected.hasQuestions)
        expect(digest.unresolved.map((l) => l.question._id)).toEqual([...expected.unresolved])
        expect(digest.resolvedInWindow.map((l) => l.question._id)).toEqual([...expected.resolvedInWindow])
      })
    }
  }

  test("an explicit negative answer survives into the digest verbatim — it is a fact, not a gap", () => {
    const fixture = fixtures[0]
    if (!fixture) throw new Error("household-a fixture missing")
    const digest = digestFor(fixture, "caregiver-mom")
    const resolved = digest.resolvedInWindow[0]
    expect(resolved?.latestAnswerText).toBe("None today.")
    expect(resolved?.latestAnswerById).toBe("caregiver-dad")
    expect(resolved?.resolvedById).toBe("caregiver-mom")
  })

  test("a question excluded from handoff is absent from the digest body but still counted as asked", () => {
    const fixture = fixtures[0]
    if (!fixture) throw new Error("household-a fixture missing")
    const digest = digestFor(fixture, "caregiver-mom")
    const excluded = fixture.expected.digest.excludedQuestionAbsentFromDigest
    if (!excluded) throw new Error("fixture missing excluded id")
    expect(digest.hasQuestions).toBe(true)
    expect(digest.unresolved.map((l) => l.question._id)).not.toContain(excluded)
    expect(digest.resolvedInWindow.map((l) => l.question._id)).not.toContain(excluded)
  })

  test("empty scope: hasQuestions=false — nothing was asked, which is not 'all clear'", () => {
    const digest = buildHandoffDigest([], { windowStart: 0 })
    expect(digest.hasQuestions).toBe(false)
    expect(digest.unresolved).toHaveLength(0)
    expect(digest.resolvedInWindow).toHaveLength(0)
  })

  test("digest output decodes through its own contract schema", () => {
    const fixture = fixtures[0]
    if (!fixture) throw new Error("household-a fixture missing")
    const digest = digestFor(fixture, "caregiver-mom")
    expect(() => Schema.decodeUnknownSync(HandoffDigestOutput)(digest)).not.toThrow()
  })
})

describe("Effect -> Convex adapter coverage for the proposed tables", () => {
  test("careQuestions fields derive with id-annotated references and optional marker", () => {
    const fields = convexFields(CareQuestionSchema)

    const householdId = fields.householdId as { kind: string; tableName: string }
    expect(householdId).toMatchObject({ kind: "id", tableName: "households" })

    const entryId = fields.entryId as { kind: string; tableName: string }
    expect(entryId).toMatchObject({ kind: "id", tableName: "entries" })

    const eventId = fields.eventId as { kind: string; tableName: string; isOptional: string }
    expect(eventId.kind).toBe("id")
    expect(eventId.tableName).toBe("events")
    expect(eventId.isOptional).toBe("optional")

    const targetKind = fields.targetKind as { kind: string; members: unknown[] }
    expect(targetKind.kind).toBe("union")
    expect(targetKind.members).toHaveLength(2)

    const audienceKind = fields.audienceKind as { kind: string; members: unknown[] }
    expect(audienceKind.kind).toBe("union")
    expect(audienceKind.members).toHaveLength(2)

    const addresseeIds = fields.addresseeIds as { kind: string }
    expect(addresseeIds.kind).toBe("array")

    const handoffIncluded = fields.handoffIncluded as { kind: string; isOptional: string }
    expect(handoffIncluded.kind).toBe("boolean")
    expect(handoffIncluded.isOptional).toBe("required")
  })

  test("careQuestionActivities fields derive with per-kind optional payloads", () => {
    const fields = convexFields(CareQuestionActivitySchema)

    const questionId = fields.questionId as { kind: string; tableName: string }
    expect(questionId).toMatchObject({ kind: "id", tableName: "careQuestions" })

    const kind = fields.kind as { kind: string; members: unknown[] }
    expect(kind.kind).toBe("union")
    expect(kind.members).toHaveLength(4)

    for (const optionalField of ["answerText", "sourceKind", "sourceId", "reason", "settlesActivityId", "handoffIncluded"]) {
      const field = fields[optionalField] as { isOptional: string } | undefined
      expect(field?.isOptional).toBe("optional")
    }

    const at = fields.at as { kind: string; isOptional: string }
    expect(at.kind).toBe("float64")
    expect(at.isOptional).toBe("required")
  })

  test("operation-contract args derive (AskQuestionInput)", () => {
    const fields = convexFields(AskQuestionInput)
    const entryId = fields.entryId as { kind: string; tableName: string }
    expect(entryId).toMatchObject({ kind: "id", tableName: "entries" })
    const eventId = fields.eventId as { isOptional: string }
    expect(eventId.isOptional).toBe("optional")
    const handoffIncluded = fields.handoffIncluded as { isOptional: string }
    expect(handoffIncluded.isOptional).toBe("optional")
  })
})
