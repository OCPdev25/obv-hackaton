import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import {
  CareQuestionActivityDocument,
  CareQuestionDocument,
  buildHandoffDigest,
  type CareQuestionActivityDocument as CareQuestionActivityDocumentType,
  type CareQuestionDocument as CareQuestionDocumentType,
  type QuestionTargetFacts,
} from "@journal/domain"

import {
  digestFor,
  formatEpochTime,
  handoffSummary,
  statusLabel,
  viewerCanAnswer,
  viewerCanReopen,
  viewerCanResolve,
  visibleSeeds,
  type QuestionSeed,
} from "./logic"

/**
 * Viewer-logic tests for the questions prototype. Authorization itself is
 * pinned by the domain suite (packages/domain/test/careQuestion.test.ts);
 * these cover the rendering-relevant derivations on top of it.
 */

const decodeQuestion = (raw: Record<string, unknown>): CareQuestionDocumentType =>
  Schema.decodeUnknownSync(CareQuestionDocument)(raw) as CareQuestionDocumentType

const decodeActivity = (raw: Record<string, unknown>): CareQuestionActivityDocumentType =>
  Schema.decodeUnknownSync(CareQuestionActivityDocument)(raw) as CareQuestionActivityDocumentType

const question = (overrides: Record<string, unknown>): CareQuestionDocumentType =>
  decodeQuestion({
    _id: "q_demo",
    _creationTime: 1789651800000,
    householdId: "household_a",
    childId: "child_a",
    entryId: "entry_meal",
    targetKind: "entry",
    askedById: "caregiver-mom",
    audienceKind: "household",
    addresseeIds: [],
    handoffIncluded: true,
    question: "Did she drink water?",
    createdAt: 1789651800000,
    ...overrides,
  })

const answered = (questionId: string, actorId: string, text: string, at: number): CareQuestionActivityDocumentType =>
  decodeActivity({
    _id: `a_${text}`,
    _creationTime: at,
    householdId: "household_a",
    childId: "child_a",
    questionId,
    kind: "answered",
    at,
    answerText: text,
    actorId,
  })

const resolved = (questionId: string, actorId: string, at: number): CareQuestionActivityDocumentType =>
  decodeActivity({
    _id: `r_${questionId}`,
    _creationTime: at,
    householdId: "household_a",
    childId: "child_a",
    questionId,
    kind: "resolved",
    at,
    actorId,
  })

const TARGET: QuestionTargetFacts = {
  householdId: "household_a",
  childId: "child_a",
  authorId: "caregiver-dad",
  visibility: "published",
}

const MOM = { kind: "caregiver", caregiverId: "caregiver-mom", householdIds: ["household_a"] } as const
const DAD = { kind: "caregiver", caregiverId: "caregiver-dad", householdIds: ["household_a"] } as const

describe("statusLabel", () => {
  test("open with no answers says so plainly", () => {
    expect(statusLabel({ status: "open", answers: [], reopenedCount: 0, lastActivityAt: 0, handoffIncluded: true })).toBe("No answer yet")
  })

  test("answered states it is awaiting confirmation", () => {
    expect(statusLabel({ status: "answered", answers: [], reopenedCount: 0, lastActivityAt: 0, handoffIncluded: true })).toBe(
      "Answered — awaiting confirmation",
    )
  })

  test("reopen lineage survives answering and is shown with a count", () => {
    expect(statusLabel({ status: "answered", answers: [], reopenedCount: 2, lastActivityAt: 0, handoffIncluded: true })).toBe(
      "Answered, reopened ×2",
    )
    expect(statusLabel({ status: "open", answers: [], reopenedCount: 1, lastActivityAt: 0, handoffIncluded: true })).toBe(
      "reopened ×1 — no answer yet",
    )
  })

  test("resolved is terminal", () => {
    expect(statusLabel({ status: "resolved", answers: [], reopenedCount: 0, lastActivityAt: 0, handoffIncluded: true })).toBe("Resolved")
  })
})

describe("formatEpochTime", () => {
  test("renders deterministic UTC (prototype contract; real screens localize)", () => {
    expect(formatEpochTime(1789651800000)).toBe("2026-09-17 13:30 UTC")
  })
})

describe("handoffSummary", () => {
  test("empty scope says nothing was asked — never 'all clear'", () => {
    expect(handoffSummary(buildHandoffDigest([], {}))).toBe(
      "No questions were asked in this scope — not the same as all clear.",
    )
  })

  test("counts open, answered-awaiting-confirmation, and resolved lines", () => {
    const q = question({ _id: "q_open" })
    const seed: QuestionSeed = { question: q, activities: [answered("q_open", "caregiver-dad", "Two cups.", 1789655400000)], target: TARGET }
    const seedResolved: QuestionSeed = {
      question: question({ _id: "q_res", askedById: "caregiver-mom" }),
      activities: [
        answered("q_res", "caregiver-dad", "None today.", 1789659000000),
        resolved("q_res", "caregiver-mom", 1789662600000),
      ],
      target: TARGET,
    }
    const digest = digestFor([seed, seedResolved], {})
    expect(handoffSummary(digest)).toBe("2 questions asked: 1 answered, awaiting confirmation, 1 resolved today.")
  })
})

describe("visibleSeeds", () => {
  test("directed questions reach addressees and the asker, not other household members", () => {
    const directed: QuestionSeed = {
      question: question({
        _id: "q_dir",
        audienceKind: "directed",
        addresseeIds: ["caregiver-dad"],
      }),
      activities: [],
      target: TARGET,
    }
    const open: QuestionSeed = { question: question({ _id: "q_household" }), activities: [], target: TARGET }
    // Mom is the asker; dad is the addressee; both see the directed question.
    expect(visibleSeeds([directed, open], MOM).map((s) => s.question._id)).toEqual(["q_dir", "q_household"])
    expect(visibleSeeds([directed, open], DAD)).toHaveLength(2)
    // Grandma is neither asker nor addressee: only the household-audience question.
    const GRANDMA = { kind: "caregiver", caregiverId: "caregiver-grandma", householdIds: ["household_a"] } as const
    expect(visibleSeeds([directed, open], GRANDMA).map((s) => s.question._id)).toEqual(["q_household"])
  })
})

describe("action gating", () => {
  test("an addressee can answer a directed question; the asker cannot self-answer it", () => {
    const directed: QuestionSeed = {
      question: question({ _id: "q_dir", audienceKind: "directed", addresseeIds: ["caregiver-dad"] }),
      activities: [],
      target: TARGET,
    }
    expect(viewerCanAnswer(directed, DAD, "caregiver-dad")).toBe(true)
    expect(viewerCanAnswer(directed, MOM, "caregiver-mom")).toBe(false)
  })

  test("resolution is offered to the viewer once an answer exists; reopen only after resolution", () => {
    const seed: QuestionSeed = {
      question: question({ _id: "q_flow" }),
      activities: [answered("q_flow", "caregiver-dad", "Yes.", 1789655400000)],
      target: TARGET,
    }
    expect(viewerCanResolve(seed, MOM, "caregiver-mom")).toBe(true)
    expect(viewerCanReopen(seed, MOM, "caregiver-mom")).toBe(false)

    const resolvedSeed: QuestionSeed = {
      question: question({ _id: "q_flow2" }),
      activities: [
        answered("q_flow2", "caregiver-dad", "Yes.", 1789655400000),
        resolved("q_flow2", "caregiver-mom", 1789659000000),
      ],
      target: TARGET,
    }
    expect(viewerCanResolve(resolvedSeed, MOM, "caregiver-mom")).toBe(false)
    expect(viewerCanReopen(resolvedSeed, MOM, "caregiver-mom")).toBe(true)
  })
})
