/**
 * Fail-closed authorization for the Candidate B store — a faithful port of
 * security/access/policy.ts's five fixed-order checks, extended with the
 * audience dimension the candidate B review surface edits. Absent or malformed
 * data never opens access; decisions are values, never exceptions.
 *
 * The one extension vs security/access/policy.ts: published entries carry a
 * relationship-scoped audience intent ('household' | 'parents') stored in the
 * store's grants layer — deliberately NOT on the canonical Entry document
 * (contract v0.2 keeps publication state and audience independent). A caregiver
 * (non-parent) member is denied a 'parents' audience entry with
 * AUDIENCE_NOT_GRANTED; parents are never narrowed.
 */
import type { EntryDocument } from "@journal/domain"

export type Role = "parent" | "caregiver"

export interface CaregiverPrincipal {
  readonly kind: "caregiver"
  readonly caregiverId: string
  readonly name: string
  readonly role: Role
  /** Server-maintained roster fact — never inferred from a link or share. */
  readonly householdIds: readonly string[]
}

export interface AnonymousPrincipal {
  readonly kind: "anonymous"
}

export type Principal = CaregiverPrincipal | AnonymousPrincipal

/** Relationship-scoped disclosure intent, resolved where grants live (not on Entry). */
export type AudienceIntent = "household" | "parents"

export interface ChildScope {
  readonly childId: string
  readonly householdId: string
}

export type Resource =
  | { readonly kind: "childTimeline"; readonly scope: ChildScope }
  | { readonly kind: "entry"; readonly scope: ChildScope; readonly entry: EntryDocument; readonly audience: AudienceIntent }
  | { readonly kind: "entryEvents"; readonly scope: ChildScope; readonly entry: EntryDocument; readonly audience: AudienceIntent }

export type Action = { readonly type: "read" } | { readonly type: "write"; readonly asAuthorId: string }

export type DenyCode =
  | "DENY_ANONYMOUS"
  | "DENY_UNKNOWN_CHILD_SCOPE"
  | "DENY_NO_HOUSEHOLD_PATH"
  | "DENY_DRAFT_AUTHOR_ONLY"
  | "DENY_ATTRIBUTION_MISMATCH"
  | "DENY_AUDIENCE_NOT_GRANTED"

export type Decision = { readonly outcome: "ALLOW" } | { readonly outcome: "DENY"; readonly code: DenyCode; readonly detail: string }

/** A result tagged "Denied" always carries a DENY decision — never an ALLOW. */
export type DenyDecision = Extract<Decision, { readonly outcome: "DENY" }>

const deny = (code: DenyCode, detail: string): Decision => ({ outcome: "DENY", code, detail })

/**
 * Check order is fixed; the first failing check denies:
 *  1. ANONYMOUS — authentication edge; trust level zero.
 *  2. UNKNOWN_CHILD_SCOPE — scoping integrity; incomplete scope denies.
 *  3. NO_HOUSEHOLD_PATH — membership is the primary tenancy line.
 *  4. DRAFT_AUTHOR_ONLY — publication-state boundary; drafts are author-only.
 *  5. AUDIENCE_NOT_GRANTED — caregiver members are excluded from 'parents' audience.
 *  6. ATTRIBUTION_MISMATCH — writes may only attribute to the authenticated principal.
 */
export function evaluateAccess(principal: Principal, action: Action, resource: Resource): Decision {
  if (principal.kind === "anonymous") {
    return deny("DENY_ANONYMOUS", `unauthenticated principal cannot ${action.type} ${resource.kind}`)
  }

  const { childId, householdId } = resource.scope
  if (childId.length === 0 || householdId.length === 0) {
    return deny(
      "DENY_UNKNOWN_CHILD_SCOPE",
      `resource ${resource.kind} has incomplete child scope (childId=${childId || "<missing>"}, householdId=${householdId || "<missing>"})`,
    )
  }

  if (!principal.householdIds.includes(householdId)) {
    return deny(
      "DENY_NO_HOUSEHOLD_PATH",
      `child ${childId} is owned by household ${householdId}; caregiver ${principal.caregiverId} holds membership in [${principal.householdIds.join(", ") || "none"}]`,
    )
  }

  const entry = resource.kind === "childTimeline" ? undefined : resource.entry
  if (entry !== undefined && entry.visibility === "draft") {
    if (entry.authorId !== principal.caregiverId) {
      return deny(
        "DENY_DRAFT_AUTHOR_ONLY",
        `entry is draft and authored by ${entry.authorId}; caregiver ${principal.caregiverId} is a household member but not the author`,
      )
    }
  }

  if (resource.kind !== "childTimeline" && resource.entry.visibility === "published" && resource.audience === "parents" && principal.role !== "parent") {
    return deny(
      "DENY_AUDIENCE_NOT_GRANTED",
      `entry was published to the parents audience; caregiver ${principal.caregiverId} holds role ${principal.role}`,
    )
  }

  if (action.type === "write" && action.asAuthorId !== principal.caregiverId) {
    return deny(
      "DENY_ATTRIBUTION_MISMATCH",
      `write claims authorId=${action.asAuthorId} but authenticated principal is ${principal.caregiverId}`,
    )
  }

  return { outcome: "ALLOW" }
}
