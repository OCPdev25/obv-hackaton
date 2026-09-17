/**
 * Executable access cases for family-knowledge items (the Convex knowledge
 * functions' reference policy — backend/convex/convex/knowledge.ts mirrors
 * these rules).
 *
 * Every test names its case (KP-* positive control, KN-* negative) and pins
 * the EXACT assertion that decides access — outcome plus deny reason code —
 * so a policy that denies for the wrong reason also fails.
 *
 * Guardrail (contract decision adopted 2026-09-17 with the PR #16 knowledge
 * contract): a knowledge item's `kind` is a retrieval/rendering discriminant
 * ONLY and never an authorization input — audience is governed by
 * publication/audience state. KN-8 proves the policy is kind-blind.
 */
import { describe, expect, it } from 'bun:test'
import { evaluateAccess } from './policy'
import { KNOWLEDGE_KINDS, makeKnowledgeItem } from './schema-mock'
import type { Decision, KnowledgeItem, Principal, Resource } from './types'

// --- World: two households, one child each (same world as policy.test.ts) -------------------

const H1 = 'household-1'
const H2 = 'household-2'
const CHILD_H1 = 'child-in-household-1'
const CHILD_H2 = 'child-in-household-2'

const scopeH1 = { childId: CHILD_H1, householdId: H1 }
const scopeH2 = { childId: CHILD_H2, householdId: H2 }

const caregiverA: Principal = { kind: 'caregiver', caregiverId: 'caregiver-a', householdIds: [H1] }
const caregiverB: Principal = { kind: 'caregiver', caregiverId: 'caregiver-b', householdIds: [H1] }
const caregiverOfH2: Principal = { kind: 'caregiver', caregiverId: 'caregiver-of-h2', householdIds: [H2] }
const anonymous: Principal = { kind: 'anonymous' }

const read = { type: 'read' } as const
const writeAsA = { type: 'write', asAuthorId: 'caregiver-a' } as const

const publishedByA = makeKnowledgeItem({
  kind: 'preference',
  topic: 'bedtime',
  status: 'current',
  visibility: 'published',
  recordedBy: 'caregiver-a',
})

const draftByA = makeKnowledgeItem({
  kind: 'settling',
  topic: 'bedtime',
  status: 'current',
  visibility: 'draft',
  recordedBy: 'caregiver-a',
})

const supersededPublishedByA = makeKnowledgeItem({
  kind: 'preference',
  topic: 'vegetables-broccoli',
  status: 'superseded',
  visibility: 'published',
  recordedBy: 'caregiver-a',
})

const knowledgeResource = (scope: typeof scopeH1 | typeof scopeH2, item: KnowledgeItem): Resource => ({
  kind: 'knowledgeItem',
  scope,
  item,
})

// --- Positive controls -----------------------------------------------------------------------

describe('Knowledge positive controls (ALLOW paths)', () => {
  it('KP-1: caregiver B reads caregiver A’s PUBLISHED knowledge item in the same household', () => {
    // Exact assertion: outcome === 'ALLOW' — published knowledge is household-audience.
    expect(evaluateAccess(caregiverB, read, knowledgeResource(scopeH1, publishedByA))).toEqual({ outcome: 'ALLOW' })
  })

  it('KP-2: the recorder reads their own draft knowledge item', () => {
    // Exact assertion: outcome === 'ALLOW'.
    expect(evaluateAccess(caregiverA, read, knowledgeResource(scopeH1, draftByA))).toEqual({ outcome: 'ALLOW' })
  })

  it('KP-3: caregiver A creates/supersedes knowledge for a child in their own household', () => {
    // Exact assertion: outcome === 'ALLOW' (both write-path functions evaluate this resource).
    expect(evaluateAccess(caregiverA, writeAsA, knowledgeResource(scopeH1, draftByA))).toEqual({ outcome: 'ALLOW' })
  })

  it('KP-4: the history capability reads a SUPERSEDED published item under the same audience rules', () => {
    // Exact assertion: outcome === 'ALLOW' — supersession filters read models
    // (current vs history); it never changes authorization.
    expect(evaluateAccess(caregiverB, read, knowledgeResource(scopeH1, supersededPublishedByA))).toEqual({
      outcome: 'ALLOW',
    })
  })
})

// --- Required negative cases -----------------------------------------------------------------

describe('Knowledge household-membership boundary (Dimension 2: audience)', () => {
  it('KN-1: caregiver of household 1 reading household 2’s knowledge item → DENIED', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_NO_HOUSEHOLD_PATH'.
    const decision: Decision = evaluateAccess(caregiverA, read, knowledgeResource(scopeH2, publishedByA))
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_NO_HOUSEHOLD_PATH' })
  })

  it('KN-2: cross-household CREATE (write) of a knowledge item → DENIED', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_NO_HOUSEHOLD_PATH'
    // (write target child is owned by household-2; author’s membership is household-1).
    const decision: Decision = evaluateAccess(caregiverA, writeAsA, knowledgeResource(scopeH2, draftByA))
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_NO_HOUSEHOLD_PATH' })
  })

  it('KN-3: cross-household SUPERSEDE — write against a target item in another household → DENIED', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_NO_HOUSEHOLD_PATH'
    // (supersede is a write whose resource is the target item; no household path exists).
    const decision: Decision = evaluateAccess(caregiverA, writeAsA, knowledgeResource(scopeH2, publishedByA))
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_NO_HOUSEHOLD_PATH' })
  })

  it('KN-4: anonymous principal reading a published knowledge item → DENIED', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_ANONYMOUS'.
    const decision: Decision = evaluateAccess(anonymous, read, knowledgeResource(scopeH1, publishedByA))
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_ANONYMOUS' })
  })
})

describe('Knowledge publication-state boundary (Dimension 1: authoring lifecycle)', () => {
  it('KN-5: household member reading ANOTHER member’s draft knowledge item → DENIED', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_DRAFT_AUTHOR_ONLY'
    // (membership does not pierce drafts; recordedBy is the author-analog).
    const decision: Decision = evaluateAccess(caregiverB, read, knowledgeResource(scopeH1, draftByA))
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_DRAFT_AUTHOR_ONLY' })
  })
})

describe('Knowledge attribution integrity and scope integrity', () => {
  it('KN-6: a knowledge write attributed to another caregiver → DENIED', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_ATTRIBUTION_MISMATCH'
    // (attribution is bound to the authenticated principal, never client-chosen).
    const decision = evaluateAccess(caregiverA, { type: 'write', asAuthorId: 'caregiver-b' }, knowledgeResource(scopeH1, draftByA))
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_ATTRIBUTION_MISMATCH' })
  })

  it('KN-7: a knowledge resource with an incomplete child scope → DENIED (fail-closed)', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_UNKNOWN_CHILD_SCOPE'
    // (missing/malformed scoping data denies — never falls through).
    const decision: Decision = evaluateAccess(caregiverA, read, knowledgeResource({ childId: '', householdId: H1 }, publishedByA))
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_UNKNOWN_CHILD_SCOPE' })
  })
})

describe('Guardrail: kind is never an authorization input', () => {
  it('KN-8: access outcomes are IDENTICAL across all four kinds for the same audience state', () => {
    // Exact assertion: for every kind, with principal/scope/action/publication
    // state held fixed, the decisions are pairwise equal AND pin the expected
    // outcome — published items ALLOW for household members, other members’
    // drafts DENY_DRAFT_AUTHOR_ONLY. A policy that branched on kind (e.g.
    // treating "quote" or "settling" as more sensitive) fails here.
    const publishedDecisions = KNOWLEDGE_KINDS.map((kind) =>
      evaluateAccess(caregiverB, read, knowledgeResource(scopeH1, { ...publishedByA, kind })),
    )
    for (const decision of publishedDecisions) {
      expect(decision).toEqual(publishedDecisions[0])
      expect(decision).toEqual({ outcome: 'ALLOW' })
    }

    const draftDecisions = KNOWLEDGE_KINDS.map((kind) =>
      evaluateAccess(caregiverB, read, knowledgeResource(scopeH1, { ...draftByA, kind })),
    )
    for (const decision of draftDecisions) {
      expect(decision).toEqual(draftDecisions[0])
      expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_DRAFT_AUTHOR_ONLY' })
    }
  })
})
