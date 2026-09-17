/**
 * Executable negative access cases for the household visibility threat model.
 * Run: bun test ./security   (or: bun test security/access/policy.test.ts)
 *
 * Every test names its abuse case (AB-*) or positive control (PC-*) from
 * THREAT-MODEL.md and documents the EXACT assertion that denies access: the
 * assertion pins both the DENY outcome and the reason code, so a policy that
 * denies for the wrong reason also fails.
 *
 * Dependency label (PENDING): Entry/Event shapes are the contract-v0.1 mock in
 * ./schema-mock (art_I2TCG08V). The spike package (spikes/effect-compat, branch
 * spike/effect-contracts-adapters) was not pushed to origin when this suite was
 * written — wiring these tests to the real package is pending; swap the import
 * when it lands.
 */
import { describe, expect, it } from 'bun:test'
import { evaluateAccess, visibleEntries } from './policy'
import { makeEntry, makeEvent } from './schema-mock'
import type { ChildScope, Decision, Principal, Resource } from './types'

// --- World: two households, one child each -------------------------------------------------

const H1 = 'household-1'
const H2 = 'household-2'
const CHILD_H1 = 'child-in-household-1'
const CHILD_H2 = 'child-in-household-2'

const scopeH1: ChildScope = { childId: CHILD_H1, householdId: H1 }
const scopeH2: ChildScope = { childId: CHILD_H2, householdId: H2 }

const caregiverA: Principal = { kind: 'caregiver', caregiverId: 'caregiver-a', householdIds: [H1] }
const caregiverB: Principal = { kind: 'caregiver', caregiverId: 'caregiver-b', householdIds: [H1] }
// A legitimate system user who is a member of household 2 only — non-member for household 1's child.
const caregiverOfH2: Principal = { kind: 'caregiver', caregiverId: 'caregiver-of-h2', householdIds: [H2] }
// An authenticated caregiver with NO household membership at all.
const houselessCaregiver: Principal = { kind: 'caregiver', caregiverId: 'caregiver-unaffiliated', householdIds: [] }
const anonymous: Principal = { kind: 'anonymous' }

const draftByA = makeEntry({
  transcript: 'She napped 45 minutes at grandma’s and woke up grumpy.',
  authorId: 'caregiver-a',
  createdAt: new Date(1760000000000),
  status: 'draft',
  events: [makeEvent({ category: 'sleep', occurredAt: new Date(1760000000000), confidence: 0.9, authorId: 'caregiver-a' })],
})

const publishedByA = makeEntry({
  transcript: 'First toothbrush solo today, very proud.',
  authorId: 'caregiver-a',
  createdAt: new Date(1760000100000),
  status: 'published',
  events: [makeEvent({ category: 'milestone', occurredAt: new Date(1760000100000), confidence: 1, authorId: 'caregiver-a' })],
})

const read = { type: 'read' } as const

// --- Positive controls: prove the policy is not a deny-everything stub ----------------------

describe('Positive controls (ALLOW paths)', () => {
  it('PC-1: caregiver A reads the child timeline of their own household', () => {
    const timeline: Resource = { kind: 'childTimeline', scope: scopeH1 }
    // Exact assertion: outcome === 'ALLOW' (no deny reason).
    expect(evaluateAccess(caregiverA, read, timeline)).toEqual({ outcome: 'ALLOW' })
  })

  it('PC-2: caregiver A writes an entry to a child in their own household', () => {
    const write = { type: 'write', asAuthorId: 'caregiver-a' } as const
    // Exact assertion: outcome === 'ALLOW'.
    expect(evaluateAccess(caregiverA, write, { kind: 'childTimeline', scope: scopeH1 })).toEqual({ outcome: 'ALLOW' })
  })

  it('PC-3: caregiver B reads caregiver A’s PUBLISHED entry in the same household', () => {
    // Exact assertion: outcome === 'ALLOW' — published content is household-audience.
    expect(evaluateAccess(caregiverB, read, { kind: 'entry', scope: scopeH1, entry: publishedByA })).toEqual({
      outcome: 'ALLOW',
    })
  })

  it('PC-4: the author reads their own draft (publication dimension cuts by author, not by membership)', () => {
    // Exact assertion: outcome === 'ALLOW'.
    expect(evaluateAccess(caregiverA, read, { kind: 'entry', scope: scopeH1, entry: draftByA })).toEqual({
      outcome: 'ALLOW',
    })
  })
})

// --- Required negative cases ---------------------------------------------------------------

describe('Household-membership boundary (Dimension 2: audience)', () => {
  it('AB-1: caregiver of household 1 reading household 2’s child timeline → DENIED', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_NO_HOUSEHOLD_PATH'
    // (caregiverA holds membership only in [household-1]; the child’s owning
    // household is household-2 — no explicit roster path exists).
    const decision: Decision = evaluateAccess(caregiverA, read, { kind: 'childTimeline', scope: scopeH2 })
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_NO_HOUSEHOLD_PATH' })
  })

  it('AB-2: writing an entry to another household’s child → DENIED', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_NO_HOUSEHOLD_PATH'
    // (write target child is owned by household-2; author’s membership is household-1).
    const write = { type: 'write', asAuthorId: 'caregiver-a' } as const
    const decision: Decision = evaluateAccess(caregiverA, write, { kind: 'childTimeline', scope: scopeH2 })
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_NO_HOUSEHOLD_PATH' })
  })

  it('AB-3: non-member reading ANY child → DENIED (every child, both households)', () => {
    // Deny assertion: for EVERY child in the system, outcome === 'DENY' &&
    // code === 'DENY_NO_HOUSEHOLD_PATH' — an unaffiliated caregiver has an
    // empty membership roster, so no child can ever resolve to a household path.
    const allChildren: readonly ChildScope[] = [scopeH1, scopeH2]
    for (const scope of allChildren) {
      const decision: Decision = evaluateAccess(houselessCaregiver, read, { kind: 'childTimeline', scope })
      expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_NO_HOUSEHOLD_PATH' })
    }
  })

  it('AB-7: a PUBLISHED entry is still denied to a non-member (publication never widens audience)', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_NO_HOUSEHOLD_PATH'
    // — flipping status draft→published changes NOTHING for a non-member;
    // audience eligibility and publication state are separate dimensions.
    const decision: Decision = evaluateAccess(caregiverOfH2, read, { kind: 'entry', scope: scopeH1, entry: publishedByA })
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_NO_HOUSEHOLD_PATH' })
  })

  it('AB-7b: publishing the cross-household entry flips nothing for the non-member (dimension proof, side A)', () => {
    // Same resource family as AB-7, asserted both ways: the published state is
    // irrelevant across the household boundary.
    for (const entry of [draftByA, publishedByA]) {
      const decision: Decision = evaluateAccess(caregiverOfH2, read, { kind: 'entry', scope: scopeH1, entry })
      expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_NO_HOUSEHOLD_PATH' })
    }
  })
})

describe('Publication-state boundary (Dimension 1: authoring lifecycle)', () => {
  it('AB-4: unpublished (draft) entry invisible to the other caregiver IN THE SAME household, visible to author', () => {
    // Deny assertion (caregiver B): outcome === 'DENY' &&
    // code === 'DENY_DRAFT_AUTHOR_ONLY' — B is a legitimate household member
    // (membership check passes) and is denied ONLY by publication state.
    const bDecision: Decision = evaluateAccess(caregiverB, read, { kind: 'entry', scope: scopeH1, entry: draftByA })
    expect(bDecision).toMatchObject({ outcome: 'DENY', code: 'DENY_DRAFT_AUTHOR_ONLY' })

    // Author control: identical resource, author principal → 'ALLOW'.
    expect(evaluateAccess(caregiverA, read, { kind: 'entry', scope: scopeH1, entry: draftByA })).toEqual({
      outcome: 'ALLOW',
    })
  })

  it('AB-10: a draft’s extraction events are invisible to the co-member (events inherit entry visibility)', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_DRAFT_AUTHOR_ONLY'
    // on the 'entryEvents' resource — reading the structured events of a draft
    // is the same denial as reading the entry (no side-channel via Event[]).
    const decision: Decision = evaluateAccess(caregiverB, read, { kind: 'entryEvents', scope: scopeH1, entry: draftByA })
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_DRAFT_AUTHOR_ONLY' })
  })

  it('DIM-1: one timeline, three principals, three different projections (dimensions composed)', () => {
    // Same child scope and entry set for everyone; only audience eligibility
    // (household) and publication state (author) differ per principal.
    const timeline = [draftByA, publishedByA]
    // Caregiver A (member, author): sees own draft + published → 2 entries.
    expect(visibleEntries(caregiverA, scopeH1, timeline)).toHaveLength(2)
    // Caregiver B (member, not author): sees published only; draft is invisible → 1.
    expect(visibleEntries(caregiverB, scopeH1, timeline)).toEqual([publishedByA])
    // Non-member caregiver (household 2): sees nothing at all → 0.
    expect(visibleEntries(caregiverOfH2, scopeH1, timeline)).toHaveLength(0)
  })
})

describe('Authentication edge', () => {
  it('AB-5: anonymous read of any child timeline → DENIED', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_ANONYMOUS'.
    const decision: Decision = evaluateAccess(anonymous, read, { kind: 'childTimeline', scope: scopeH1 })
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_ANONYMOUS' })
  })

  it('AB-6: anonymous write of an entry → DENIED', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_ANONYMOUS'.
    const write = { type: 'write', asAuthorId: 'caregiver-a' } as const
    const decision: Decision = evaluateAccess(anonymous, write, { kind: 'childTimeline', scope: scopeH1 })
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_ANONYMOUS' })
  })
})

describe('Attribution integrity', () => {
  it('AB-9: co-member cannot author an entry under another caregiver’s identity → DENIED', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_ATTRIBUTION_MISMATCH'
    // — B passes membership but the write claims authorId caregiver-a while the
    // authenticated principal is caregiver-b. Attribution is server-bound.
    const write = { type: 'write', asAuthorId: 'caregiver-a' } as const
    const decision: Decision = evaluateAccess(caregiverB, write, { kind: 'childTimeline', scope: scopeH1 })
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_ATTRIBUTION_MISMATCH' })
  })
})

describe('Fail-closed on missing or malformed data', () => {
  it('AB-12: incomplete child scope (missing owning household) → DENIED, never open', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_UNKNOWN_CHILD_SCOPE'.
    const decision: Decision = evaluateAccess(caregiverA, read, {
      kind: 'childTimeline',
      scope: { childId: CHILD_H1, householdId: '' },
    })
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_UNKNOWN_CHILD_SCOPE' })
  })

  it('AB-12b: unknown child (no household record resolvable) → DENIED, never open', () => {
    // Deny assertion: outcome === 'DENY' && code === 'DENY_UNKNOWN_CHILD_SCOPE'.
    const decision: Decision = evaluateAccess(caregiverA, read, {
      kind: 'childTimeline',
      scope: { childId: '', householdId: H1 },
    })
    expect(decision).toMatchObject({ outcome: 'DENY', code: 'DENY_UNKNOWN_CHILD_SCOPE' })
  })
})
