/**
 * Authorization for month-history surfaces — a thin ADAPTER over the one
 * fail-closed policy (security/access/policy.ts). No new rules are invented
 * here: a month view is a child-timeline read, drafts are author-only, and
 * writes are attribution-bound. Every decision cites the shared policy so
 * month history can never open a path the rest of the product denies.
 *
 * Mapping note: the policy module's Entry shape is the contract v0.1 mock
 * (transcript/status, createdAt as Date). The canonical domain EntryDocument
 * (rawTranscript/visibility, createdAt as Unix ms) maps losslessly for the
 * fields the policy reads.
 */
import type { EntryDocument } from "@journal/domain"
import { evaluateAccess } from "../../../security/access/policy"
import type { Entry as PolicyEntry } from "../../../security/access/schema-mock"
import type { ChildScope, Decision, DenyCode, Principal } from "../../../security/access/types"

export type { ChildScope, Decision, DenyCode, Principal }

/** Map a canonical domain EntryDocument onto the policy's Entry shape. */
export function toPolicyEntry(entry: EntryDocument): PolicyEntry {
  return {
    _tag: "Entry",
    transcript: entry.rawTranscript,
    authorId: entry.authorId,
    createdAt: new Date(entry.createdAt),
    status: entry.visibility,
    events: [],
  }
}

export type MonthAccessResult =
  | {
      readonly outcome: "allowed"
      readonly visible: readonly EntryDocument[]
      /** Entries in scope this principal may not see (e.g. another author's drafts). */
      readonly draftsExcludedForPrincipal: number
    }
  | { readonly outcome: "denied"; readonly code: DenyCode; readonly detail: string }

/**
 * Authorize a month-history read. The timeline-level gate decides first
 * (anonymous / unknown scope / no household path are denials for the WHOLE
 * view); then per-entry publication-state filtering applies (drafts are
 * author-only). Other authors' drafts are INVISIBLE, not an error — the
 * count of excluded drafts is disclosed so gap reporting stays honest.
 */
export function monthAccess(principal: Principal, scope: ChildScope, entries: readonly EntryDocument[]): MonthAccessResult {
  const timeline = evaluateAccess(principal, { type: "read" }, { kind: "childTimeline", scope })
  if (timeline.outcome === "DENY") {
    return { outcome: "denied", code: timeline.code, detail: timeline.detail }
  }
  const visible = entries.filter(
    (entry) => evaluateAccess(principal, { type: "read" }, { kind: "entry", scope, entry: toPolicyEntry(entry) }).outcome === "ALLOW",
  )
  return {
    outcome: "allowed",
    visible,
    draftsExcludedForPrincipal: entries.length - visible.length,
  }
}

/**
 * Who may file a correction against this entry? Same policy, write action,
 * attribution-bound to the authenticated principal. Consequences (pinned by
 * tests): any household member may correct a PUBLISHED entry; a DRAFT entry
 * is author-only even for writes (DENY_DRAFT_AUTHOR_ONLY); an anonymous
 * principal is DENY_ANONYMOUS; claiming someone else's authorship is
 * DENY_ATTRIBUTION_MISMATCH.
 */
export function correctionAccess(principal: Principal, scope: ChildScope, entry: EntryDocument): Decision {
  const asAuthorId = principal.kind === "caregiver" ? principal.caregiverId : ""
  return evaluateAccess(principal, { type: "write", asAuthorId }, { kind: "entry", scope, entry: toPolicyEntry(entry) })
}
