/**
 * Convex validators — the one-directional mapping from the canonical Effect
 * schema (contract.ts) to storage, per the contract's "Convex mapping" section.
 * These enforce wire shape; range constraints (confidence ∈ [0,1]) and other
 * refinements are enforced by the Effect schema at the mutation boundary.
 */
import { v } from 'convex/values'

export const eventValidator = v.object({
  _tag: v.literal('Event'),
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
  _tag: v.literal('Entry'),
  transcript: v.string(),
  authorId: v.string(),
  createdAt: v.number(),
  status: v.union(v.literal('draft'), v.literal('published')),
  events: v.array(eventValidator),
})
