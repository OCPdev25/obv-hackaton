/**
 * Authorization types for the household visibility model.
 * See security/THREAT-MODEL.md for actors, assets, boundaries, and abuse cases.
 *
 * Contract note: contract v0.1 (art_I2TCG08V) defines Entry + Event only — it
 * does NOT yet carry household/child identifiers or a household roster. The
 * scoping types below are the threat model's REQUIRED CONTRACT EXTENSIONS
 * (documented in THREAT-MODEL.md §Contract gaps), not claims about the
 * existing schema.
 */
import type { Entry, KnowledgeItem } from './schema-mock'

/** An authenticated caregiver and the households they are EXPLICITLY a member of. */
export interface CaregiverPrincipal {
  readonly kind: 'caregiver'
  readonly caregiverId: string
  /** Membership is a server-maintained roster fact, never inferred from a link or share. */
  readonly householdIds: readonly string[]
}

/** Unauthenticated principal (no session/token). Trust level zero. */
export interface AnonymousPrincipal {
  readonly kind: 'anonymous'
}

export type Principal = CaregiverPrincipal | AnonymousPrincipal

/**
 * The child scoping every journal resource resolves through. Exactly one
 * owning household per child (current product reality; multi-household
 * children are a future audience-grant extension — THREAT-MODEL.md §Trust boundaries).
 */
export interface ChildScope {
  readonly childId: string
  readonly householdId: string
}

export type Resource =
  | { readonly kind: 'childProfile'; readonly scope: ChildScope }
  | { readonly kind: 'childTimeline'; readonly scope: ChildScope }
  | { readonly kind: 'entry'; readonly scope: ChildScope; readonly entry: Entry }
  /**
   * The Event[] derived from an entry. Distinct resource kind so tests can
   * prove extraction events INHERIT the entry's publication-state visibility.
   */
  | { readonly kind: 'entryEvents'; readonly scope: ChildScope; readonly entry: Entry }
  /**
   * A family-knowledge item (packages/domain knowledge table, PR #16).
   * Household scoping is identical to every other resource; the publication
   * dimension mirrors entries (drafts author-only, via recordedBy). The
   * item's `kind` is deliberately part of the resource but MUST never affect
   * the decision — KN-8 proves that.
   */
  | { readonly kind: 'knowledgeItem'; readonly scope: ChildScope; readonly item: KnowledgeItem }

export type Action =
  | { readonly type: 'read' }
  /**
   * Writes carry the authorId the caller wants attributed. The policy binds it
   * to the authenticated principal — attribution is never client-chosen.
   */
  | { readonly type: 'write'; readonly asAuthorId: string }

/**
 * Deny reason codes. The exact machine-checkable assertion a test pins to —
 * a policy change that denies for the WRONG reason fails the tests.
 */
export type DenyCode =
  | 'DENY_ANONYMOUS'
  | 'DENY_UNKNOWN_CHILD_SCOPE'
  | 'DENY_NO_HOUSEHOLD_PATH'
  | 'DENY_DRAFT_AUTHOR_ONLY'
  | 'DENY_ATTRIBUTION_MISMATCH'

export type Decision =
  | { readonly outcome: 'ALLOW' }
  | { readonly outcome: 'DENY'; readonly code: DenyCode; readonly detail: string }
