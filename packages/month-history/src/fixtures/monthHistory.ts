/**
 * Deterministic synthetic family dataset for the month-history journeys.
 *
 * All instants are fixed Date.UTC values (never `new Date()`); the household
 * zone is America/New_York. Values pinned in tests were verified against
 * full-ICU (bun 1.3.14 / node 20) on 2026-09-17:
 * - Sep 30 2026 23:50 EDT = 1790826600000 -> local date 2026-09-30
 * - Oct 1  2026 00:10 EDT = 1790827800000 -> local date 2026-10-01
 * - Nov 1  2026 01:30 EDT = 1793511000000 and 01:30 EST = 1793514600000
 *   BOTH map to local date 2026-11-01 (DST fall-back hour repeats)
 * - Sep 2026 in NY spans 720h; Oct 744h; Nov 721h (fall-back)
 * - instant 1790802000000 is 2026-10-01 in Asia/Kolkata but 2026-09-30 in NY
 *
 * The dataset is a CONTRACT fixture: entries/events are shaped as canonical
 * domain documents and tests decode them through EntryDocument/EventDocument
 * schemas before any view is built.
 */
import type { EntryDocument, EventDocument } from "@journal/domain"
import type { CorrectionRecord } from "../corrections.js"

export const HOUSEHOLD_ZONE = "America/New_York"
export const HOUSEHOLD_ID = "hh_month_fixture_0000000000000000"
export const CHILD_ID = "ch_month_fixture_0000000000000000"

export const MOM = "cg_mom"
export const DAD = "cg_dad"
export const ANA = "cg_ana"
export const AUTHORS: Readonly<Record<string, string>> = { [MOM]: "Mom", [DAD]: "Dad", [ANA]: "Ana" }

// --- Fixed instants (September 2026, the sparse retrieval month) ----------
export const SEP2_TOWER_CAPTURE = Date.UTC(2026, 8, 2, 22, 30, 0) // Sep 2, 6:30 PM EDT
export const SEP2_POTTY_1 = Date.UTC(2026, 8, 2, 19, 0, 0) // 3:00 PM EDT
export const SEP2_POTTY_2 = Date.UTC(2026, 8, 2, 20, 30, 0) // 4:30 PM EDT
export const SEP2_MILESTONE = Date.UTC(2026, 8, 2, 21, 45, 0) // 5:45 PM EDT
export const SEP12_NAP_CARE = Date.UTC(2026, 8, 12, 14, 0, 0) // 10:00 AM EDT (care date)
export const SEP20_LATE_CAPTURE = Date.UTC(2026, 8, 20, 12, 14, 0) // 8:14 AM EDT (capture date)
export const SEP20_FAILED_CAPTURE = Date.UTC(2026, 8, 21, 0, 5, 0) // Sep 20, 8:05 PM EDT
export const SEP25_DRAFT_CAPTURE = Date.UTC(2026, 8, 25, 21, 0, 0) // 5:00 PM EDT
export const SEP25_MOOD = Date.UTC(2026, 8, 25, 20, 30, 0) // 4:30 PM EDT
export const SEP26_DRAFT_CAPTURE = Date.UTC(2026, 8, 26, 13, 0, 0) // 9:00 AM EDT
export const SEP27_CORRECTION = Date.UTC(2026, 8, 27, 14, 0, 0) // 10:00 AM EDT

// Month-boundary pair (NY): Sep 30 23:50 EDT vs Oct 1 00:10 EDT.
export const SEP30_2350_EVENT = 1790826600000
export const OCT1_0010_EVENT = 1790827800000

// DST fall-back pair (NY): both are local 1:30 AM on Nov 1, 2026.
export const NOV1_0130_EDT = 1793511000000
export const NOV1_0130_EST = 1793514600000

const ENTRY_TOWER_ID = "en_sep02_tower"
const ENTRY_NAP_LATE_ID = "en_sep12_nap_late"
const ENTRY_FAILED_ID = "en_sep20_failed"
const ENTRY_DRAFT_MOM_ID = "en_sep25_draft_mom"
const ENTRY_DRAFT_ANA_ID = "en_sep26_draft_ana"
const ENTRY_SEP30_BOUNDARY_ID = "en_sep30_boundary"
const ENTRY_OCT1_BOUNDARY_ID = "en_oct01_boundary"
const ENTRY_DST_ID = "en_nov01_dst"

export const ORIGINAL_TOWER_TRANSCRIPT =
  "Big day at preschool — Lena built a block tower taller than her. Two potty successes before pickup."
export const CORRECTED_TOWER_TRANSCRIPT =
  "Lena built a 12-block tower at preschool today. Two potty successes before pickup."

export const ENTRIES: readonly EntryDocument[] = [
  {
    _id: ENTRY_TOWER_ID,
    _creationTime: SEP2_TOWER_CAPTURE,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    authorId: MOM,
    rawTranscript: ORIGINAL_TOWER_TRANSCRIPT,
    structuredEventIds: ["ev_sep02_potty_1", "ev_sep02_potty_2", "ev_sep02_milestone"],
    extractionStatus: "structured",
    visibility: "published",
    createdAt: SEP2_TOWER_CAPTURE,
  },
  {
    // LATE ENTRY: care happened Sep 12, captured Sep 20. The event belongs to
    // Sep 12; the capture metadata travels with the card.
    _id: ENTRY_NAP_LATE_ID,
    _creationTime: SEP20_LATE_CAPTURE,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    authorId: MOM,
    rawTranscript: "She napped 45 minutes after lunch on the 12th — forgot to log it.",
    structuredEventIds: ["ev_sep12_nap"],
    extractionStatus: "structured",
    visibility: "published",
    createdAt: SEP20_LATE_CAPTURE,
  },
  {
    // FAILED EXTRACTION: capture is never blocked; no structured events exist
    // and the raw note must still surface on the capture day.
    _id: ENTRY_FAILED_ID,
    _creationTime: SEP20_FAILED_CAPTURE,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    authorId: DAD,
    rawTranscript: "She napped 45 minutes after lunch.",
    structuredEventIds: [],
    extractionStatus: "failed",
    visibility: "published",
    createdAt: SEP20_FAILED_CAPTURE,
  },
  {
    // MOM'S DRAFT: visible to Mom only (author-only), even though extracted.
    _id: ENTRY_DRAFT_MOM_ID,
    _creationTime: SEP25_DRAFT_CAPTURE,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    authorId: MOM,
    rawTranscript: "She seemed off after dinner — watching for a temperature tonight.",
    structuredEventIds: ["ev_sep25_mood"],
    extractionStatus: "structured",
    visibility: "draft",
    createdAt: SEP25_DRAFT_CAPTURE,
  },
  {
    // ANA'S DRAFT: invisible to both parents until published.
    _id: ENTRY_DRAFT_ANA_ID,
    _creationTime: SEP26_DRAFT_CAPTURE,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    authorId: ANA,
    rawTranscript: "Morning walk to the corner library — pointed at every duck sticker.",
    structuredEventIds: [],
    extractionStatus: "pending",
    visibility: "draft",
    createdAt: SEP26_DRAFT_CAPTURE,
  },
  {
    // TIMEZONE BOUNDARY: care at 23:50 EDT on Sep 30 — NOT in the NY October
    // view, but inside a Kolkata-October view of the same data.
    _id: ENTRY_SEP30_BOUNDARY_ID,
    _creationTime: SEP30_2350_EVENT,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    authorId: MOM,
    rawTranscript: "One last potty before bed, right at the wire.",
    structuredEventIds: ["ev_sep30_potty"],
    extractionStatus: "structured",
    visibility: "published",
    createdAt: SEP30_2350_EVENT,
  },
  {
    // TIMEZONE BOUNDARY: care at 00:10 EDT on Oct 1 — the first minute of the
    // NY October view.
    _id: ENTRY_OCT1_BOUNDARY_ID,
    _creationTime: OCT1_0010_EVENT,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    authorId: MOM,
    rawTranscript: "Midnight snack raid — half a banana and all the cheerios.",
    structuredEventIds: ["ev_oct01_meal"],
    extractionStatus: "structured",
    visibility: "published",
    createdAt: OCT1_0010_EVENT,
  },
  {
    // DST FALL-BACK: two sleep events, both at local 1:30 AM on Nov 1 2026 —
    // the wall-clock hour that happens twice. Both stay on Nov 1.
    _id: ENTRY_DST_ID,
    _creationTime: NOV1_0130_EDT,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    authorId: DAD,
    rawTranscript: "Asleep again by 1:30 — before and after the clocks fell back.",
    structuredEventIds: ["ev_nov01_sleep_edt", "ev_nov01_sleep_est"],
    extractionStatus: "structured",
    visibility: "published",
    createdAt: NOV1_0130_EDT,
  },
]

export const EVENTS: readonly EventDocument[] = [
  {
    _id: "ev_sep02_potty_1",
    _creationTime: SEP2_POTTY_1,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "potty",
    timestamp: SEP2_POTTY_1,
    confidence: 0.93,
  },
  {
    _id: "ev_sep02_potty_2",
    _creationTime: SEP2_POTTY_2,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "potty",
    timestamp: SEP2_POTTY_2,
    confidence: 0.91,
  },
  {
    _id: "ev_sep02_milestone",
    _creationTime: SEP2_MILESTONE,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "milestone",
    timestamp: SEP2_MILESTONE,
    confidence: 0.88,
  },
  {
    _id: "ev_sep12_nap",
    _creationTime: SEP20_LATE_CAPTURE,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "sleep",
    timestamp: SEP12_NAP_CARE,
    payload: { minutes: 45 },
    confidence: 0.95,
  },
  {
    _id: "ev_sep25_mood",
    _creationTime: SEP25_MOOD,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "mood",
    timestamp: SEP25_MOOD,
    confidence: 0.8,
  },
  {
    _id: "ev_sep30_potty",
    _creationTime: SEP30_2350_EVENT,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "potty",
    timestamp: SEP30_2350_EVENT,
    confidence: 0.9,
  },
  {
    _id: "ev_oct01_meal",
    _creationTime: OCT1_0010_EVENT,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "meal",
    timestamp: OCT1_0010_EVENT,
    confidence: 0.9,
  },
  {
    _id: "ev_nov01_sleep_edt",
    _creationTime: NOV1_0130_EDT,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "sleep",
    timestamp: NOV1_0130_EDT,
    payload: { minutes: 30 },
    confidence: 0.85,
  },
  {
    _id: "ev_nov01_sleep_est",
    _creationTime: NOV1_0130_EST,
    householdId: HOUSEHOLD_ID,
    childId: CHILD_ID,
    category: "sleep",
    timestamp: NOV1_0130_EST,
    payload: { minutes: 90 },
    confidence: 0.85,
  },
]

/**
 * Dad corrects Mom's published entry (Sep 2): append-only, attributed,
 * original preserved. A second correction supersedes the first in the
 * lineage-chain test (not part of the default CORRECTIONS fixture).
 */
export const CORRECTIONS: readonly CorrectionRecord[] = [
  {
    correctionId: "co_sep02_dad_1",
    originalEntryId: ENTRY_TOWER_ID,
    correctedBy: DAD,
    createdAtMs: SEP27_CORRECTION,
    reason: "Tower was 12 blocks — not taller than her. Grandpa exaggeration.",
    replacementTranscript: CORRECTED_TOWER_TRANSCRIPT,
  },
]

export const MONTH_FIXTURE = {
  householdId: HOUSEHOLD_ID,
  childId: CHILD_ID,
  zone: HOUSEHOLD_ZONE,
  entries: ENTRIES,
  events: EVENTS,
  corrections: CORRECTIONS,
  authors: AUTHORS,
} as const

export const ENTRY_IDS = {
  tower: ENTRY_TOWER_ID,
  napLate: ENTRY_NAP_LATE_ID,
  failed: ENTRY_FAILED_ID,
  draftMom: ENTRY_DRAFT_MOM_ID,
  draftAna: ENTRY_DRAFT_ANA_ID,
  sep30Boundary: ENTRY_SEP30_BOUNDARY_ID,
  oct1Boundary: ENTRY_OCT1_BOUNDARY_ID,
  dst: ENTRY_DST_ID,
} as const

export const EVENT_IDS = {
  potty1: "ev_sep02_potty_1",
  potty2: "ev_sep02_potty_2",
  milestone: "ev_sep02_milestone",
  napLate: "ev_sep12_nap",
  moodDraft: "ev_sep25_mood",
  sep30Boundary: "ev_sep30_potty",
  oct1Boundary: "ev_oct01_meal",
  sleepEdt: "ev_nov01_sleep_edt",
  sleepEst: "ev_nov01_sleep_est",
} as const
