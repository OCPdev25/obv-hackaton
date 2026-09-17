/**
 * Accessibility contracts for the month-history surface, expressed as DATA.
 *
 * - Labels are deterministic strings built from the household-zone calendar;
 *   tests pin them exactly (en-US).
 * - Text scaling: body text NEVER caps font scaling (large-text users get the
 *   full OS text size); chrome may cap at 1.5 so grids stay legible. Layout
 *   policy forbids fixed heights on text rows (no clipping at large type)
 *   and forbids truncating entry text (an explicit expand affordance instead).
 * - Quiet text input: correction and note fields must not fight the person
 *   typing — no autocorrect/auto-capitalize/spellcheck mutations (child
 *   names, medications and dosages must survive verbatim), no focus steal,
 *   no submit-on-return surprise.
 *
 * These constants are the single source of truth for the RN prototype screen
 * and for the rubric checks; the screen maps them onto TextInput/Text/
 * Pressable props one-to-one.
 */
import { localTimeLabel } from "./zone.js"

export const QUIET_TEXT_INPUT = {
  autoCorrect: false,
  autoCapitalize: "none",
  spellCheck: false,
  autoFocus: false,
  keyboardType: "default",
  multiline: true,
  blurOnSubmit: false,
  textContentType: "none",
} as const

export type QuietTextInput = typeof QUIET_TEXT_INPUT

export const FONT_SCALING = {
  /** Journal text scales with the user's OS text size, uncapped. */
  body: { allowFontScaling: true, maxFontSizeMultiplier: null },
  /** Day numerals and other chrome: capped so the grid stays legible. */
  chrome: { allowFontScaling: true, maxFontSizeMultiplier: 1.5 },
} as const

export const LAYOUT_POLICY = {
  /** Text rows must not use fixed pixel heights (min-height only). */
  fixedHeightsOnTextRows: false,
  /** Entry text is never truncated; an expand affordance reveals the rest. */
  truncatesEntryText: false,
  expandAffordanceLabel: "Show full text",
} as const

export const A11Y_ROLES = {
  monthHeader: "header",
  dayCell: "button",
  entryText: "text",
} as const

export const NO_ENTRIES_LABEL = "No entries recorded"
/** The product-honesty line: an unrecorded day says nothing about care. */
export const GAP_DISCLAIMER = "Gaps in the journal are not evidence about care."
export const EXTRACTION_FAILED_LABEL = "Extraction failed — your original note is preserved verbatim."
export const CORRECTION_ORIGINAL_PRESERVED_LABEL = "The original note is preserved verbatim."
export const CORRECTION_INPUT_LABEL = "Correction text"
export const CORRECTION_INPUT_HINT = "Describe the correction. Your text is saved exactly as typed."
export const DAY_CELL_A11Y_HINT = "Opens the journal entries for this day."

export function monthHeaderA11yLabel(month: string): string {
  return `Month history: ${month}`
}

export interface DayCellA11yInput {
  readonly dayLabel: string
  readonly entryCount: number
  readonly eventCount: number
  readonly correctedCount: number
}

export function dayCellA11yLabel(input: DayCellA11yInput): string {
  const recorded =
    input.entryCount === 0
      ? `${NO_ENTRIES_LABEL}.`
      : input.entryCount === 1
        ? "1 entry recorded."
        : `${input.entryCount} entries recorded.`
  const events =
    input.eventCount > 0 ? (input.eventCount === 1 ? " 1 care event." : ` ${input.eventCount} care events.`) : ""
  const corrected = input.correctedCount > 0 ? " Includes a corrected entry." : ""
  return `${input.dayLabel}. ${recorded}${events}${corrected}`
}

export interface EventA11yInput {
  readonly category: string
  readonly localTimeLabel: string
  readonly authorName: string
  readonly isLate: boolean
  readonly captureLabel: string
  readonly corrected: boolean
}

export function eventA11yLabel(input: EventA11yInput): string {
  const base = `${input.category}, ${input.localTimeLabel}, recorded by ${input.authorName}.`
  const late = input.isLate ? ` ${input.captureLabel}.` : ""
  const corrected = input.corrected ? " Includes a correction." : ""
  return `${base}${late}${corrected}`
}

export interface EntryA11yInput {
  readonly authorName: string
  readonly captureLabel: string
  readonly transcript: string
  readonly corrected: boolean
}

export function entryA11yLabel(input: EntryA11yInput): string {
  const corrected = input.corrected ? " Corrected entry." : ""
  return `Note by ${input.authorName}. ${input.captureLabel}. ${previewForLabel(input.transcript)}${corrected}`
}

/** Label previews cap at 100 chars so screen-reader summaries stay listenable. */
export function previewForLabel(text: string): string {
  return text.length <= 100 ? text : `${text.slice(0, 100)}…`
}

export function captureLabel(instantMs: number, timeZone: string, fullDay: string): string {
  return `Captured ${fullDay} at ${localTimeLabel(instantMs, timeZone)}`
}

export function lateLabel(captureDayFull: string, occurrenceDayFull: string): string {
  return `Recorded ${captureDayFull} — about ${occurrenceDayFull}`
}
