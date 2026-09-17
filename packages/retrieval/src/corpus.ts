import { Schema } from "effect"

import { EntrySchema, EventSchema, type Entry, type Event } from "@journal/domain"

/**
 * Deterministic 30-day synthetic family-history corpus.
 *
 * Slot 03 (30-day fixture generator, branch feat/family-history-fixtures)
 * had not merged when this was written — no such branch existed on the
 * remote — so per the expansion brief this is the DETERMINISTIC FALLBACK:
 * pure constants, no clock reads, no randomness. Two runs produce
 * byte-identical data, and every entry/event decodes through the canonical
 * `@journal/domain` schemas at generation time (fail-fast).
 *
 * The corpus is synthetic data only — one demo household, two children,
 * three authors — engineered so each retrieval behavior in scope has a
 * hand-checkable scenario pinned below.
 */

/** Append-only correction: one event supersedes another (slot 10 territory; modeled in data here). */
export interface CorrectionRecord {
  readonly id: string
  readonly supersedesEventId: string
  readonly replacementEventId: string
  readonly reason: string
  readonly correctedBy: string
  readonly correctedAt: number
}

/** An entry plus its extracted events, paired with the entry's stable id. */
export interface CorpusRecord {
  readonly entryId: string
  readonly entry: Entry
  /** Aligned with `entry.structuredEventIds` by index. */
  readonly events: readonly Event[]
}

export interface JournalCorpus {
  readonly householdId: string
  readonly householdTimezone: string
  readonly children: readonly { readonly childId: string; readonly name: string }[]
  readonly records: readonly CorpusRecord[]
  readonly corrections: readonly CorrectionRecord[]
  /** Coverage span: `dayCount` local days starting at `firstDayUtcMs`. */
  readonly coverage: { readonly firstDayUtcMs: number; readonly dayCount: number }
}

/**
 * Timeline: 30 days, Aug 14 2026 – Sep 12 2026, household in
 * America/New_York (EDT, UTC-4 the whole window — no DST transition).
 * Local midnight is 04:00Z, so a local hour `h` is `4 + h` UTC.
 */
const DAY_COUNT = 30
const dayUtc = (dayIndex: number, hourUtc = 4): number => Date.UTC(2026, 7, 14 + dayIndex, hourUtc)

/** Local (EDT) clock hours for recurring captures. */
const BREAKFAST_HOUR_UTC = 12 // 08:00 EDT
const NAP_HOUR_UTC = 17 // 13:00 EDT
const DINNER_HOUR_UTC = 22 // 18:00 EDT

/** Days with zero entries — the missing-log window (Aug 22–23). */
const GAP_DAYS: readonly number[] = [8, 9]

/** Day the younger child has no nap on the timeline (entries still exist). */
const NO_NAP_DAYS: readonly number[] = [1]

/** Nap durations by day index — explicit table, fully auditable. */
const NAP_MINUTES: Readonly<Record<number, number>> = {
  0: 45, 2: 40, 3: 50, 4: 40, 5: 45, 6: 40, 7: 35, 10: 45, 11: 40, 12: 30,
  13: 45, 14: 50, 15: 40, 16: 45, 17: 35, 18: 45, 19: 40, 20: 50, 21: 45,
  22: 40, 23: 45, 24: 35, 25: 50, 26: 40, 27: 45, 28: 40, 29: 45,
}

const CONFLICT_DAY = 3 // Aug 17 — mom and dad log different pasta servings
const CORRECTION_DAY = 6 // Aug 20 — dad corrects the Aug 19 nap duration
const TOOTH_DAY = 12 // Aug 26 — grandma (visiting, Pacific/Auckland) logs a milestone
const BOTH_DINNER_DAY = 16 // Aug 30 — both children eat dinner (ambiguity source)
const SCHOOL_DAY = 22 // Sep 5 — caregiver-confirmed school event

const pad2 = (n: number): string => String(n).padStart(2, "0")

/** Breakfast author alternates by day parity so attribution stays hand-checkable. */
const breakfastAuthor = (dayIndex: number): string => (dayIndex % 2 === 0 ? "mom" : "dad")

const breakfastTranscript = (child: string, author: string): string =>
  author === "mom"
    ? `${child} ate one serving of oatmeal for breakfast this morning.`
    : `${child} had one serving of oatmeal at breakfast.`

const napTranscript = (minutes: number): string => `Ada napped ${minutes} minutes after lunch.`

/**
 * Build the corpus. Throws (fail-fast) if any generated record fails to
 * decode through the canonical schemas — synthetic data must stay
 * contract-valid by construction.
 */
export const generateCorpus = (): JournalCorpus => {
  const householdId = "household_demo"
  const records: CorpusRecord[] = []

  const addRecord = (record: CorpusRecord): void => {
    // Decode through the canonical schemas — the contract is the authority.
    Schema.decodeUnknownSync(EntrySchema)(record.entry)
    for (const event of record.events) Schema.decodeUnknownSync(EventSchema)(event)
    records.push(record)
  }

  for (let dayIndex = 0; dayIndex < DAY_COUNT; dayIndex++) {
    if (GAP_DAYS.includes(dayIndex)) continue

    const dd = pad2(dayIndex)

    // Mechanical filler: both children have breakfast every non-gap day.
    for (const child of ["Ada", "Milo"] as const) {
      const childId = `child_${child.toLowerCase()}`
      const author = breakfastAuthor(dayIndex)
      const eventId = `ev-${childId}-breakfast-d${dd}`
      addRecord({
        entryId: `en-bf-d${dd}-${childId}`,
        entry: {
          householdId,
          childId,
          authorId: author,
          rawTranscript: breakfastTranscript(child, author),
          structuredEventIds: [eventId],
          extractionStatus: "structured",
          visibility: "published",
          createdAt: dayUtc(dayIndex, BREAKFAST_HOUR_UTC) + 30 * 60_000,
        },
        events: [
          {
            householdId,
            childId,
            category: "meal",
            timestamp: dayUtc(dayIndex, BREAKFAST_HOUR_UTC),
            payload: { servings: 1 },
            confidence: 0.9,
          },
        ],
      })
    }

    // Ada naps most days (day 1: no nap logged — entries still exist).
    if (!NO_NAP_DAYS.includes(dayIndex)) {
      const minutes = NAP_MINUTES[dayIndex]
      if (minutes === undefined) throw new Error(`corpus: missing nap minutes for day ${dayIndex}`)
      addRecord({
        entryId: `en-nap-d${dd}`,
        entry: {
          householdId,
          childId: "child_ada",
          authorId: "mom",
          rawTranscript: napTranscript(minutes),
          structuredEventIds: [`ev-ada-nap-d${dd}`],
          extractionStatus: "structured",
          visibility: "published",
          createdAt: dayUtc(dayIndex, NAP_HOUR_UTC) + 30 * 60_000,
        },
        events: [
          {
            householdId,
            childId: "child_ada",
            category: "sleep",
            timestamp: dayUtc(dayIndex, NAP_HOUR_UTC),
            payload: { minutes },
            confidence: 0.88,
          },
        ],
      })
    }
  }

  // Scenario: conflicting authors (Aug 17) — same child, same category, same
  // local day, two authors, differing payload on the shared key.
  addRecord({
    entryId: `en-dinner-d${pad2(CONFLICT_DAY)}-mom`,
    entry: {
      householdId,
      childId: "child_ada",
      authorId: "mom",
      rawTranscript: "Ada ate two servings of pasta at dinner tonight.",
      structuredEventIds: [`ev-ada-dinner-d${pad2(CONFLICT_DAY)}-mom`],
      extractionStatus: "structured",
      visibility: "published",
      createdAt: dayUtc(CONFLICT_DAY, DINNER_HOUR_UTC) + 30 * 60_000,
    },
    events: [
      {
        householdId,
        childId: "child_ada",
        category: "meal",
        timestamp: dayUtc(CONFLICT_DAY, DINNER_HOUR_UTC),
        payload: { servings: 2 },
        confidence: 0.91,
      },
    ],
  })
  addRecord({
    entryId: `en-dinner-d${pad2(CONFLICT_DAY)}-dad`,
    entry: {
      householdId,
      childId: "child_ada",
      authorId: "dad",
      rawTranscript: "Dinner was a struggle tonight — Ada only ate one serving of pasta.",
      structuredEventIds: [`ev-ada-dinner-d${pad2(CONFLICT_DAY)}-dad`],
      extractionStatus: "structured",
      visibility: "published",
      createdAt: dayUtc(CONFLICT_DAY, DINNER_HOUR_UTC) + 45 * 60_000,
    },
    events: [
      {
        householdId,
        childId: "child_ada",
        category: "meal",
        timestamp: dayUtc(CONFLICT_DAY, DINNER_HOUR_UTC),
        payload: { servings: 1 },
        confidence: 0.9,
      },
    ],
  })

  // Scenario: append-only correction (Aug 20) — dad corrects the Aug 19 nap
  // duration. The replacement event keeps the ORIGINAL nap instant.
  const supersededNapEventId = `ev-ada-nap-d${pad2(5)}`
  const correctedNapEventId = "ev-ada-nap-d05-corrected"
  const correctionEntryId = `en-correction-d${pad2(CORRECTION_DAY)}`
  addRecord({
    entryId: correctionEntryId,
    entry: {
      householdId,
      childId: "child_ada",
      authorId: "dad",
      rawTranscript: "Correction to yesterday's entry: Ada's nap was actually 75 minutes, not 45.",
      structuredEventIds: [correctedNapEventId],
      extractionStatus: "structured",
      visibility: "published",
      createdAt: dayUtc(CORRECTION_DAY, 24) + 10 * 60_000, // 20:10 EDT Aug 20
    },
    events: [
      {
        householdId,
        childId: "child_ada",
        category: "sleep",
        timestamp: dayUtc(5, NAP_HOUR_UTC),
        payload: { minutes: 75 },
        confidence: 1, // caregiver-corrected — confirmed
      },
    ],
  })

  // Scenario: invited caregiver logs a milestone from Auckland (NZST, +12).
  // The event instant is absolute; her timezone is recorded on the author
  // roster (kept in the README, not on the wire — the contract has no
  // per-event timezone field; the asker's zone formats statements).
  addRecord({
    entryId: `en-milestone-d${pad2(TOOTH_DAY)}-grandma`,
    entry: {
      householdId,
      childId: "child_ada",
      authorId: "grandma",
      rawTranscript: "Ada lost her first tooth today! It had been wobbly for weeks.",
      structuredEventIds: [`ev-ada-tooth-d${pad2(TOOTH_DAY)}`],
      extractionStatus: "structured",
      visibility: "published",
      createdAt: dayUtc(TOOTH_DAY, 7), // 19:00 NZST = 07:00Z
    },
    events: [
      {
        householdId,
        childId: "child_ada",
        category: "milestone",
        timestamp: dayUtc(TOOTH_DAY, 3), // 15:00 NZST = 03:00Z
        confidence: 0.98,
      },
    ],
  })

  // Scenario: both children eat dinner the same evening (Aug 30) — equal
  // payloads, so no conflict, but an unpinned "last dinner" question is
  // ambiguous across children.
  addRecord({
    entryId: `en-dinner-d${pad2(BOTH_DINNER_DAY)}-mom`,
    entry: {
      householdId,
      childId: "child_ada",
      authorId: "mom",
      rawTranscript: "Ada ate one serving of pasta at dinner.",
      structuredEventIds: [`ev-ada-dinner-d${pad2(BOTH_DINNER_DAY)}`],
      extractionStatus: "structured",
      visibility: "published",
      createdAt: dayUtc(BOTH_DINNER_DAY, DINNER_HOUR_UTC) + 30 * 60_000,
    },
    events: [
      {
        householdId,
        childId: "child_ada",
        category: "meal",
        timestamp: dayUtc(BOTH_DINNER_DAY, DINNER_HOUR_UTC),
        payload: { servings: 1 },
        confidence: 0.9,
      },
    ],
  })
  addRecord({
    entryId: `en-dinner-d${pad2(BOTH_DINNER_DAY)}-dad`,
    entry: {
      householdId,
      childId: "child_milo",
      authorId: "dad",
      rawTranscript: "Milo ate one serving of pasta at dinner.",
      structuredEventIds: [`ev-milo-dinner-d${pad2(BOTH_DINNER_DAY)}`],
      extractionStatus: "structured",
      visibility: "published",
      createdAt: dayUtc(BOTH_DINNER_DAY, DINNER_HOUR_UTC) + 30 * 60_000,
    },
    events: [
      {
        householdId,
        childId: "child_milo",
        category: "meal",
        timestamp: dayUtc(BOTH_DINNER_DAY, DINNER_HOUR_UTC),
        payload: { servings: 1 },
        confidence: 0.9,
      },
    ],
  })

  // Scenario: caregiver-confirmed school event (confidence 1) on Sep 5.
  addRecord({
    entryId: `en-school-d${pad2(SCHOOL_DAY)}-mom`,
    entry: {
      householdId,
      childId: "child_ada",
      authorId: "mom",
      rawTranscript: "Ada's first day of kindergarten today — she was so proud of her new backpack.",
      structuredEventIds: [`ev-ada-school-d${pad2(SCHOOL_DAY)}`],
      extractionStatus: "structured",
      visibility: "published",
      createdAt: dayUtc(SCHOOL_DAY, 13) + 30 * 60_000, // 09:00 EDT
    },
    events: [
      {
        householdId,
        childId: "child_ada",
        category: "school",
        timestamp: dayUtc(SCHOOL_DAY, 13),
        confidence: 1, // caregiver-confirmed — confirmed
      },
    ],
  })

  const corrections: CorrectionRecord[] = [
    {
      id: "cor-d06-nap-duration",
      supersedesEventId: supersededNapEventId,
      replacementEventId: correctedNapEventId,
      reason: "nap duration was misreported",
      correctedBy: "dad",
      correctedAt: dayUtc(CORRECTION_DAY, 24), // 20:00 EDT Aug 20
    },
  ]

  return {
    householdId,
    householdTimezone: "America/New_York",
    children: [
      { childId: "child_ada", name: "Ada" },
      { childId: "child_milo", name: "Milo" },
    ],
    records,
    corrections,
    coverage: { firstDayUtcMs: dayUtc(0), dayCount: DAY_COUNT },
  }
}
