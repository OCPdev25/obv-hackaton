/**
 * Convex validators — the one-directional mapping from the canonical Effect
 * schema (contract.ts) to storage, per the contract's "Convex mapping" section.
 * These enforce wire shape; range constraints (confidence ∈ [0,1]) and other
 * refinements are enforced by the Effect schema at the mutation boundary.
 *
 * Storage deviation from the contract's mapping table (deployment-verified):
 * Convex rejects stored fields starting with `_` (reserved for system fields),
 * so the wire-level `_tag` discriminator is stripped on write and re-wrapped on
 * read (see entries.ts / timeline.ts). Table + validator identity replaces the
 * tag at rest; the wire format is unchanged in both directions.
 */
import { v } from 'convex/values'

export const eventValidator = v.object({
  category: v.union(
    v.literal('potty'),
    v.literal('meal'),
    v.literal('sleep'),
    v.literal('mood'),
    v.literal('milestone'),
    v.literal('school'),
  ),
  occurredAt: v.number(),
  quantity: v.optional(v.object({ value: v.number(), unit: v.optional(v.string()) })),
  confidence: v.number(),
  authorId: v.string(),
  note: v.optional(v.string()),
})

export const entryValidator = v.object({
  transcript: v.string(),
  authorId: v.string(),
  createdAt: v.number(),
  status: v.union(v.literal('draft'), v.literal('published')),
  events: v.array(eventValidator),
})
