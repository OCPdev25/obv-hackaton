/**
 * Source-linked caregiver handoff digest — deterministic projection of a
 * receiver-authorized month view. The digest is built from the RECEIVER'S
 * view (run monthAccess for the receiving principal first): it can only ever
 * contain what the receiver may see, and it DISCLOSES what was excluded
 * (draft counts — never content) plus every day with nothing recorded.
 */
import type { EventCategory } from "@journal/domain"
import { GAP_DISCLAIMER } from "./a11y.js"
import type { MonthHistoryView } from "./types.js"

const CATEGORY_ORDER: readonly EventCategory[] = ["potty", "meal", "sleep", "mood", "milestone", "school"]

function payloadSummary(payload: Readonly<Record<string, number>>): string {
  return Object.entries(payload)
    .map(([key, value]) => (key === "minutes" ? `${value} min` : `${key} ${value}`))
    .join(", ")
}

/** "2× potty, 1× sleep (45 min)" — canonical category order, view order within. */
export function daySummary(events: readonly { readonly category: EventCategory; readonly payload?: Readonly<Record<string, number>> }[]): string {
  const parts: string[] = []
  for (const category of CATEGORY_ORDER) {
    const forCategory = events.filter((event) => event.category === category)
    if (forCategory.length === 0) continue
    const payloads = forCategory.filter((event) => event.payload !== undefined).map((event) => payloadSummary(event.payload as Readonly<Record<string, number>>))
    const payloadPart = payloads.length > 0 ? ` (${payloads.join(", ")})` : ""
    parts.push(`${forCategory.length}× ${category}${payloadPart}`)
  }
  return parts.length > 0 ? parts.join(", ") : "No structured events."
}

export interface HandoffDigestLine {
  readonly dateKey: string
  readonly dayLabel: string
  readonly summary: string
  /** Source entries behind this line — every claim links to its capture. */
  readonly sourceEntryIds: readonly string[]
  readonly extractionFailedEntryIds: readonly string[]
  readonly correctedEntryIds: readonly string[]
  /** Display names of the authors recorded on this day, first-appearance order. */
  readonly authors: readonly string[]
}

export interface HandoffDigest {
  readonly monthKey: string
  readonly monthLabel: string
  readonly audience: "published-only"
  readonly preparedByName?: string
  readonly preparedForName?: string
  readonly lines: readonly HandoffDigestLine[]
  readonly gapDays: readonly string[]
  readonly gapStatement: string
  /** Drafts the receiver cannot see — disclosed as a count, never as content. */
  readonly excludedDraftCount: number
  readonly excludedDraftNote: string
  readonly sourceDisclaimer: string
}

export function buildHandoffDigest(
  view: MonthHistoryView,
  options: {
    readonly preparedByName?: string
    readonly preparedForName?: string
    /** Drafts in scope the receiving principal cannot see (access adapter's count). */
    readonly excludedDraftCount: number
  },
): HandoffDigest {
  const lines: HandoffDigestLine[] = []
  for (const day of view.days) {
    if (day.state !== "has-entries") continue
    const extractionFailedEntryIds = day.entries.filter((entry) => entry.extractionStatus === "failed").map((entry) => entry.entryId)
    let summary = daySummary(day.events)
    if (day.events.length === 0) {
      summary = `${day.entryCount} ${day.entryCount === 1 ? "note" : "notes"} recorded; no structured events.`
    }
    if (extractionFailedEntryIds.length > 0) {
      summary += ` Extraction failed for ${extractionFailedEntryIds.length === 1 ? "1 note" : `${extractionFailedEntryIds.length} notes`} — raw text preserved.`
    }
    const authors: string[] = []
    for (const entry of day.entries) {
      if (!authors.includes(entry.authorName)) authors.push(entry.authorName)
    }
    lines.push({
      dateKey: day.dateKey,
      dayLabel: day.dayLabel,
      summary,
      sourceEntryIds: day.entries.map((entry) => entry.entryId),
      extractionFailedEntryIds,
      correctedEntryIds: day.entries.filter((entry) => entry.corrected).map((entry) => entry.entryId),
      authors,
    })
  }
  const excludedDraftNote =
    options.excludedDraftCount === 0
      ? ""
      : options.excludedDraftCount === 1
        ? "1 draft entry is not included in this handoff (visible only to its author)."
        : `${options.excludedDraftCount} draft entries are not included in this handoff (visible only to their authors).`
  return {
    monthKey: view.monthKey,
    monthLabel: view.monthLabel,
    audience: "published-only",
    preparedByName: options.preparedByName,
    preparedForName: options.preparedForName,
    lines,
    gapDays: view.gap.gapDays,
    gapStatement: view.gap.message,
    excludedDraftCount: options.excludedDraftCount,
    excludedDraftNote,
    sourceDisclaimer: `Every line links to its source entries; raw transcripts are preserved verbatim. ${GAP_DISCLAIMER}`,
  }
}
