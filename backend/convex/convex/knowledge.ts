import { Schema } from "effect"

import { KnowledgeDocument, assertKnowledgeInvariants } from "@journal/domain"
import { convexFields } from "@journal/domain/convex"

import {
  CreateKnowledgeItemInput,
  CreateKnowledgeItemOutput,
  ListKnowledgeInput,
  ListKnowledgeOutput,
  SupersedeKnowledgeItemInput,
  SupersedeKnowledgeItemOutput,
  buildKnowledgeItemRow,
  checkSupersession,
  isCurrentKnowledgeItem,
  isVisibleKnowledgeItem,
} from "./knowledgeInput"

import { mutation, query } from "./_generated/server"
import type { DatabaseReader } from "./_generated/server"
import type { DataModel } from "./_generated/dataModel"
import type { FilterBuilder } from "convex/server"
import { ConvexError } from "convex/values"

import { errorText, stripUndefined } from "./lib"

/**
 * Family-knowledge functions over the `knowledge` table (contract: PR #16's
 * `KnowledgeFields` in @journal/domain; input contracts composed in
 * `./knowledgeInput.ts` from the same canonical fields — packages/domain is
 * untouched).
 *
 * Authorization wiring (see security/access for the reference policy this
 * mirrors): every function resolves the (householdId, childId) pair against
 * the stored child row and FAILS CLOSED on a mismatch — cross-household reads
 * and writes are rejected, never silently rewritten to the child's real
 * household. Reads additionally enforce the publication dimension: drafts are
 * visible only to their recorder; with no viewer identity drafts are
 * invisible. `kind` is NEVER an authorization input — it is a
 * retrieval/rendering discriminant only (guardrail adopted with the PR #16
 * contract decisions; negative case in security/access/knowledge.test.ts).
 *
 * Attribution: `statedBy`/`recordedBy` are the schema's attribution fields and
 * arrive from the client — server-authenticated identity is not wired in this
 * backend yet (the same documented platform gap as `authorId` on the entry
 * write path, PR #13). The supersession rules below are enforced
 * server-side regardless of identity.
 *
 * Evidence note (N1): there is no local Convex runtime harness, so these
 * handlers are exercised by strict typechecking against the generated API
 * plus validator-level bun tests over the pure logic in ./knowledgeInput.ts;
 * runtime/deployment evidence is deferred to the future harness.
 */

/**
 * Fail-closed tenancy check shared by every function: the child must exist,
 * and the requested household must be the child's ACTUAL owning household.
 * A (household, child) pair that crosses tenancies is an authorization
 * signal — rejected, not rewritten.
 */
const requireChildInHousehold = async (
  db: DatabaseReader,
  householdId: string,
  childId: string,
): Promise<void> => {
  const normalizedChildId = db.normalizeId("children", childId)
  if (normalizedChildId === null) {
    throw new ConvexError({ code: "CHILD_NOT_FOUND", message: `child ${childId} does not exist` })
  }
  const child = await db.get(normalizedChildId)
  if (child === null) {
    throw new ConvexError({ code: "CHILD_NOT_FOUND", message: `child ${childId} does not exist` })
  }
  if (child.householdId !== householdId) {
    throw new ConvexError({
      code: "CHILD_HOUSEHOLD_MISMATCH",
      message: `child ${childId} belongs to household ${child.householdId}, not ${householdId} — cross-household access is rejected`,
    })
  }
}

/**
 * Write path (1/2): append a new knowledge item. Household-scoped via the
 * fail-closed pair check, attributed per the schema's attribution fields,
 * entering the draft→published lifecycle at `visibility: "draft"`.
 */
export const create = mutation({
  args: convexFields(CreateKnowledgeItemInput),
  handler: async (ctx, rawArgs): Promise<typeof CreateKnowledgeItemOutput["Type"]> => {
    let args: typeof CreateKnowledgeItemInput["Type"]
    let row: ReturnType<typeof buildKnowledgeItemRow>
    try {
      args = Schema.decodeUnknownSync(CreateKnowledgeItemInput)(stripUndefined(rawArgs))
      row = buildKnowledgeItemRow(args, Date.now())
    } catch (err) {
      throw new ConvexError({ code: "INVALID_KNOWLEDGE_INPUT", message: errorText(err) })
    }

    await requireChildInHousehold(ctx.db, args.householdId, args.childId)

    const knowledgeItemId = await ctx.db.insert("knowledge", row)
    return { status: "created" as const, knowledgeItemId } satisfies typeof CreateKnowledgeItemOutput["Type"]
  },
})

/**
 * Write path (2/2): append-only supersession, atomic. Appends the successor
 * (forward `supersedes` edge) and marks the target `superseded` with
 * `validUntil` = the successor's `validFrom` — matching the PR #16 fixture
 * chains. The target must be a CURRENT item in the same household and for
 * the same child (checkSupersession); the full history stays readable via
 * the history query.
 */
export const supersede = mutation({
  args: convexFields(SupersedeKnowledgeItemInput),
  handler: async (ctx, rawArgs): Promise<typeof SupersedeKnowledgeItemOutput["Type"]> => {
    let args: typeof SupersedeKnowledgeItemInput["Type"]
    let successor: ReturnType<typeof buildKnowledgeItemRow>
    try {
      args = Schema.decodeUnknownSync(SupersedeKnowledgeItemInput)(stripUndefined(rawArgs))
      successor = buildKnowledgeItemRow(args, Date.now())
    } catch (err) {
      throw new ConvexError({ code: "INVALID_KNOWLEDGE_INPUT", message: errorText(err) })
    }

    await requireChildInHousehold(ctx.db, args.householdId, args.childId)

    const targetId = ctx.db.normalizeId("knowledge", args.supersedes)
    if (targetId === null) {
      throw new ConvexError({
        code: "KNOWLEDGE_ITEM_NOT_FOUND",
        message: `knowledge item ${args.supersedes} does not exist`,
      })
    }
    const target = await ctx.db.get(targetId)
    if (target === null) {
      throw new ConvexError({
        code: "KNOWLEDGE_ITEM_NOT_FOUND",
        message: `knowledge item ${args.supersedes} does not exist`,
      })
    }
    // The stored target is decoded through the document contract before it
    // drives any decision — a corrupted or cross-contract row fails loudly.
    const targetDoc = decodeKnowledgeRow(target)

    const validFrom = successor.validFrom
    const check = checkSupersession(targetDoc, { householdId: args.householdId, childId: args.childId, validFrom })
    if (check.outcome === "rejected") {
      throw new ConvexError({ code: check.code, message: check.detail })
    }

    // Defense in depth: the closed target must still satisfy the full
    // family-knowledge contract (window, lifecycle) before anything is
    // written. A violation here is a server-state bug — surfaces loudly.
    assertKnowledgeInvariants({ ...targetDoc, status: "superseded", validUntil: validFrom })

    const knowledgeItemId = await ctx.db.insert("knowledge", {
      ...successor,
      supersedes: targetId,
    })
    await ctx.db.patch(targetId, { status: "superseded", validUntil: validFrom })

    return {
      status: "superseded" as const,
      knowledgeItemId,
      supersededId: targetId,
    } satisfies typeof SupersedeKnowledgeItemOutput["Type"]
  },
})

/**
 * Fail-closed read projection shared by every function that touches a stored
 * knowledge row: decode it (Convex hands back loosely-typed documents)
 * through the canonical document contract and re-run the cross-field
 * invariants. A stored row that violates the contract fails loudly instead
 * of serving invalid knowledge or driving a supersession decision.
 */
const decodeKnowledgeRow = (row: unknown): KnowledgeDocument => {
  const decoded = Schema.decodeUnknownSync(KnowledgeDocument)(row)
  assertKnowledgeInvariants(decoded)
  return decoded
}

/**
 * The publication-dimension filter as a database-side expression, mirroring
 * isVisibleKnowledgeItem: with no viewer identity only published items are
 * readable; with a viewer, their own drafts are also readable.
 */
const audienceExpression = (q: FilterBuilder<DataModel["knowledge"]>, viewerId: string | undefined) =>
  viewerId === undefined
    ? q.eq(q.field("visibility"), "published")
    : q.or(q.eq(q.field("visibility"), "published"), q.eq(q.field("recordedBy"), viewerId))

/**
 * Bounded read (1/2): CURRENT items for the household/child(/topic) —
 * superseded items are excluded by default. Explicit `limit` (1..200). The
 * tested predicates re-check every decoded row in the serving path, so the
 * database-level filters can never widen the audience.
 */
export const listCurrent = query({
  args: convexFields(ListKnowledgeInput),
  handler: async (ctx, rawArgs): Promise<typeof ListKnowledgeOutput["Type"]> => {
    let args: typeof ListKnowledgeInput["Type"]
    try {
      args = Schema.decodeUnknownSync(ListKnowledgeInput)(stripUndefined(rawArgs))
    } catch (err) {
      throw new ConvexError({ code: "INVALID_KNOWLEDGE_QUERY", message: errorText(err) })
    }

    await requireChildInHousehold(ctx.db, args.householdId, args.childId)

    // The composite (childId, topic) index serves both forms: binding the
    // childId prefix alone scans the child's items across topics. Filters
    // apply within the index scan; take() bounds the page.
    const base =
      args.topic === undefined
        ? ctx.db.query("knowledge").withIndex("by_child_topic", (q) => q.eq("childId", args.childId))
        : ctx.db
            .query("knowledge")
            .withIndex("by_child_topic", (q) => q.eq("childId", args.childId).eq("topic", args.topic))

    const rows = await base
      .filter((q) => q.eq(q.field("status"), "current"))
      .filter((q) => audienceExpression(q, args.viewerId))
      .take(args.limit)

    return rows
      .map((row) => decodeKnowledgeRow(row))
      .filter((doc) => isCurrentKnowledgeItem(doc) && isVisibleKnowledgeItem(doc, args.viewerId))
  },
})

/**
 * Bounded read (2/2): the explicit HISTORY capability — includes superseded
 * items (the full append-only chain), same household scoping, publication
 * dimension, and page bound as listCurrent. Within a topic, rows return in
 * append order (supersession chains are appended chronologically).
 */
export const listHistory = query({
  args: convexFields(ListKnowledgeInput),
  handler: async (ctx, rawArgs): Promise<typeof ListKnowledgeOutput["Type"]> => {
    let args: typeof ListKnowledgeInput["Type"]
    try {
      args = Schema.decodeUnknownSync(ListKnowledgeInput)(stripUndefined(rawArgs))
    } catch (err) {
      throw new ConvexError({ code: "INVALID_KNOWLEDGE_QUERY", message: errorText(err) })
    }

    await requireChildInHousehold(ctx.db, args.householdId, args.childId)

    const base =
      args.topic === undefined
        ? ctx.db.query("knowledge").withIndex("by_child_topic", (q) => q.eq("childId", args.childId))
        : ctx.db
            .query("knowledge")
            .withIndex("by_child_topic", (q) => q.eq("childId", args.childId).eq("topic", args.topic))

    const rows = await base.filter((q) => audienceExpression(q, args.viewerId)).take(args.limit)

    return rows.map((row) => decodeKnowledgeRow(row)).filter((doc) => isVisibleKnowledgeItem(doc, args.viewerId))
  },
})
