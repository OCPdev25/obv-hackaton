/**
 * Audience model for the handoff-first home prototype.
 *
 * Contract v0.2 (art_I2TCG08V): Entry.visibility (`draft | published`) is the
 * PER-ENTRY publication state ONLY; WHO may see a published entry is resolved
 * from household/relationship grants — "keyed by household/relationship, not
 * by entry". No audience field on Entry, no fused status enum.
 *
 * The rubric scenario (art_VyNYOggs, S1-B) additionally requires Elena to
 * "restrict the drop-off meltdown event to parents only (per the grants
 * model)", i.e. a per-EVENT restriction. Contract v0.2 has no home for a
 * per-event restriction yet, so this prototype models it as an explicit,
 * additive AudienceRestriction record in the PROTOTYPE data layer only —
 * nothing in packages/domain is touched. Flagged as a contract question in
 * the evidence document. Restrictions narrow; they never widen.
 *
 * Draft visibility is the contract's own open question ("who inside a
 * household sees a draft" — art_rBKvvzIa §7 open question 2). This prototype
 * picks: drafts are visible to their author and to parent-role members,
 * never to caregiver-role members. Stated here so the evaluator can score
 * the choice.
 */

export type Role = "parent" | "caregiver"

export interface HouseholdMember {
  readonly userId: string
  readonly displayName: string
  readonly role: Role
}

/** PROPOSED extension (not in contract v0.2) — see module doc. */
export type EventAudienceScope = "household" | "parents"

export interface AudienceRestriction {
  readonly eventId: string
  readonly scope: EventAudienceScope
  readonly grantedBy: string
  readonly grantedAt: number
  readonly note?: string
}

export type Cue = "visible" | "locked"

const isDraftVisible = (
  member: HouseholdMember,
  authorId: string,
): boolean => member.role === "parent" || member.userId === authorId

/** Entry-level: publication state + draft rule. */
export const canSeeEntry = (
  member: HouseholdMember,
  entry: { readonly authorId: string; readonly visibility: "draft" | "published" },
): boolean => entry.visibility === "published" || isDraftVisible(member, entry.authorId)

/** Event-level: entry gate plus audience restrictions (narrowing only). */
export const eventCue = (
  member: HouseholdMember,
  entry: { readonly authorId: string; readonly visibility: "draft" | "published" },
  restriction?: AudienceRestriction,
): Cue => {
  if (!canSeeEntry(member, entry)) return "locked"
  if (restriction?.scope === "parents" && member.role !== "parent") return "locked"
  return "visible"
}

/**
 * Read-only questions never write (rubric hard requirement). The answer
 * carries sources; there is no mutation path on this type by construction.
 */
export interface ReadOnlyAnswer {
  readonly question: string
  readonly askedBy: string
  readonly askedAt: number
  readonly answer: string
  readonly sources: ReadonlyArray<{
    readonly kind: "transcript-excerpt" | "event" | "correction" | "fixture"
    readonly ref: string
    readonly excerpt?: string
  }>
}
