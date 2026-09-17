// One-shot generator for packages/handoff/fixtures/*.json — synthetic data only.
// Epochs verified against America/New_York rendering (see task notes):
//   1789387200000 = 2026-09-14 08:00 EDT · 1789650000000 = 2026-09-17 09:00 EDT
//   1789603200000 = 2026-09-16 20:00 EDT · 1789531200000 = 2026-09-16 00:00 EDT
//   1789617540000 = 2026-09-16 23:59 EDT · 1789444800000 = 2026-09-15 00:00 EDT
//   1789516800000 = 2026-09-15 20:00 EDT · 1788840000000 = 2026-09-08 00:00 EDT
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const TZ = "America/New_York"
const LAST_SEEN = 1789387200000 // Sep 14 08:00 EDT
const GEN_SEP17_09 = 1789650000000 // Sep 17 09:00 EDT
const GEN_SEP16_20 = 1789603200000 // Sep 16 20:00 EDT
const SEP16_MIDNIGHT = 1789531200000
const SEP16_LATE = 1789617540000
const SEP15_MIDNIGHT = 1789444800000
const SEP15_20 = 1789516800000
const SEP8_MIDNIGHT = 1788840000000

const e1 = {
  entryId: "syn-entry-001",
  captureId: "syn-capture-001",
  authorId: "caregiver-mom",
  createdAt: 1789387500000, // Sep 14 08:05 EDT
  visibility: "published",
  extractionStatus: "structured",
  rawTranscript: "Ava had 8 ounces of milk with breakfast at 8:00 AM. Then she went poop on the potty at 9:30 AM.",
  events: [
    { category: "meal", timestamp: 1789387200000, payload: { ounces: 8 }, confidence: 0.95 },
    { category: "potty", timestamp: 1789392600000, confidence: 0.9 },
  ],
}
const e2 = {
  entryId: "syn-entry-002",
  captureId: "syn-capture-002",
  authorId: "caregiver-dad",
  createdAt: 1789491900000, // Sep 15 13:05 EDT
  visibility: "published",
  extractionStatus: "structured",
  rawTranscript: "Ava napped for 95 minutes starting at 1:02 PM.",
  events: [{ category: "sleep", timestamp: 1789491720000, payload: { minutes: 95 }, confidence: 0.9 }],
}
const e3 = {
  entryId: "syn-entry-003",
  captureId: "syn-capture-003",
  authorId: "caregiver-dad",
  createdAt: 1789511400000, // Sep 15 18:30 EDT
  visibility: "published",
  extractionStatus: "structured",
  rawTranscript: "She was really happy and giggly after dinner.",
  events: [{ category: "mood", timestamp: 1789511400000, confidence: 0.85 }],
}
const e4 = {
  entryId: "syn-entry-004",
  captureId: "syn-capture-004",
  authorId: "caregiver-mom",
  createdAt: 1789560300000, // Sep 16 08:05 EDT
  visibility: "published",
  extractionStatus: "structured",
  rawTranscript: "Ava ate half a banana and some oatmeal for breakfast at 8:00 AM.",
  events: [{ category: "meal", timestamp: 1789560000000, confidence: 0.9 }],
}
const e5 = {
  entryId: "syn-entry-005",
  captureId: "syn-capture-005",
  authorId: "caregiver-mom",
  createdAt: 1789578600000, // Sep 16 13:10 EDT
  visibility: "published",
  extractionStatus: "structured",
  rawTranscript: "Ava seemed fussy before her nap.",
  events: [{ category: "mood", timestamp: 1789576200000, confidence: 0.42 }],
}
const e6 = {
  entryId: "syn-entry-006",
  captureId: "syn-capture-006",
  authorId: "caregiver-dad",
  createdAt: 1789595100000, // Sep 16 17:45 EDT
  visibility: "published",
  extractionStatus: "failed",
  rawTranscript: "Ava's grandma picked her up and they went to the park.",
  events: [],
}
const draft1 = {
  entryId: "syn-entry-d01",
  captureId: "syn-capture-d01",
  authorId: "caregiver-mom",
  createdAt: 1789567200000, // Sep 16 10:00 EDT
  visibility: "draft",
  extractionStatus: "structured",
  rawTranscript: "Draft capture: Ava napped for 60 minutes this morning. xyzzy unpublished marker.",
  events: [{ category: "sleep", timestamp: 1789567200000, payload: { minutes: 60 }, confidence: 0.9 }],
}
const pending1 = {
  entryId: "syn-entry-p01",
  captureId: "syn-capture-p01",
  authorId: "caregiver-dad",
  createdAt: 1789574400000, // Sep 16 12:00 EDT
  visibility: "published",
  extractionStatus: "pending",
  rawTranscript: "Ava is having lunch with her cousins.",
  events: [],
}

const input = (over) => ({
  childId: "syn-child-ava",
  childName: "Ava",
  recipientName: "Nana Ruth",
  lastSeenAt: LAST_SEEN,
  generatedAt: GEN_SEP17_09,
  timezone: TZ,
  entries: [],
  routineNotes: [],
  ...over,
})

const fixtures = [
  {
    id: "rich-window",
    description:
      "Three-day window with published structured captures: per-event claims with source links, a low-confidence event withheld to questions, a failed extraction surfaced, and a disclosed partial-day gap for the current morning.",
    input: input({ entries: [e1, e2, e3, e4, e5, e6] }),
    expect: {
      claimCountByCategory: { meal: 2, potty: 1, sleep: 1, mood: 1 },
      statementContainsByCategory: { meal: ["8 oz"], sleep: ["95 min"] },
      gapDates: ["2026-09-17"],
      coverageZero: ["milestone", "school"],
      questionTags: ["extraction-failed", "low-confidence-event"],
      excludedFromDigest: [],
      digestContains: ["No entries were logged on 2026-09-17"],
      suggestedFollowUpsMin: 1,
      followUps: [
        { question: "How did naps go?", outcome: "answered", answerContains: ["95 min"], mustCite: true },
        { question: "Is her eating normal for her age?", outcome: "refused-medical", answerContains: ["can't draw conclusions"] },
        { question: "What did she do last month?", outcome: "refused-out-of-window" },
        { question: "Any school moments?", outcome: "not-logged", answerContains: ["Nothing was logged"] },
      ],
    },
  },
  {
    id: "empty-window",
    description:
      "Window with zero captures of any kind: no claims, every category discloses zero coverage, and each day gets care-neutral gap disclosure — absence of logs never reads as absence of care.",
    input: input({ entries: [] }),
    expect: {
      claimCountByCategory: {},
      gapDates: ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"],
      coverageZero: ["potty", "meal", "sleep", "mood", "milestone", "school"],
      questionTags: [],
      digestContains: ["No entries were logged on 2026-09-15"],
      suggestedFollowUpsMin: 1,
      followUps: [{ question: "What did Ava eat?", outcome: "not-logged", answerContains: ["Nothing was logged"] }],
    },
  },
  {
    id: "middle-day-gap",
    description:
      "Captures on the first and last days only: exactly the untouched middle day is disclosed as a gap, and a month-spanning follow-up is refused as out of window.",
    input: input({ generatedAt: GEN_SEP16_20, entries: [e1, e4] }),
    expect: {
      claimCountByCategory: { meal: 2, potty: 1 },
      statementContainsByCategory: { meal: ["8 oz"] },
      gapDates: ["2026-09-15"],
      coverageZero: ["sleep", "mood", "milestone", "school"],
      questionTags: [],
      followUps: [{ question: "How was her month?", outcome: "refused-out-of-window" }],
    },
  },
  {
    id: "draft-and-pending",
    description:
      "Draft and pending captures in the window: neither contributes claims or quoted content; both surface as unresolved questions, and the day is not disclosed as a gap because captures exist.",
    input: input({ lastSeenAt: SEP16_MIDNIGHT, generatedAt: SEP16_LATE, entries: [draft1, pending1] }),
    expect: {
      claimCountByCategory: {},
      gapDates: [],
      coverageZero: ["potty", "meal", "sleep", "mood", "milestone", "school"],
      questionTags: ["draft-capture", "extraction-pending"],
      excludedFromDigest: ["xyzzy", "Draft capture", "cousins"],
      digestContains: ["still in draft review", "still being processed"],
      suggestedFollowUpsMin: 1,
      followUps: [{ question: "How long was her nap?", outcome: "not-logged", answerContains: ["Nothing was logged"] }],
    },
  },
  {
    id: "window-edge-semantics",
    description:
      "Nine-day window: week-spanning questions are answerable inside it while month-spanning ones are refused; every uncovered day is disclosed.",
    input: input({ lastSeenAt: SEP8_MIDNIGHT, generatedAt: GEN_SEP16_20, entries: [e1, e2] }),
    expect: {
      claimCountByCategory: { meal: 1, potty: 1, sleep: 1 },
      gapDates: ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-16"],
      coverageZero: ["mood", "milestone", "school"],
      questionTags: [],
      digestContains: ["No entries were logged on 2026-09-10"],
      followUps: [
        { question: "How was her week?", outcome: "not-logged", answerContains: ["Nothing matching that was logged"] },
        { question: "How was her month?", outcome: "refused-out-of-window" },
      ],
    },
  },
  {
    id: "routine-context",
    description:
      "Family-profile routine context appears verbatim, attributed to the child profile, next to captured events; a nap follow-up is answered with a citation.",
    input: input({
      lastSeenAt: SEP15_MIDNIGHT,
      generatedAt: SEP15_20,
      entries: [e2],
      routineNotes: [{ childId: "syn-child-ava", note: "Ava naps around 1:00 PM and eats lunch at noon." }],
    }),
    expect: {
      claimCountByCategory: { sleep: 1 },
      digestContains: ["Family note: Ava naps around 1:00 PM and eats lunch at noon."],
      coverageZero: ["potty", "meal", "mood", "milestone", "school"],
      questionTags: [],
      suggestedFollowUpsMin: 1,
      followUps: [{ question: "How did her nap go?", outcome: "answered", answerContains: ["95 min"], mustCite: true }],
    },
  },
]

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "handoff", "fixtures")
mkdirSync(outDir, { recursive: true })
const prefix = ["01-rich-window", "02-empty-window", "03-middle-day-gap", "04-draft-and-pending", "05-window-edge-semantics", "06-routine-context"]
fixtures.forEach((fixture, i) => {
  writeFileSync(join(outDir, `${prefix[i]}.json`), `${JSON.stringify(fixture, null, 2)}\n`)
  console.log(`wrote ${prefix[i]}.json`)
})
