/**
 * Gap-disclosure language and the care-neutral text guard.
 *
 * Hard rules enforced here:
 * - absence of logs must never read as absence of care — every gap statement
 *   says what the journal did NOT capture and explicitly refuses the neglect
 *   reading;
 * - no medical conclusions — the digest reports what was logged, never what
 *   it means, how it compares, or whether it is normal.
 *
 * The guard scope is deliberate: it applies to system-GENERATED language
 * (statements, questions, coverage notes, gap disclosures, routine-note
 * claims). It deliberately does NOT apply to verbatim transcript snippets —
 * quoting a human source is not drawing a conclusion. Family-profile notes
 * ARE guarded (they are endorsed by inclusion, and the composer fails loudly
 * rather than laundering interpretation through "routine context").
 */

/** Vocabulary that must never appear in system-generated digest language. */
export const FORBIDDEN_TOKENS = [
  // absence must not read as neglect
  "missed",
  "skipped",
  "not fed",
  "wasn't fed",
  "was not fed",
  "neglect",
  "unattended",
  "should have",
  "failed to",
  "inadequate",
  "lacks",
  "lack of",
  // no medical conclusions, comparisons, or severity
  "normal",
  "abnormal",
  "healthy",
  "unhealthy",
  "sick",
  "ill",
  "concerning",
  "concern",
  "worried",
  "worrying",
  "delayed",
  "delay",
  "regression",
  "regress",
  "doctor",
  "pediatrician",
  "paediatrician",
  "diagnos",
  "medication",
  "medicine",
  "dose",
  "dosage",
  "symptom",
  "fever",
] as const

/**
 * Throws if system-generated text carries neglect-reading or interpretation
 * vocabulary. Matching is word-start anchored with suffix tolerance
 * (`\b<token>\w*`), so stems catch their inflections ("diagnos" →
 * "diagnosed") while embedded substrings do not false-positive ("still"
 * must not trip "ill").
 */
const tokenPatternCache = FORBIDDEN_TOKENS.map(
  (token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`, "i"),
)

export const assertCareNeutral = (text: string): void => {
  const offenders = FORBIDDEN_TOKENS.filter((_, index) => tokenPatternCache[index]?.test(text) ?? false)
  if (offenders.length > 0) {
    throw new Error(`care-neutral guard violated by ${JSON.stringify(offenders)} in: ${JSON.stringify(text)}`)
  }
}

export const gapDayDisclosure = (day: string, childName: string): string =>
  `No entries were logged on ${day}. That is a gap in the journal, not a gap in ${childName}'s care — logging depends on someone opening the app.`

export const coverageZeroNote = (categoryLabel: string): string =>
  `No ${categoryLabel} events were logged in this window. That reflects what was captured, not what happened.`

export const coverageObservedNote = (observed: number, captureCount: number, categoryLabel: string): string =>
  `${observed} ${categoryLabel} ${observed === 1 ? "event" : "events"} logged across ${captureCount} ${captureCount === 1 ? "capture" : "captures"}.`

/** Follow-up answer when the window holds no matching capture. */
export const notLoggedForCategory = (categoryLabel: string): string =>
  `Nothing was logged for ${categoryLabel} in this window — that reflects what was captured, not what happened.`

export const notLoggedGeneric = (): string =>
  "Nothing matching that was logged in this window — that reflects what was captured, not what happened."
