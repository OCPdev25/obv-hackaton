import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import {
  DigestInput,
  FORBIDDEN_TOKENS,
  HandoffDigest,
  answerFollowUp,
  assertCareNeutral,
  composeSinceLastSeen,
  digestToText,
} from "../src/index.js"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const TZ = "America/New_York"

// Synthetic fixed instants (rendering verified with Intl.DateTimeFormat for
// America/New_York during fixture authoring).
const LAST_SEEN = 1789387200000 // 2026-09-14 08:00 EDT

const baseEntry = {
  entryId: "syn-entry-100",
  captureId: "syn-capture-100",
  authorId: "caregiver-mom",
  createdAt: LAST_SEEN + 5 * 60_000,
  visibility: "published" as const,
  extractionStatus: "structured" as const,
  rawTranscript: "Ava had 8 ounces of milk with breakfast at 8:00 AM.",
  events: [{ category: "meal" as const, timestamp: LAST_SEEN, payload: { ounces: 8 }, confidence: 0.95 }],
}

const baseInput = {
  childId: "syn-child-ava",
  childName: "Ava",
  recipientName: "Nana Ruth",
  lastSeenAt: LAST_SEEN,
  generatedAt: LAST_SEEN + 3 * DAY,
  timezone: TZ,
  entries: [baseEntry],
  routineNotes: [],
}

describe("handoff invariants", () => {
  test("static digest round-trips through the exported HandoffDigest schema", () => {
    const digest = composeSinceLastSeen(Schema.decodeUnknownSync(DigestInput)(baseInput))
    const decoded = Schema.decodeUnknownSync(HandoffDigest)(digest)
    expect(decoded).toEqual(digest)
  })

  test("every digest claim carries at least one source reference", () => {
    const digest = composeSinceLastSeen(
      Schema.decodeUnknownSync(DigestInput)({ ...baseInput, entries: [baseEntry] }),
    )
    expect(digest.claims.length).toBeGreaterThan(0)
    for (const claim of digest.claims) {
      expect(claim.sourceRefs.length).toBeGreaterThanOrEqual(1)
    }
  })

  test("every unresolved question carries at least one source reference", () => {
    const failedEntry = {
      ...baseEntry,
      entryId: "syn-entry-101",
      captureId: "syn-capture-101",
      extractionStatus: "failed" as const,
      events: [],
    }
    const digest = composeSinceLastSeen(
      Schema.decodeUnknownSync(DigestInput)({ ...baseInput, entries: [failedEntry] }),
    )
    expect(digest.unresolvedQuestions.length).toBeGreaterThan(0)
    for (const question of digest.unresolvedQuestions) {
      expect(question.sourceRefs.length).toBeGreaterThanOrEqual(1)
    }
  })

  test("care-neutral guard rejects neglect-implying phrasings", () => {
    for (const token of FORBIDDEN_TOKENS) {
      const sentence = `Framing sentence with ${token} in it.`
      expect(() => assertCareNeutral(sentence)).toThrow()
    }
  })

  test("gap-disclosure template passes the care-neutral guard", () => {
    const statement =
      "No entries were logged on 2026-09-17. That is a gap in the journal, not a gap in Ava's care."
    expect(() => assertCareNeutral(statement)).not.toThrow()
  })

  test("window boundaries: event at lastSeenAt is included, entry at generatedAt is excluded", () => {
    // baseEntry's event sits exactly at lastSeenAt — included.
    const inclusive = composeSinceLastSeen(Schema.decodeUnknownSync(DigestInput)(baseInput))
    expect(inclusive.claims.length).toBe(1)
    expect(inclusive.sourceIndex.length).toBe(1)

    // An entry stamped exactly at generatedAt is outside [lastSeenAt, generatedAt).
    const boundaryEntry = { ...baseEntry, entryId: "syn-entry-102", captureId: "syn-capture-102", createdAt: baseInput.generatedAt }
    const exclusive = composeSinceLastSeen(
      Schema.decodeUnknownSync(DigestInput)({ ...baseInput, entries: [boundaryEntry] }),
    )
    expect(exclusive.claims.length).toBe(0)
    expect(exclusive.sourceIndex.length).toBe(0)
  })

  test("draft capture content never appears anywhere in the rendered digest", () => {
    const draftEntry = {
      ...baseEntry,
      entryId: "syn-entry-103",
      captureId: "syn-capture-103",
      visibility: "draft" as const,
      rawTranscript: "Draft capture with xyzzy unpublished marker.",
    }
    const digest = composeSinceLastSeen(
      Schema.decodeUnknownSync(DigestInput)({ ...baseInput, entries: [baseEntry, draftEntry] }),
    )
    const text = digestToText(digest)
    expect(text.includes("xyzzy")).toBe(false)
    expect(text.includes("unpublished marker")).toBe(false)
    expect(digest.unresolvedQuestions.some((q) => q.reason === "draft-capture")).toBe(true)
  })

  test("failed extraction surfaces an unresolved question citing the entry", () => {
    const failedEntry = {
      ...baseEntry,
      entryId: "syn-entry-104",
      captureId: "syn-capture-104",
      extractionStatus: "failed" as const,
      events: [],
    }
    const digest = composeSinceLastSeen(
      Schema.decodeUnknownSync(DigestInput)({ ...baseInput, entries: [failedEntry] }),
    )
    const question = digest.unresolvedQuestions.find((q) => q.reason === "extraction-failed")
    expect(question).toBeDefined()
    if (!question) return
    const ref = question.sourceRefs[0]
    expect(ref?._tag).toBe("entry")
    if (ref?._tag !== "entry") return
    expect(ref.entryId).toBe("syn-entry-104")
  })

  test("low-confidence event is withheld from claims and escalated as a question", () => {
    const lowEntry = {
      ...baseEntry,
      entryId: "syn-entry-105",
      captureId: "syn-capture-105",
      events: [{ category: "mood" as const, timestamp: LAST_SEEN, confidence: 0.3 }],
    }
    const digest = composeSinceLastSeen(
      Schema.decodeUnknownSync(DigestInput)({ ...baseInput, entries: [lowEntry] }),
    )
    expect(digest.claims.length).toBe(0)
    const question = digest.unresolvedQuestions.find((q) => q.reason === "low-confidence-event")
    expect(question).toBeDefined()
  })

  test("medical questions are refused without any conclusion", () => {
    const answer = answerFollowUp("Is her eating normal for her age?", Schema.decodeUnknownSync(DigestInput)(baseInput))
    expect(answer._tag).toBe("refused-medical")
  })

  test("out-of-window questions are refused without answering", () => {
    const answer = answerFollowUp("How was her month?", Schema.decodeUnknownSync(DigestInput)(baseInput))
    expect(answer._tag).toBe("refused-out-of-window")
  })

  test("empty follow-up question is rejected", () => {
    expect(() =>
      answerFollowUp("   ", Schema.decodeUnknownSync(DigestInput)(baseInput)),
    ).toThrow()
  })

  test("answered follow-up always carries a citation", () => {
    const answer = answerFollowUp("How did meals go?", Schema.decodeUnknownSync(DigestInput)(baseInput))
    expect(answer._tag).toBe("answered")
    if (answer._tag !== "answered") return
    expect(answer.claim.sourceRefs.length).toBeGreaterThanOrEqual(1)
  })

  test("window longer than 366 days is rejected", () => {
    expect(() =>
      composeSinceLastSeen(
        Schema.decodeUnknownSync(DigestInput)({
          ...baseInput,
          lastSeenAt: LAST_SEEN - 367 * DAY,
        }),
      ),
    ).toThrow()
  })

  test("generatedAt before lastSeenAt is rejected", () => {
    expect(() =>
      composeSinceLastSeen(
        Schema.decodeUnknownSync(DigestInput)({ ...baseInput, generatedAt: LAST_SEEN - 1 }),
      ),
    ).toThrow()
  })
})
