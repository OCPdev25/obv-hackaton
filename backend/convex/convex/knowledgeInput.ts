import { Schema } from "effect"

import {
  KnowledgeDocument,
  KnowledgeFields,
  KnowledgeSchema,
  assertKnowledgeInvariants,
  convexId,
} from "@journal/domain"

/**
 * Function-level operation contracts + pure decision logic for the knowledge
 * functions (`./knowledge.ts`).
 *
 * The operation inputs are COMPOSED here from the canonical `KnowledgeFields`
 * — the same exported field schemas the `knowledge` table is registered with —
 * never restated, so a value rejected by these inputs is rejected identically
 * by the table validators. packages/domain is deliberately untouched: the
 * knowledge operation shapes are not yet promoted into
 * `packages/domain/contracts.ts`, and promoting them is a contract-thread
 * decision (v0.4 fold). When that fold lands, these compositions derive
 * identical Convex validators because they reference the same field schemas.
 *
 * Everything in this file is pure (no Convex runtime imports) so the decision
 * logic is executable as validator-level evidence — the N1 observation (no
 * local Convex runtime harness) stands; runtime/deployment evidence is
 * deferred to the future harness.
 */

/** Hard page cap for the bounded read path — an explicit limit is required. */
export const MAX_KNOWLEDGE_PAGE = 200

/**
 * Create input: the item content + attribution. Lifecycle fields are
 * server-set and deliberately absent — items always enter as
 * `status: "current"`, `visibility: "draft"` (the draft→published entry
 * point), and there is no client-chosen `supersedes` on create: corrections
 * go through the atomic `supersede` mutation, which both appends the
 * successor and closes the target in one transaction.
 */
export const CreateKnowledgeItemInput = Schema.Struct({
  householdId: KnowledgeFields.householdId,
  childId: KnowledgeFields.childId,
  kind: KnowledgeFields.kind,
  topic: KnowledgeFields.topic,
  statement: KnowledgeFields.statement,
  quoteText: KnowledgeFields.quoteText,
  spokenBy: KnowledgeFields.spokenBy,
  steps: KnowledgeFields.steps,
  statedBy: KnowledgeFields.statedBy,
  recordedBy: KnowledgeFields.recordedBy,
  provenanceKind: KnowledgeFields.provenanceKind,
  confidence: KnowledgeFields.confidence,
  sourceType: KnowledgeFields.sourceType,
  sourceEntryId: KnowledgeFields.sourceEntryId,
  sourceRef: KnowledgeFields.sourceRef,
  sourceSpan: KnowledgeFields.sourceSpan,
  sourceQuote: KnowledgeFields.sourceQuote,
  /** When the statement became valid/known; defaults to the write time. */
  validFrom: Schema.optional(KnowledgeFields.validFrom),
})
export type CreateKnowledgeItemInput = typeof CreateKnowledgeItemInput["Type"]

export const CreateKnowledgeItemOutput = Schema.Struct({
  status: Schema.Literals(["created"]),
  knowledgeItemId: convexId("knowledge"),
})
export type CreateKnowledgeItemOutput = typeof CreateKnowledgeItemOutput["Type"]

/**
 * Supersede input: the replacement content PLUS the target. The mutation
 * appends the successor (`supersedes` = target id, forward edge) and marks
 * the target `superseded` with `validUntil` = the successor's `validFrom`
 * (chain continuity, matching the PR #16 fixtures) in one transaction.
 */
export const SupersedeKnowledgeItemInput = Schema.Struct({
  householdId: KnowledgeFields.householdId,
  childId: KnowledgeFields.childId,
  supersedes: convexId("knowledge"),
  kind: KnowledgeFields.kind,
  topic: KnowledgeFields.topic,
  statement: KnowledgeFields.statement,
  quoteText: KnowledgeFields.quoteText,
  spokenBy: KnowledgeFields.spokenBy,
  steps: KnowledgeFields.steps,
  statedBy: KnowledgeFields.statedBy,
  recordedBy: KnowledgeFields.recordedBy,
  provenanceKind: KnowledgeFields.provenanceKind,
  confidence: KnowledgeFields.confidence,
  sourceType: KnowledgeFields.sourceType,
  sourceEntryId: KnowledgeFields.sourceEntryId,
  sourceRef: KnowledgeFields.sourceRef,
  sourceSpan: KnowledgeFields.sourceSpan,
  sourceQuote: KnowledgeFields.sourceQuote,
  validFrom: Schema.optional(KnowledgeFields.validFrom),
})
export type SupersedeKnowledgeItemInput = typeof SupersedeKnowledgeItemInput["Type"]

export const SupersedeKnowledgeItemOutput = Schema.Struct({
  status: Schema.Literals(["superseded"]),
  knowledgeItemId: convexId("knowledge"),
  supersededId: convexId("knowledge"),
})
export type SupersedeKnowledgeItemOutput = typeof SupersedeKnowledgeItemOutput["Type"]

/**
 * Bounded read input, shared by the current and history queries (the
 * difference is behavioral, not shape). `limit` is REQUIRED and capped —
 * an unbounded read path has no caller. `viewerId` is the caller-asserted
 * caregiver identity (client-asserted until the auth lane wires server
 * identity — the same documented platform gap as `authorId` on the entry
 * write path): drafts are visible ONLY to their recorder, and with no
 * viewerId at all drafts are invisible (fail-closed).
 */
export const ListKnowledgeInput = Schema.Struct({
  householdId: KnowledgeFields.householdId,
  childId: KnowledgeFields.childId,
  topic: Schema.optional(KnowledgeFields.topic),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_KNOWLEDGE_PAGE })),
  viewerId: Schema.optional(Schema.String),
})
export type ListKnowledgeInput = typeof ListKnowledgeInput["Type"]

/** Rows decode through the canonical document contract — ids included (supersede targets, citations). */
export const ListKnowledgeOutput = Schema.Array(KnowledgeDocument)
export type ListKnowledgeOutput = typeof ListKnowledgeOutput["Type"]

/**
 * Compose the storage row for a new item and assert the family-knowledge
 * contract on it. Throws `KnowledgeShapeError` on a contract violation
 * (kind-conditional structure, provenance partition, source attribution) —
 * the input schema validates shape, this validates the cross-field rules.
 */
export const buildKnowledgeItemRow = (
  args: typeof CreateKnowledgeItemInput["Type"],
  now: number,
): typeof KnowledgeSchema["Type"] => {
  const row: typeof KnowledgeSchema["Type"] = {
    householdId: args.householdId,
    childId: args.childId,
    kind: args.kind,
    topic: args.topic,
    statement: args.statement,
    ...(args.quoteText === undefined ? {} : { quoteText: args.quoteText }),
    ...(args.spokenBy === undefined ? {} : { spokenBy: args.spokenBy }),
    ...(args.steps === undefined ? {} : { steps: args.steps }),
    status: "current",
    statedBy: args.statedBy,
    recordedBy: args.recordedBy,
    provenanceKind: args.provenanceKind,
    confidence: args.confidence,
    sourceType: args.sourceType,
    ...(args.sourceEntryId === undefined ? {} : { sourceEntryId: args.sourceEntryId }),
    ...(args.sourceRef === undefined ? {} : { sourceRef: args.sourceRef }),
    ...(args.sourceSpan === undefined ? {} : { sourceSpan: args.sourceSpan }),
    ...(args.sourceQuote === undefined ? {} : { sourceQuote: args.sourceQuote }),
    visibility: "draft",
    validFrom: args.validFrom ?? now,
    createdAt: now,
  }
  assertKnowledgeInvariants(row)
  return row
}

/**
 * Supersession eligibility — a pure decision (values, not exceptions, per
 * the security-suite pattern). Rejects:
 * - a target that is not `current` (superseding a superseded item forks the
 *   append-only chain),
 * - cross-household and cross-child supersession (tenancy + scope
 *   integrity — the edge may never jump households or children),
 * - a replacement `validFrom` before the target's `validFrom` (the target's
 *   closing `validUntil` would precede its own `validFrom` — a domain
 *   invariant violation).
 */
export type SupersessionRejection =
  | "SUPERSESSION_TARGET_NOT_CURRENT"
  | "SUPERSESSION_HOUSEHOLD_MISMATCH"
  | "SUPERSESSION_CHILD_MISMATCH"
  | "SUPERSESSION_WINDOW_INVALID"

export const checkSupersession = (
  target: KnowledgeDocument,
  replacement: { householdId: string; childId: string; validFrom: number },
): { outcome: "eligible" } | { outcome: "rejected"; code: SupersessionRejection; detail: string } => {
  if (target.status !== "current") {
    return {
      outcome: "rejected",
      code: "SUPERSESSION_TARGET_NOT_CURRENT",
      detail: `knowledge item ${target._id} is ${target.status}; only current items can be superseded (append-only chains — no forks)`,
    }
  }
  if (target.householdId !== replacement.householdId) {
    return {
      outcome: "rejected",
      code: "SUPERSESSION_HOUSEHOLD_MISMATCH",
      detail: `knowledge item ${target._id} belongs to household ${target.householdId}; cross-household supersession is rejected`,
    }
  }
  if (target.childId !== replacement.childId) {
    return {
      outcome: "rejected",
      code: "SUPERSESSION_CHILD_MISMATCH",
      detail: `knowledge item ${target._id} belongs to child ${target.childId}; cross-child supersession is rejected`,
    }
  }
  if (replacement.validFrom < target.validFrom) {
    return {
      outcome: "rejected",
      code: "SUPERSESSION_WINDOW_INVALID",
      detail: `replacement validFrom ${replacement.validFrom} precedes the target's validFrom ${target.validFrom}; the target's validUntil would precede its validFrom`,
    }
  }
  return { outcome: "eligible" }
}

/**
 * Publication-dimension visibility for a knowledge row (wires the reference
 * policy's draft rule): published items are household-audience; drafts are
 * recorder-only; with no viewer identity drafts are invisible. `kind` is
 * NEVER consulted — it is a retrieval/rendering discriminant only, never an
 * authorization input (guardrail, tested in security/access/knowledge.test.ts).
 */
export const isVisibleKnowledgeItem = (
  item: Pick<typeof KnowledgeSchema["Type"], "visibility" | "recordedBy">,
  viewerId: string | undefined,
): boolean => item.visibility === "published" || (viewerId !== undefined && item.recordedBy === viewerId)

/** The read model's current-items predicate: superseded rows are excluded by default. */
export const isCurrentKnowledgeItem = (item: Pick<typeof KnowledgeSchema["Type"], "status">): boolean =>
  item.status === "current"
