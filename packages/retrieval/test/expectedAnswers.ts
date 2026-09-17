import type { HistoryQueryAnswer as Answer, HistoryQueryInput as Input } from "../src/queryContracts.js"

/**
 * Independent expected-answer fixtures over the deterministic 30-day corpus.
 *
 * Every expectation here is hand-derived from the corpus timeline documented
 * in `src/corpus.ts` — NOT produced by running the implementation. When a
 * test fails here, the diff is either an implementation bug or a fixture
 * arithmetic bug; both matter. The fixture numbers:
 *
 * - askedAt = Sep 12 2026 7:30 PM EDT (1788339000000): evening catch-up;
 *   late enough that the day's 1:00 PM nap is in the past.
 * - "last week" asked then = local Mon Aug 31 – Sun Sep 6 = corpus days
 *   17..23 — all covered days (the Aug 22–23 gap is outside this window).
 * - Milo's breakfasts last week: 7 (one per day, one event each).
 * - Ada's sleep universe: 30 days − day 1 (no nap) − days 8–9 (gap) = 27
 *   nap events, with day 5's nap superseded and its caregiver-corrected
 *   replacement (75 min, confidence 1) included.
 * - Naps between Aug 21–25 = days 7, 10, 11 → 35, 45, 40 min (days 8–9 gap).
 * - Milo has NO naps in the corpus, so a Milo-scoped nap question is an
 *   honest not-found — it must never be answered from Ada's records.
 */

/** Corpus timeline helper — mirrors the documented constants in src/corpus.ts. */
const dayUtc = (dayIndex: number, hourUtc = 4): number => Date.UTC(2026, 7, 14 + dayIndex, hourUtc)

export const ASKED_AT = Date.UTC(2026, 8, 12, 23, 30) // Sep 12 2026 7:30 PM EDT
const NY = "America/New_York"
const HOUSEHOLD = "household_demo"

/** Contract-shaped input: childId is set only when a fixture pins the subject. */
const input = (overrides: { question: string; askedAt?: number; childId?: string }): Input => ({
  householdId: HOUSEHOLD,
  askedBy: "mom",
  askedAt: overrides.askedAt ?? ASKED_AT,
  timezone: NY,
  question: overrides.question,
  ...(overrides.childId !== undefined ? { childId: overrides.childId } : {}),
})

export interface ExpectedFixture {
  readonly id: string
  readonly input: Input
  /** Hand-derived expected answer; tests deep-compare against `answerQuery`. */
  readonly expected: Answer
}

export const fixtures: readonly ExpectedFixture[] = [
  {
    id: "hq-01-last-nap",
    input: input({ question: "When did Ada last nap?" }),
    expected: {
      _tag: "found",
      statement: "Ada's last recorded nap was on September 12, 2026 at 1:00 PM — napped 45 minutes.",
      citations: [
        {
          entryId: "en-nap-d29",
          eventIds: ["ev-ada-nap-d29"],
          childId: "child_ada",
          authorId: "mom",
          excerpt: "Ada napped 45 minutes after lunch.",
          occurredAt: dayUtc(29, 17),
        },
      ],
      coverage: { confirmed: 1, inferred: 26, total: 27 },
      notices: [],
    },
  },
  {
    id: "hq-02-count-last-week",
    input: input({ question: "How many breakfasts did Milo have last week?" }),
    expected: {
      _tag: "found",
      statement: "Milo had 7 breakfasts between Aug 31 and Sep 6 — 0 of 7 caregiver-confirmed.",
      citations: Array.from({ length: 7 }, (_, i) => {
        const day = 17 + i
        const dd = String(day).padStart(2, "0")
        const author = day % 2 === 0 ? "mom" : "dad"
        return {
          entryId: `en-bf-d${dd}-child_milo`,
          eventIds: [`ev-child_milo-breakfast-d${dd}`],
          childId: "child_milo",
          authorId: author,
          excerpt:
            author === "mom"
              ? "Milo ate one serving of oatmeal for breakfast this morning."
              : "Milo had one serving of oatmeal at breakfast.",
          occurredAt: dayUtc(day, 12),
        }
      }),
      coverage: { confirmed: 0, inferred: 7, total: 7 },
      notices: [],
    },
  },
  {
    id: "hq-03-range-with-gap",
    input: input({ question: "How many naps did Ada have between August 21 and August 25?" }),
    expected: {
      _tag: "found",
      statement: "Ada had 3 naps between Aug 21 and Aug 25 — 0 of 3 caregiver-confirmed.",
      citations: [
        {
          entryId: "en-nap-d07",
          eventIds: ["ev-ada-nap-d07"],
          childId: "child_ada",
          authorId: "mom",
          excerpt: "Ada napped 35 minutes after lunch.",
          occurredAt: dayUtc(7, 17),
        },
        {
          entryId: "en-nap-d10",
          eventIds: ["ev-ada-nap-d10"],
          childId: "child_ada",
          authorId: "mom",
          excerpt: "Ada napped 45 minutes after lunch.",
          occurredAt: dayUtc(10, 17),
        },
        {
          entryId: "en-nap-d11",
          eventIds: ["ev-ada-nap-d11"],
          childId: "child_ada",
          authorId: "mom",
          excerpt: "Ada napped 40 minutes after lunch.",
          occurredAt: dayUtc(11, 17),
        },
      ],
      coverage: { confirmed: 0, inferred: 3, total: 3 },
      notices: [{ _tag: "gap", from: dayUtc(8), to: dayUtc(10), days: 2 }],
    },
  },
  {
    id: "hq-04-author-conflict",
    input: input({ question: "How much pasta did Ada eat on August 17?" }),
    expected: {
      _tag: "found",
      statement: "Conflicting records for Ada's meal on August 17, 2026: dad logged 1 serving, mom logged 2 servings.",
      citations: [
        {
          entryId: "en-dinner-d03-dad",
          eventIds: ["ev-ada-dinner-d03-dad"],
          childId: "child_ada",
          authorId: "dad",
          excerpt: "Dinner was a struggle tonight — Ada only ate one serving of pasta.",
          occurredAt: dayUtc(3, 22),
        },
        {
          entryId: "en-dinner-d03-mom",
          eventIds: ["ev-ada-dinner-d03-mom"],
          childId: "child_ada",
          authorId: "mom",
          excerpt: "Ada ate two servings of pasta at dinner tonight.",
          occurredAt: dayUtc(3, 22),
        },
      ],
      coverage: { confirmed: 0, inferred: 2, total: 2 },
      notices: [
        {
          _tag: "conflict",
          category: "meal",
          localDay: { from: dayUtc(3), to: dayUtc(4) },
          claims: [
            { authorId: "dad", eventIds: ["ev-ada-dinner-d03-dad"], payloadKey: "servings", payloadValue: 1 },
            { authorId: "mom", eventIds: ["ev-ada-dinner-d03-mom"], payloadKey: "servings", payloadValue: 2 },
          ],
        },
      ],
    },
  },
  {
    id: "hq-05-notfound-with-gap",
    input: input({ question: "How much pasta did Ada eat between August 21 and August 25?" }),
    expected: {
      _tag: "not-found",
      statement: "No matching meal records were found between Aug 21 and Aug 25.",
      window: { from: dayUtc(7), to: dayUtc(12) },
      notices: [{ _tag: "gap", from: dayUtc(8), to: dayUtc(10), days: 2 }],
    },
  },
  {
    id: "hq-06-correction-applied",
    input: input({ question: "Did Ada nap on August 19?" }),
    expected: {
      _tag: "found",
      statement: "Yes — Ada: napped 75 minutes.",
      citations: [
        {
          entryId: "en-correction-d06",
          eventIds: ["ev-ada-nap-d05-corrected"],
          childId: "child_ada",
          authorId: "dad",
          excerpt: "Correction to yesterday's entry: Ada's nap was actually 75 minutes, not 45.",
          occurredAt: dayUtc(5, 17),
        },
      ],
      coverage: { confirmed: 1, inferred: 0, total: 1 },
      notices: [
        {
          _tag: "correction",
          supersedesEventId: "ev-ada-nap-d05",
          replacementEventId: "ev-ada-nap-d05-corrected",
          correctedBy: "dad",
          reason: "nap duration was misreported",
        },
      ],
    },
  },
  {
    id: "hq-07-day-summary",
    input: input({ question: "What happened with Ada on September 5?" }),
    expected: {
      _tag: "found",
      statement: "Ada had 3 recorded events on September 5, 2026: meal, school, sleep — 1 of 3 caregiver-confirmed.",
      citations: [
        {
          entryId: "en-bf-d22-child_ada",
          eventIds: ["ev-child_ada-breakfast-d22"],
          childId: "child_ada",
          authorId: "mom",
          excerpt: "Ada ate one serving of oatmeal for breakfast this morning.",
          occurredAt: dayUtc(22, 12),
        },
        {
          entryId: "en-school-d22-mom",
          eventIds: ["ev-ada-school-d22"],
          childId: "child_ada",
          authorId: "mom",
          excerpt: "Ada's first day of kindergarten today — she was so proud of her new backpack.",
          occurredAt: dayUtc(22, 13),
        },
        {
          entryId: "en-nap-d22",
          eventIds: ["ev-ada-nap-d22"],
          childId: "child_ada",
          authorId: "mom",
          excerpt: "Ada napped 40 minutes after lunch.",
          occurredAt: dayUtc(22, 17),
        },
      ],
      coverage: { confirmed: 1, inferred: 2, total: 3 },
      notices: [],
    },
  },
  {
    id: "hq-08-gap-day-notfound",
    input: input({ question: "Did Ada nap on August 22?" }),
    expected: {
      _tag: "not-found",
      statement: "No matching nap records were found on August 22, 2026.",
      window: { from: dayUtc(8), to: dayUtc(9) },
      notices: [{ _tag: "gap", from: dayUtc(8), to: dayUtc(9), days: 1 }],
    },
  },
  {
    id: "hq-09-ambiguous-unpinned",
    input: input({ question: "When was the last dinner?" }),
    expected: {
      _tag: "ambiguous",
      reason: "multiple-children-matched",
      candidates: [
        {
          childId: "child_ada",
          entryId: "en-dinner-d16-mom",
          eventIds: ["ev-ada-dinner-d16"],
          occurredAt: dayUtc(16, 22),
        },
        {
          childId: "child_milo",
          entryId: "en-dinner-d16-dad",
          eventIds: ["ev-milo-dinner-d16"],
          occurredAt: dayUtc(16, 22),
        },
      ],
    },
  },
  {
    id: "hq-10-count-empty-category",
    input: input({ question: "How many tantrums did Ada have last week?" }),
    expected: {
      _tag: "not-found",
      statement: "No matching mood records were found between Aug 31 and Sep 6.",
      window: { from: dayUtc(17), to: dayUtc(24) },
      notices: [],
    },
  },
  {
    id: "hq-11-clarify-activity",
    input: input({ question: "What's your favorite color?" }),
    expected: {
      _tag: "clarify",
      reason: "unknown-activity",
      message: "I can answer questions about recorded care events — try 'when did ada last nap?', 'how many breakfasts did milo have last week?', or 'what happened with ada on september 5?'.",
    },
  },
  {
    id: "hq-12-clarify-person",
    input: input({ question: "When did she last nap?" }),
    expected: {
      _tag: "clarify",
      reason: "unresolved-person",
      message: "I can't tell who \"she\" refers to — ask with a child's name (or ask from a view scoped to one child).",
    },
  },
  {
    id: "hq-13-clarify-window",
    input: input({ question: "How many tantrums did Ada have" }),
    expected: {
      _tag: "clarify",
      reason: "missing-time-window",
      message: "I can count over a time window — try '…last week', '…yesterday', or '…between September 1 and September 5'.",
    },
  },
  {
    id: "hq-14-scoped-empty-not-cross-child",
    input: input({ question: "When did she last nap?", childId: "child_milo" }),
    expected: {
      _tag: "not-found",
      statement: "No matching nap records were found in the recorded history.",
      notices: [],
    },
  },
]
