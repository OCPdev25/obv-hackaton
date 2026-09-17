/**
 * View-model types for the month-history surface. UI-free and renderer-free:
 * the React Native prototype (apps/mobile/src/month/MonthHistoryScreen.tsx)
 * consumes these values and maps them onto RN accessibility, text-scaling,
 * and input props one-to-one. Everything here is data — no effects, no
 * clock, no I/O.
 */
import type { EventCategory } from "@journal/domain"
import type { ZonedMonthBounds } from "./zone.js"

export type EntryVisibilityKind = "draft" | "published"
export type ExtractionStatusKind = "pending" | "structured" | "failed"

/** Structural input — the canonical source is the domain EntryDocument. */
export interface EntryViewInput {
  readonly entryId: string
  readonly householdId: string
  readonly childId: string
  readonly authorId: string
  readonly rawTranscript: string
  readonly structuredEventIds: readonly string[]
  readonly extractionStatus: ExtractionStatusKind
  readonly visibility: EntryVisibilityKind
  readonly createdAt: number
}

/** Structural input — the canonical source is the domain EventDocument. */
export interface EventViewInput {
  readonly eventId: string
  readonly householdId: string
  readonly childId: string
  readonly category: EventCategory
  readonly timestamp: number
  readonly payload?: Readonly<Record<string, number>>
  readonly confidence: number
}

export interface EventCardView {
  readonly eventId: string
  readonly category: EventCategory
  readonly occurredAtMs: number
  /** Household-zone local date the event belongs to (the bucketing key). */
  readonly localDateKey: string
  readonly localTimeLabel: string
  readonly payload?: Readonly<Record<string, number>>
  readonly confidence: number
  readonly authorId: string
  readonly authorName: string
  readonly entryId: string
  readonly captureDateKey: string
  /** "Captured Sunday, September 20, 2026 at 8:14 AM" — always shown. */
  readonly captureLabel: string
  /** Entry captured on a later local date than the event's care date. */
  readonly isLate: boolean
  /** "Recorded Sunday, September 20, 2026 — about Saturday, September 12, 2026". */
  readonly lateLabel?: string
  readonly corrected: boolean
  readonly a11yLabel: string
}

export interface CorrectionStepView {
  readonly correctionId: string
  readonly byName: string
  readonly createdAtMs: number
  readonly createdAtLabel: string
  readonly reason?: string
  readonly supersedesCorrectionId?: string
}

export interface CorrectionLineageView {
  readonly originalEntryId: string
  readonly steps: readonly CorrectionStepView[]
  readonly latestTranscript: string
  /** Always carried by corrected entries — the original is never destroyed. */
  readonly originalPreservedLabel: string
}

export interface EntryCardView {
  readonly entryId: string
  readonly authorId: string
  readonly authorName: string
  readonly visibility: EntryVisibilityKind
  /** Verbatim raw transcript (the latest corrected text when a correction applies). */
  readonly transcript: string
  readonly captureDateKey: string
  readonly captureLabel: string
  readonly extractionStatus: ExtractionStatusKind
  /** Present when extraction failed — says the raw note is preserved, never blocks. */
  readonly extractionStatusLabel?: string
  readonly corrected: boolean
  readonly correctionLineage?: CorrectionLineageView
  readonly a11yLabel: string
}

export interface DayCellView {
  readonly dateKey: string
  readonly dayLabel: string
  readonly entryCount: number
  readonly eventCount: number
  readonly state: "has-entries" | "no-entries"
  readonly events: readonly EventCardView[]
  readonly entries: readonly EntryCardView[]
  readonly a11yLabel: string
  readonly a11yRole: "button"
  readonly a11yHint: string
}

export interface MonthGapStatement {
  readonly kind: "empty-month" | "gaps" | "no-gaps"
  readonly message: string
  readonly gapDays: readonly string[]
  readonly disclaimer: string
}

export interface MonthHistoryView {
  readonly monthKey: string
  readonly timeZone: string
  readonly monthLabel: string
  readonly headerA11yLabel: string
  readonly bounds: ZonedMonthBounds
  /** Every calendar day of the month, in order — gap days are explicit cells. */
  readonly days: readonly DayCellView[]
  /** Entries the principal can see in this month's scope. */
  readonly totalEntries: number
  readonly totalEvents: number
  readonly lateEvents: number
  readonly correctedEntries: number
  /** Events in the month no entry in scope claims — surfaced, never hidden. */
  readonly orphanEventCount: number
  readonly gap: MonthGapStatement
}

export interface BuildMonthHistoryInput {
  readonly monthKey: string
  /** IANA zone of the household — the bucketing reference, never the viewer's device zone. */
  readonly timeZone: string
  /** ALREADY AUTHORIZED entries — run the access filter before building a view. */
  readonly entries: readonly EntryViewInput[]
  readonly events: readonly EventViewInput[]
  readonly corrections?: readonly CorrectionInput[]
  /** authorId → display name ("Mom", "Dad", "Ana"). Unmapped ids fall back to the id. */
  readonly authors: Readonly<Record<string, string>>
  /**
   * Every entry in the child's scope, visible or not — the claim universe.
   * Events whose claiming entry is in scope but invisible to this principal
   * are excluded from the view WITHOUT counting as orphans; orphans are
   * events no entry in scope claims. Defaults to the authorized entries.
   */
  readonly scopeEntries?: readonly EntryViewInput[]
}

export type CorrectionInput = import("./corrections.js").CorrectionRecord
