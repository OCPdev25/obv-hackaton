/**
 * Fail-closed access policy for household membership & visibility.
 * Pure function: no I/O, no side effects, decisions are values (never exceptions).
 *
 * Evaluation order is fixed. The first failing check denies; every check must
 * pass for an ALLOW. Absent or malformed data NEVER opens access — it denies
 * (fail-closed). See THREAT-MODEL.md §Fail-closed rules.
 */
import type { Action, Decision, DenyCode, Principal, Resource } from './types'
import type { ChildScope } from './types'
import type { Entry } from './schema-mock'

function deny(code: DenyCode, detail: string): Decision {
  return { outcome: 'DENY', code, detail }
}

/**
 * Single entry point for every household/visibility decision.
 *
 * Check order:
 *  1. DENY_ANONYMOUS            — authentication edge; unauthenticated = trust level zero.
 *  2. DENY_UNKNOWN_CHILD_SCOPE  — scoping integrity; incomplete child scope denies.
 *  3. DENY_NO_HOUSEHOLD_PATH    — household-membership boundary; an explicit roster
 *                                 path from principal to the child's owning household.
 *  4. DENY_DRAFT_AUTHOR_ONLY    — publication-state boundary; drafts (and their
 *                                 extraction events) are author-only. Membership does
 *                                 not pierce drafts; publication never widens audience.
 *  5. DENY_ATTRIBUTION_MISMATCH — writes may only attribute to the authenticated principal.
 */
export function evaluateAccess(principal: Principal, action: Action, resource: Resource): Decision {
  // 1. Authentication edge.
  if (principal.kind === 'anonymous') {
    return deny('DENY_ANONYMOUS', `unauthenticated principal cannot ${action.type} ${resource.kind}`)
  }

  // 2. Scoping integrity — every resource resolves through exactly one child scope.
  //    Missing/malformed scoping data denies (fail-closed), never falls through.
  const { childId, householdId } = resource.scope
  if (childId.length === 0 || householdId.length === 0) {
    return deny(
      'DENY_UNKNOWN_CHILD_SCOPE',
      `resource ${resource.kind} has incomplete child scope (childId=${childId || '<missing>'}, householdId=${householdId || '<missing>'})`,
    )
  }

  // 3. Household-membership boundary — the primary tenancy line. Covers
  //    cross-household read/write, non-member access, and published-still-scoped.
  if (!principal.householdIds.includes(householdId)) {
    return deny(
      'DENY_NO_HOUSEHOLD_PATH',
      `child ${childId} is owned by household ${householdId}; caregiver ${principal.caregiverId} holds membership in [${principal.householdIds.join(', ') || 'none'}]`,
    )
  }

  // 4. Publication-state boundary — Dimension 1. Applies to an entry and to its
  //    derived events (events inherit the entry's visibility).
  if ((resource.kind === 'entry' || resource.kind === 'entryEvents') && resource.entry.status === 'draft') {
    if (resource.entry.authorId !== principal.caregiverId) {
      return deny(
        'DENY_DRAFT_AUTHOR_ONLY',
        `entry is ${resource.entry.status} and authored by ${resource.entry.authorId}; caregiver ${principal.caregiverId} is a household member but not the author`,
      )
    }
  }

  // 5. Attribution integrity — authorId is server-bound to the authenticated principal.
  if (action.type === 'write' && action.asAuthorId !== principal.caregiverId) {
    return deny(
      'DENY_ATTRIBUTION_MISMATCH',
      `write claims authorId=${action.asAuthorId} but authenticated principal is ${principal.caregiverId}`,
    )
  }

  return { outcome: 'ALLOW' }
}

/**
 * Timeline projection: which of the given entries may this principal see on the
 * child's timeline? Published entries + the principal's own drafts; other
 * authors' drafts are INVISIBLE (excluded), not an error. For principals
 * without a household path this returns [] — the timeline-level check
 * (evaluateAccess on 'childTimeline') is still the gate for reading the
 * timeline at all.
 */
export function visibleEntries(principal: Principal, scope: ChildScope, entries: readonly Entry[]): Entry[] {
  return entries.filter(
    (entry) => evaluateAccess(principal, { type: 'read' }, { kind: 'entry', scope, entry }).outcome === 'ALLOW',
  )
}
