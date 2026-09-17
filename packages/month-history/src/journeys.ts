/**
 * The three month-history journeys as EXECUTABLE checks. Each check is a
 * deterministic claim about what a parent or invited caregiver can retrieve,
 * correct, or hand off — pinned to exact strings and counts. run.ts executes
 * these and validates rubric.json coverage; the bun test suite pins the same
 * behavior at unit granularity.
 *
 * Journeys (synthetic family: Mom, Dad, and invited caregiver Ana):
 * - parent-retrieval  (J1)  Mom retrieves September 2026 — a sparse month with
 *     a late entry, a failed extraction, two drafts, a correction, and month/
 *     DST/timezone boundary cases; large-text, screen-reader and quiet-input
 *     contracts are part of the same retrieval surface.
 * - parent-correction (J2)  Dad corrects Mom's published entry; the original
 *     is preserved; drafts and attribution are protected by the one shared
 *     fail-closed policy.
 * - caregiver-handoff (J3)  Mom prepares a September handoff digest for Dad;
 *     it contains only what Dad may see, discloses excluded drafts as counts
 *     (never content), links every line to sources, and lists every day with
 *     nothing recorded.
 */
import { evaluateAccess } from "../../../security/access/policy"
import {
  CORRECTION_ORIGINAL_PRESERVED_LABEL,
  DAY_CELL_A11Y_HINT,
  EXTRACTION_FAILED_LABEL,
  FONT_SCALING,
  GAP_DISCLAIMER,
  LAYOUT_POLICY,
  QUIET_TEXT_INPUT,
} from "./a11y.js"
import { correctionAccess, monthAccess, toPolicyEntry, type ChildScope, type MonthAccessResult, type Principal } from "./access.js"
import {
  AUTHORS,
  CHILD_ID,
  CORRECTED_TOWER_TRANSCRIPT,
  CORRECTIONS,
  DAD,
  ENTRIES,
  ENTRY_IDS,
  EVENT_IDS,
  EVENTS,
  HOUSEHOLD_ID,
  HOUSEHOLD_ZONE,
  MOM,
  ORIGINAL_TOWER_TRANSCRIPT,
  SEP27_CORRECTION,
} from "./fixtures/monthHistory.js"
import { buildLineage as buildLineageFrom, type CorrectionRecord } from "./corrections.js"
import { buildHandoffDigest } from "./handoff.js"
import type { DayCellView, MonthHistoryView } from "./types.js"
import { buildMonthHistoryView, entryViewInputFromDocument, eventViewInputFromDocument } from "./view.js"

export type JourneyKind = "parent-retrieval" | "parent-correction" | "caregiver-handoff"

export interface CheckOutcome {
  readonly ok: boolean
  readonly detail: string
}

export interface JourneyCheck {
  readonly id: string
  readonly journey: JourneyKind
  readonly claim: string
  readonly run: () => CheckOutcome
}

const check = (ok: boolean, detail: string): CheckOutcome => ({ ok, detail })
const eq = <T>(actual: T, expected: T, label: string): CheckOutcome =>
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )

// --- Shared deterministic projections ---------------------------------------

const SCOPE: ChildScope = { childId: CHILD_ID, householdId: HOUSEHOLD_ID }
const MOM_PRINCIPAL: Principal = { kind: "caregiver", caregiverId: MOM, householdIds: [HOUSEHOLD_ID] }
const DAD_PRINCIPAL: Principal = { kind: "caregiver", caregiverId: DAD, householdIds: [HOUSEHOLD_ID] }
const ANA_PRINCIPAL: Principal = { kind: "caregiver", caregiverId: "cg_ana", householdIds: [HOUSEHOLD_ID] }
const OUTSIDER_PRINCIPAL: Principal = { kind: "caregiver", caregiverId: "cg_outsider", householdIds: [] }
const ANON_PRINCIPAL: Principal = { kind: "anonymous" }

/** Pristine-dataset fingerprint, captured BEFORE any projection runs. */
const DATASET_SNAPSHOT = JSON.stringify({ entries: ENTRIES, events: EVENTS })

const SCOPE_ENTRIES = ENTRIES.map(entryViewInputFromDocument)
const ALL_EVENTS = EVENTS.map(eventViewInputFromDocument)

export function buildAuthorizedView(
  principal: Principal,
  monthKey: string,
  timeZone: string,
  corrections: readonly CorrectionRecord[] = CORRECTIONS,
): { readonly access: MonthAccessResult; readonly view: MonthHistoryView } {
  const access = monthAccess(principal, SCOPE, ENTRIES)
  if (access.outcome !== "allowed") {
    return {
      access,
      view: buildMonthHistoryView({ monthKey, timeZone, entries: [], events: [], corrections, authors: AUTHORS, scopeEntries: SCOPE_ENTRIES }),
    }
  }
  return {
    access,
    view: buildMonthHistoryView({
      monthKey,
      timeZone,
      entries: access.visible.map(entryViewInputFromDocument),
      events: ALL_EVENTS,
      corrections,
      authors: AUTHORS,
      scopeEntries: SCOPE_ENTRIES,
    }),
  }
}

const MOM_SEP = buildAuthorizedView(MOM_PRINCIPAL, "2026-09", HOUSEHOLD_ZONE)
const DAD_SEP = buildAuthorizedView(DAD_PRINCIPAL, "2026-09", HOUSEHOLD_ZONE)
const MOM_OCT_NY = buildAuthorizedView(MOM_PRINCIPAL, "2026-10", "America/New_York")
const MOM_OCT_IST = buildAuthorizedView(MOM_PRINCIPAL, "2026-10", "Asia/Kolkata")
const MOM_NOV_NY = buildAuthorizedView(MOM_PRINCIPAL, "2026-11", HOUSEHOLD_ZONE)

const EMPTY_SEP = buildMonthHistoryView({ monthKey: "2026-09", timeZone: HOUSEHOLD_ZONE, entries: [], events: [], authors: AUTHORS })

const DAD_HANDOFF = buildHandoffDigest(DAD_SEP.view, {
  preparedByName: "Mom",
  preparedForName: "Dad",
  excludedDraftCount: DAD_SEP.access.outcome === "allowed" ? DAD_SEP.access.draftsExcludedForPrincipal : 0,
})

function dayOf(view: MonthHistoryView, dateKey: string): DayCellView {
  const day = view.days.find((candidate) => candidate.dateKey === dateKey)
  if (!day) throw new Error(`view ${view.monthKey}/${view.timeZone} has no day ${dateKey}`)
  return day
}

const towerEntry = ENTRIES.find((entry) => entry._id === ENTRY_IDS.tower)
const momDraftEntry = ENTRIES.find((entry) => entry._id === ENTRY_IDS.draftMom)
if (!towerEntry || !momDraftEntry) throw new Error("fixture dataset is missing pinned entries")

// Two-step correction chain (MOM then DAD), deliberately listed out of order
// to prove lineage ordering is deterministic.
const CHAIN_CORRECTIONS: readonly CorrectionRecord[] = [
  {
    correctionId: "co_chain_2",
    originalEntryId: ENTRY_IDS.tower,
    correctedBy: DAD,
    createdAtMs: SEP27_CORRECTION + 60_000,
    replacementTranscript: "Second correction pass.",
    supersedesCorrectionId: "co_chain_1",
  },
  {
    correctionId: "co_chain_1",
    originalEntryId: ENTRY_IDS.tower,
    correctedBy: MOM,
    createdAtMs: SEP27_CORRECTION,
    replacementTranscript: "First correction pass.",
  },
]

// --- J1: parent-retrieval ----------------------------------------------------

const J1_CHECKS: readonly JourneyCheck[] = [
  {
    id: "J1-A1",
    journey: "parent-retrieval",
    claim: "Household member passes the fail-closed timeline gate for the month view",
    run: () => check(MOM_SEP.access.outcome === "allowed", `momAccess.outcome: ${MOM_SEP.access.outcome}`),
  },
  {
    id: "J1-A2",
    journey: "parent-retrieval",
    claim: "Sparse month: 30 explicit day cells, 25 gap days, honest gap copy and totals",
    run: () => {
      const view = MOM_SEP.view
      const ok =
        view.days.length === 30 &&
        view.gap.kind === "gaps" &&
        view.gap.gapDays.length === 25 &&
        view.gap.message === "25 of 30 days have no entries recorded. Gaps in the journal are not evidence about care." &&
        view.totalEntries === 5 &&
        view.totalEvents === 6 &&
        view.lateEvents === 1 &&
        view.correctedEntries === 1 &&
        view.orphanEventCount === 0
      return check(
        ok,
        `days=${view.days.length} gapDays=${view.gap.gapDays.length} kind=${view.gap.kind} entries=${view.totalEntries} events=${view.totalEvents} late=${view.lateEvents} corrected=${view.correctedEntries} orphans=${view.orphanEventCount} message="${view.gap.message}"`,
      )
    },
  },
  {
    id: "J1-A3",
    journey: "parent-retrieval",
    claim: "Late entry lands on the CARE day (Sep 12) with explicit capture attribution",
    run: () => {
      const day = dayOf(MOM_SEP.view, "2026-09-12")
      const event = day.events[0]
      if (!event) return check(false, "Sep 12 has no event card")
      return check(
        day.state === "has-entries" &&
          event.eventId === EVENT_IDS.napLate &&
          event.isLate === true &&
          event.localTimeLabel === "10:00 AM" &&
          event.captureDateKey === "2026-09-20" &&
          event.lateLabel === "Recorded Sunday, September 20, 2026 — about Saturday, September 12, 2026" &&
          event.captureLabel === "Captured Sunday, September 20, 2026 at 8:14 AM" &&
          event.authorName === "Mom" &&
          event.a11yLabel ===
            "sleep, 10:00 AM, recorded by Mom. Captured Sunday, September 20, 2026 at 8:14 AM.",
        `day=${day.dateKey} state=${day.state} isLate=${event.isLate} lateLabel="${String(event.lateLabel)}" a11y="${event.a11yLabel}"`,
      )
    },
  },
  {
    id: "J1-A4",
    journey: "parent-retrieval",
    claim: "Failed extraction still surfaces on the capture day — raw note preserved, never blocked",
    run: () => {
      const day = dayOf(MOM_SEP.view, "2026-09-20")
      const entry = day.entries[0]
      if (!entry) return check(false, "Sep 20 has no entry card")
      return check(
        day.state === "has-entries" &&
          entry.entryId === ENTRY_IDS.failed &&
          entry.extractionStatus === "failed" &&
          entry.extractionStatusLabel === EXTRACTION_FAILED_LABEL &&
          entry.transcript === "She napped 45 minutes after lunch." &&
          day.events.length === 0,
        `state=${day.state} status=${entry.extractionStatus} label="${String(entry.extractionStatusLabel)}" transcript="${entry.transcript}"`,
      )
    },
  },
  {
    id: "J1-A5",
    journey: "parent-retrieval",
    claim: "Gap-day copy says 'No entries recorded' and NEVER implies no care happened",
    run: () => {
      const day = dayOf(MOM_SEP.view, "2026-09-03")
      return check(
        day.state === "no-entries" &&
          day.a11yLabel === "Thursday, September 3, 2026. No entries recorded." &&
          MOM_SEP.view.gap.disclaimer === GAP_DISCLAIMER,
        `label="${day.a11yLabel}" disclaimer="${MOM_SEP.view.gap.disclaimer}"`,
      )
    },
  },
  {
    id: "J1-A6",
    journey: "parent-retrieval",
    claim: "Draft isolation: Mom sees her own draft (and its event), never Ana's",
    run: () => {
      const momDraftDay = dayOf(MOM_SEP.view, "2026-09-25")
      const anaDraftDay = dayOf(MOM_SEP.view, "2026-09-26")
      const entry = momDraftDay.entries[0]
      return check(
        momDraftDay.state === "has-entries" &&
          entry?.entryId === ENTRY_IDS.draftMom &&
          entry?.visibility === "draft" &&
          momDraftDay.events[0]?.eventId === EVENT_IDS.moodDraft &&
          anaDraftDay.state === "no-entries",
        `sep25=${momDraftDay.state}(${String(entry?.entryId)}) sep26=${anaDraftDay.state}`,
      )
    },
  },
  {
    id: "J1-A7a",
    journey: "parent-retrieval",
    claim: "Month boundary: 23:50 EDT stays in NY September, OUT of NY October, IN Kolkata October",
    run: () => {
      const view = MOM_OCT_NY.view
      const allEvents = view.days.flatMap((day) => day.events)
      const sep30 = dayOf(MOM_SEP.view, "2026-09-30")
      const sep30Ok =
        sep30.events.length === 1 &&
        sep30.events[0]?.eventId === EVENT_IDS.sep30Boundary &&
        sep30.entries[0]?.entryId === ENTRY_IDS.sep30Boundary
      return check(
        view.days.length === 31 &&
          view.days[0]?.dateKey === "2026-10-01" &&
          view.totalEvents === 1 &&
          allEvents.some((event) => event.eventId === EVENT_IDS.oct1Boundary) &&
          allViewsNoEvent(allEvents, EVENT_IDS.sep30Boundary) &&
          sep30Ok,
        `octDays=${view.days.length} octEvents=${view.totalEvents} sep30HasBoundaryEvent=${sep30.events.length === 1} sep30HasBoundaryEntry=${sep30.entries[0]?.entryId === ENTRY_IDS.sep30Boundary}`,
      )
    },
  },
  {
    id: "J1-A7b",
    journey: "parent-retrieval",
    claim: "Timezone dependence: the SAME instant sits inside a Kolkata-October view",
    run: () => {
      const view = MOM_OCT_IST.view
      const oct1 = dayOf(view, "2026-10-01")
      const eventIds = oct1.events.map((event) => event.eventId)
      return check(
        view.days.length === 31 && view.totalEvents === 2 && eventIds.length === 2 && eventIds.includes(EVENT_IDS.sep30Boundary) && eventIds.includes(EVENT_IDS.oct1Boundary),
        `days=${view.days.length} totalEvents=${view.totalEvents} oct1=[${eventIds.join(", ")}]`,
      )
    },
  },
  {
    id: "J1-A8",
    journey: "parent-retrieval",
    claim: "DST fall-back: both 1:30 AM events stay on Nov 1; the month is 721 hours long",
    run: () => {
      const view = MOM_NOV_NY.view
      const day = dayOf(view, "2026-11-01")
      const [first, second] = day.events
      const hourSpan = view.bounds.endMsExclusive - view.bounds.startMs
      return check(
        day.events.length === 2 &&
          first?.localTimeLabel === "1:30 AM" &&
          second?.localTimeLabel === "1:30 AM" &&
          first?.eventId === EVENT_IDS.sleepEdt &&
          second?.eventId === EVENT_IDS.sleepEst &&
          first?.localDateKey === "2026-11-01" &&
          second?.localDateKey === "2026-11-01" &&
          hourSpan === 721 * 60 * 60_000 &&
          view.days.length === 30,
        `events=${day.events.length} labels=[${String(first?.localTimeLabel)}, ${String(second?.localTimeLabel)}] hours=${hourSpan / (60 * 60_000)} days=${view.days.length}`,
      )
    },
  },
  {
    id: "J1-A9",
    journey: "parent-retrieval",
    claim: "Corrected entry shows the corrected text WITH lineage: who, when, reason, original preserved",
    run: () => {
      const day = dayOf(MOM_SEP.view, "2026-09-02")
      const entry = day.entries[0]
      if (!entry) return check(false, "Sep 2 has no entry card")
      const step = entry.correctionLineage?.steps[0]
      return check(
        entry.corrected === true &&
          entry.transcript === CORRECTED_TOWER_TRANSCRIPT &&
          step?.byName === "Dad" &&
          step?.createdAtLabel === "Sunday, September 27, 2026 at 10:00 AM" &&
          typeof step?.reason === "string" &&
          step.reason.length > 0 &&
          entry.correctionLineage?.originalPreservedLabel === CORRECTION_ORIGINAL_PRESERVED_LABEL,
        `corrected=${entry.corrected} by=${String(step?.byName)} when="${String(step?.createdAtLabel)}"`,
      )
    },
  },
  {
    id: "J1-A10",
    journey: "parent-retrieval",
    claim: "Raw capture preserved byte-for-byte in the dataset — projections never mutate it",
    run: () =>
      check(
        towerEntry.rawTranscript === ORIGINAL_TOWER_TRANSCRIPT &&
          JSON.stringify({ entries: ENTRIES, events: EVENTS }) === DATASET_SNAPSHOT,
        `towerRawIntact=${towerEntry.rawTranscript === ORIGINAL_TOWER_TRANSCRIPT} datasetUnchanged=${JSON.stringify({ entries: ENTRIES, events: EVENTS }) === DATASET_SNAPSHOT}`,
      ),
  },
  {
    id: "J1-A11",
    journey: "parent-retrieval",
    claim: "Quiet text input contract: correction fields never mutate or fight the typist",
    run: () =>
      eq(
        { ...QUIET_TEXT_INPUT },
        {
          autoCorrect: false,
          autoCapitalize: "none",
          spellCheck: false,
          autoFocus: false,
          keyboardType: "default",
          multiline: true,
          blurOnSubmit: false,
          textContentType: "none",
        },
        "QUIET_TEXT_INPUT",
      ),
  },
  {
    id: "J1-A12",
    journey: "parent-retrieval",
    claim: "Large text: body font scaling uncapped, chrome capped at 1.5, no fixed heights, no truncation",
    run: () =>
      check(
        FONT_SCALING.body.allowFontScaling === true &&
          FONT_SCALING.body.maxFontSizeMultiplier === null &&
          FONT_SCALING.chrome.allowFontScaling === true &&
          FONT_SCALING.chrome.maxFontSizeMultiplier === 1.5 &&
          LAYOUT_POLICY.fixedHeightsOnTextRows === false &&
          LAYOUT_POLICY.truncatesEntryText === false &&
          LAYOUT_POLICY.expandAffordanceLabel === "Show full text",
        `body=${JSON.stringify(FONT_SCALING.body)} chrome=${JSON.stringify(FONT_SCALING.chrome)} layout=${JSON.stringify(LAYOUT_POLICY)}`,
      ),
  },
  {
    id: "J1-A13",
    journey: "parent-retrieval",
    claim: "Every day cell exposes role=button, a hint, and a screen-reader label; month header labeled",
    run: () => {
      const structural = MOM_SEP.view.days.every(
        (day) => day.a11yRole === "button" && day.a11yHint === DAY_CELL_A11Y_HINT && day.a11yLabel.length > 0,
      )
      return check(structural && MOM_SEP.view.headerA11yLabel === "Month history: September 2026", `header="${MOM_SEP.view.headerA11yLabel}" allDaysLabeled=${structural}`)
    },
  },
  {
    id: "J1-A14",
    journey: "parent-retrieval",
    claim: "Empty month says 'no entries were recorded' + disclaimer — never 'no care'",
    run: () =>
      check(
        EMPTY_SEP.gap.kind === "empty-month" &&
          EMPTY_SEP.gap.message === `No entries were recorded this month. ${GAP_DISCLAIMER}` &&
          EMPTY_SEP.gap.gapDays.length === 30 &&
          EMPTY_SEP.totalEntries === 0,
        `message="${EMPTY_SEP.gap.message}" gapDays=${EMPTY_SEP.gap.gapDays.length}`,
      ),
  },
]

// --- J2: parent-correction ---------------------------------------------------

const J2_CHECKS: readonly JourneyCheck[] = [
  {
    id: "J2-B1",
    journey: "parent-correction",
    claim: "Household member may correct a PUBLISHED entry (shared policy, write action)",
    run: () => check(correctionAccess(DAD_PRINCIPAL, SCOPE, towerEntry).outcome === "ALLOW", `dadCorrection=${correctionAccess(DAD_PRINCIPAL, SCOPE, towerEntry).outcome}`),
  },
  {
    id: "J2-B2",
    journey: "parent-correction",
    claim: "Lineage is append-only and deterministic: sorted chain, supersedes must be ordered",
    run: () => {
      const lineage = buildLineageFrom(CHAIN_CORRECTIONS)
      const chain = lineage.get(ENTRY_IDS.tower)?.chain ?? []
      return check(
        chain.length === 2 && chain[0]?.correctionId === "co_chain_1" && chain[1]?.correctionId === "co_chain_2",
        `chain=[${chain.map((c) => c.correctionId).join(", ")}]`,
      )
    },
  },
  {
    id: "J2-B3",
    journey: "parent-correction",
    claim: "Correction is disclosed to screen readers: on the entry and every event of it",
    run: () => {
      const day = dayOf(MOM_SEP.view, "2026-09-02")
      const entry = day.entries[0]
      return check(
        typeof entry?.a11yLabel === "string" &&
          entry.a11yLabel.includes("Corrected entry.") &&
          day.events.every((event) => event.a11yLabel.includes("Includes a correction.")),
        `entryA11y="${String(entry?.a11yLabel)}"`,
      )
    },
  },
  {
    id: "J2-B4",
    journey: "parent-correction",
    claim: "Drafts are author-only even for corrections; anonymous principals are denied outright",
    run: () => {
      const anaOnMomsDraft = correctionAccess(ANA_PRINCIPAL, SCOPE, momDraftEntry)
      const anonOnPublished = correctionAccess(ANON_PRINCIPAL, SCOPE, towerEntry)
      const momOwnDraft = correctionAccess(MOM_PRINCIPAL, SCOPE, momDraftEntry)
      return check(
        anaOnMomsDraft.outcome === "DENY" &&
          anaOnMomsDraft.code === "DENY_DRAFT_AUTHOR_ONLY" &&
          anonOnPublished.outcome === "DENY" &&
          anonOnPublished.code === "DENY_ANONYMOUS" &&
          momOwnDraft.outcome === "ALLOW",
        `ana=${anaOnMomsDraft.outcome === "DENY" ? anaOnMomsDraft.code : "ALLOW"} anon=${anonOnPublished.outcome === "DENY" ? anonOnPublished.code : "ALLOW"} mom=${momOwnDraft.outcome}`,
      )
    },
  },
  {
    id: "J2-B5",
    journey: "parent-correction",
    claim: "Attribution is server-bound: a write claiming another author's id is denied",
    run: () => {
      const decision = evaluateAccess(DAD_PRINCIPAL, { type: "write", asAuthorId: MOM }, { kind: "entry", scope: SCOPE, entry: toPolicyEntry(towerEntry) })
      return check(decision.outcome === "DENY" && decision.code === "DENY_ATTRIBUTION_MISMATCH", `decision=${decision.outcome}${decision.outcome === "DENY" ? `/${decision.code}` : ""}`)
    },
  },
  {
    id: "J2-B6",
    journey: "parent-correction",
    claim: "Non-member is denied the whole month view at the timeline gate (fail-closed)",
    run: () => {
      const outsider = monthAccess(OUTSIDER_PRINCIPAL, SCOPE, ENTRIES)
      const anon = monthAccess(ANON_PRINCIPAL, SCOPE, ENTRIES)
      return check(
        outsider.outcome === "denied" && outsider.code === "DENY_NO_HOUSEHOLD_PATH" && anon.outcome === "denied" && anon.code === "DENY_ANONYMOUS",
        `outsider=${outsider.outcome === "denied" ? outsider.code : "allowed"} anon=${anon.outcome === "denied" ? anon.code : "allowed"}`,
      )
    },
  },
]

// --- J3: caregiver-handoff ---------------------------------------------------

const J3_CHECKS: readonly JourneyCheck[] = [
  {
    id: "J3-C1",
    journey: "caregiver-handoff",
    claim: "Handoff is built from the RECEIVER's authorization: published-only for Dad",
    run: () => {
      const access = DAD_SEP.access
      const allPublished = access.outcome === "allowed" && access.visible.every((entry) => entry.visibility === "published")
      return check(
        access.outcome === "allowed" &&
          access.visible.length === 6 &&
          allPublished &&
          access.draftsExcludedForPrincipal === 2 &&
          DAD_SEP.view.totalEntries === 4,
        `visible=${access.outcome === "allowed" ? access.visible.length : "denied"} allPublished=${allPublished} excluded=${access.outcome === "allowed" ? access.draftsExcludedForPrincipal : "n/a"} sepEntries=${DAD_SEP.view.totalEntries}`,
      )
    },
  },
  {
    id: "J3-C2",
    journey: "caregiver-handoff",
    claim: "Digest lines cover exactly the receiver-visible days with deterministic summaries",
    run: () => {
      const dates = DAD_HANDOFF.lines.map((line) => line.dateKey)
      const sep2 = DAD_HANDOFF.lines.find((line) => line.dateKey === "2026-09-02")
      const sep12 = DAD_HANDOFF.lines.find((line) => line.dateKey === "2026-09-12")
      const sep20 = DAD_HANDOFF.lines.find((line) => line.dateKey === "2026-09-20")
      const sep30 = DAD_HANDOFF.lines.find((line) => line.dateKey === "2026-09-30")
      return check(
        eq(dates, ["2026-09-02", "2026-09-12", "2026-09-20", "2026-09-30"], "dates").ok &&
          sep2?.summary === "2× potty, 1× milestone" &&
          sep12?.summary === "1× sleep (45 min)" &&
          sep20?.summary === "1 note recorded; no structured events. Extraction failed for 1 note — raw text preserved." &&
          sep30?.summary === "1× potty",
        `dates=${JSON.stringify(dates)} sep2="${String(sep2?.summary)}" sep12="${String(sep12?.summary)}" sep30="${String(sep30?.summary)}"`,
      )
    },
  },
  {
    id: "J3-C3",
    journey: "caregiver-handoff",
    claim: "Every handoff line is source-linked (no claim without its capture)",
    run: () => {
      const sep12 = DAD_HANDOFF.lines.find((line) => line.dateKey === "2026-09-12")
      return check(
        DAD_HANDOFF.lines.every((line) => line.sourceEntryIds.length > 0) &&
          eq(sep12?.sourceEntryIds, [ENTRY_IDS.napLate], "sep12.sources").ok,
        `allLinked=${DAD_HANDOFF.lines.every((line) => line.sourceEntryIds.length > 0)} sep12=${JSON.stringify(sep12?.sourceEntryIds)}`,
      )
    },
  },
  {
    id: "J3-C4",
    journey: "caregiver-handoff",
    claim: "Corrections surface in the handoff with attribution to the correcting caregiver",
    run: () => {
      const sep2 = DAD_HANDOFF.lines.find((line) => line.dateKey === "2026-09-02")
      return check(
        eq(sep2?.correctedEntryIds, [ENTRY_IDS.tower], "sep2.corrected").ok && sep2?.authors.includes("Mom") === true,
        `corrected=${JSON.stringify(sep2?.correctedEntryIds)} authors=${JSON.stringify(sep2?.authors)}`,
      )
    },
  },
  {
    id: "J3-C5",
    journey: "caregiver-handoff",
    claim: "Excluded drafts are disclosed as a COUNT, never as content",
    run: () =>
      check(
        DAD_HANDOFF.excludedDraftCount === 2 &&
          DAD_HANDOFF.excludedDraftNote === "2 draft entries are not included in this handoff (visible only to their authors).",
        `note="${DAD_HANDOFF.excludedDraftNote}"`,
      ),
  },
  {
    id: "J3-C6",
    journey: "caregiver-handoff",
    claim: "Gap disclosure: 26 of 30 days have nothing recorded, stated honestly",
    run: () =>
      check(
        DAD_HANDOFF.gapDays.length === 26 &&
          DAD_HANDOFF.gapStatement === "26 of 30 days have no entries recorded. Gaps in the journal are not evidence about care.",
        `gapDays=${DAD_HANDOFF.gapDays.length} statement="${DAD_HANDOFF.gapStatement}"`,
      ),
  },
  {
    id: "J3-C7",
    journey: "caregiver-handoff",
    claim: "Digest carries audience, preparer metadata, and the source-preservation disclaimer",
    run: () =>
      check(
        DAD_HANDOFF.audience === "published-only" &&
          DAD_HANDOFF.preparedByName === "Mom" &&
          DAD_HANDOFF.preparedForName === "Dad" &&
          DAD_HANDOFF.sourceDisclaimer ===
            "Every line links to its source entries; raw transcripts are preserved verbatim. Gaps in the journal are not evidence about care.",
        `audience=${DAD_HANDOFF.audience} from=${String(DAD_HANDOFF.preparedByName)} to=${String(DAD_HANDOFF.preparedForName)}`,
      ),
  },
]

function allViewsHasEvent(events: readonly { readonly eventId: string }[], eventId: string): boolean {
  return events.some((event) => event.eventId === eventId)
}
function allViewsNoEvent(events: readonly { readonly eventId: string }[], eventId: string): boolean {
  return !allViewsHasEvent(events, eventId)
}

export const JOURNEY_CHECKS: readonly JourneyCheck[] = [...J1_CHECKS, ...J2_CHECKS, ...J3_CHECKS]
