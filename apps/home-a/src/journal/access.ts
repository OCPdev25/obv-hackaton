/**
 * Candidate-scope authorization for the conversation-first parent home.
 *
 * Mirrors the repo's fail-closed policy semantics (security/access/policy.ts,
 * merged PR #4): decisions are values, check order is fixed, and absent or
 * malformed data NEVER opens access. Deny codes are kept compatible so the
 * threat model's tests map 1:1.
 *
 * Candidate-scope simplification (documented in the evidence doc, final
 * modeling belongs to slot 20 / feat/audience-publication): audience is
 * resolved from relationship grants here, keyed by member role — never stored
 * on the domain Entry. `parents-only` entries are hidden from caregiver-role
 * members and from non-members entirely.
 */
import type { Entry } from "@journal/domain"

export type MemberRole = "parent" | "caregiver"

/** Known-member principal; anonymous principals have trust level zero. */
export type Principal =
  | { readonly kind: "member"; readonly memberId: string; readonly role: MemberRole; readonly householdIds: readonly string[] }
  | { readonly kind: "anonymous" }

export type DenyCode =
  | "DENY_ANONYMOUS"
  | "DENY_NO_HOUSEHOLD_PATH"
  | "DENY_DRAFT_AUTHOR_ONLY"
  | "DENY_ATTRIBUTION_MISMATCH"

export type Decision = { readonly outcome: "ALLOW" } | { readonly outcome: "DENY"; readonly code: DenyCode; readonly detail: string }

export type AccessAction =
  | { readonly type: "read" }
  /** Writes carry the authorId they want attributed; it is bound to the principal. */
  | { readonly type: "write"; readonly asAuthorId: string }

export interface AccessResource {
  readonly householdId: string
  readonly entry?: Entry | undefined
}

const deny = (code: DenyCode, detail: string): Decision => ({ outcome: "DENY", code, detail })

/** Single entry point for every household/visibility decision (fail-closed). */
export function decide(principal: Principal, action: AccessAction, resource: AccessResource): Decision {
  // 1. Authentication edge — known members only, no anonymous access.
  if (principal.kind === "anonymous") {
    return deny("DENY_ANONYMOUS", "unauthenticated principals have no household path (known members only)")
  }
  // 2. Household-membership boundary — the primary tenancy line.
  if (!principal.householdIds.includes(resource.householdId)) {
    return deny("DENY_NO_HOUSEHOLD_PATH", `member ${principal.memberId} is not a member of household ${resource.householdId}`)
  }
  // 3. Publication-state boundary — drafts (and their proposals) are author-only.
  if (resource.entry !== undefined && resource.entry.visibility === "draft" && resource.entry.authorId !== principal.memberId) {
    return deny("DENY_DRAFT_AUTHOR_ONLY", `entry is draft and authored by ${resource.entry.authorId}`)
  }
  // 4. Attribution integrity — writes may only attribute to the authenticated principal.
  if (action.type === "write" && action.asAuthorId !== principal.memberId) {
    return deny("DENY_ATTRIBUTION_MISMATCH", `write claims authorId=${action.asAuthorId} but principal is ${principal.memberId}`)
  }
  return { outcome: "ALLOW" }
}

/**
 * Does this member see an entry with the given (candidate-level) audience?
 * Audience is a relationship-grant resolution: parents see everything in the
 * household; caregivers see family-audience records only.
 */
export function canSeeAudience(role: MemberRole, audience: "family" | "parents-only"): boolean {
  return role === "parent" || audience === "family"
}
