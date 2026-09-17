/**
 * Verification-gate validator tests — positive controls + negative controls.
 *
 * Positive controls prove a well-formed manifest merges.
 * Negative controls prove each contract rule blocks on its own term: each
 * fixture is internally consistent except for ONE defect, and the assertion
 * pins the exact refusal-code set — the gate must fire on that term and stay
 * silent on everything else (the same fail-closed discipline the repo's
 * security suite applies to access cases).
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { extractManifests, latestManifest } from '../src/manifest.ts'
import { requiredSuites, validateManifest } from '../src/validate.ts'
import type { VerificationContext, Verdict } from '../src/types.ts'

const GOOD_SHA = 'a'.repeat(40)
const STALE_SHA = 'b'.repeat(40)

const load = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'))

const backendCtx: VerificationContext = {
  liveHeadSha: GOOD_SHA,
  headBranch: 'feat/entry-adapter',
  prNumber: 99,
  changedPaths: ['backend/convex/entries.ts', 'packages/domain/src/index.ts'],
}
const uiCtx: VerificationContext = {
  liveHeadSha: GOOD_SHA,
  headBranch: 'feat/timeline-ui',
  prNumber: 98,
  changedPaths: ['apps/mobile/app/timeline.tsx'],
}
const docsCtx: VerificationContext = {
  liveHeadSha: GOOD_SHA,
  headBranch: 'docs/guide',
  prNumber: 99,
  changedPaths: ['packages/domain/src/index.ts'],
}

const codes = (v: Verdict) => new Set(v.reasons.map((r) => r.code))

describe('requiredSuites (diff → applicable suites)', () => {
  it('requires both suites for code paths', () => {
    expect(requiredSuites(['backend/convex/entries.ts'])).toEqual(['security', 'evaluation'])
    expect(requiredSuites(['packages/domain/src/index.ts'])).toEqual(['security', 'evaluation'])
    expect(requiredSuites(['apps/mobile/app/timeline.tsx'])).toEqual(['security', 'evaluation'])
    expect(requiredSuites(['packages/ui/src/timeline.tsx'])).toEqual(['security', 'evaluation'])
  })
  it('requires nothing for docs/markdown', () => {
    expect(requiredSuites(['README.md', 'docs/guide.md'])).toEqual([])
  })
})

describe('positive controls', () => {
  it('backend-only manifest with full evidence merges', () => {
    const v = validateManifest(load('positive-backend'), backendCtx)
    expect(v.decision).toBe('merge')
    expect(v.reasons).toEqual([])
  })
  it('ui manifest with playable-flow evidence merges', () => {
    const v = validateManifest(load('positive-ui'), uiCtx)
    expect(v.decision).toBe('merge')
    expect(v.reasons).toEqual([])
  })
})

describe('nc1 — stale tested HEAD (contract rule 3/5)', () => {
  it('refuses with stale_head_sha only', () => {
    const v = validateManifest(load('nc1-stale-sha'), backendCtx)
    expect(v.decision).toBe('refuse')
    expect(codes(v)).toEqual(new Set(['stale_head_sha']))
  })
})

describe('nc1b — internal SHA mismatch', () => {
  it('refuses with mismatched_sha only', () => {
    const v = validateManifest(load('nc1b-mismatched-sha'), backendCtx)
    expect(v.decision).toBe('refuse')
    expect(codes(v)).toEqual(new Set(['mismatched_sha']))
  })
})

describe('nc2 — no evidence items', () => {
  it('refuses with missing_evidence', () => {
    const v = validateManifest(load('nc2-missing-evidence'), backendCtx)
    expect(v.decision).toBe('refuse')
    expect(codes(v).has('missing_evidence')).toBe(true)
    expect(codes(v).has('stale_head_sha')).toBe(false)
    expect(codes(v).has('missing_review')).toBe(false)
  })
})

describe('nc3 — hollow playable-flow', () => {
  it('refuses with invalid_playable_flow only', () => {
    const v = validateManifest(load('nc3-invalid-playable-flow'), uiCtx)
    expect(v.decision).toBe('refuse')
    expect(codes(v)).toEqual(new Set(['invalid_playable_flow']))
  })
})

describe('nc4 — unsupported native/device claim', () => {
  it('refuses with native_claim_unsupported only', () => {
    const v = validateManifest(load('nc4-native-claim'), backendCtx)
    expect(v.decision).toBe('refuse')
    expect(codes(v)).toEqual(new Set(['native_claim_unsupported']))
  })
})

describe('nc5 — classification contradicts the live diff', () => {
  it('backend-only claim over UI paths refuses with classification_mismatch only', () => {
    const v = validateManifest(load('nc5-classification-mismatch'), { ...uiCtx, prNumber: 99 })
    expect(v.decision).toBe('refuse')
    expect(codes(v)).toEqual(new Set(['classification_mismatch']))
  })
  it('docs-only claim over source paths refuses with classification_mismatch (and the diff still owes its suites)', () => {
    const v = validateManifest(load('nc5b-docs-mismatch'), docsCtx)
    expect(v.decision).toBe('refuse')
    // The diff touches source, so the classification is wrong AND the
    // suites the real diff requires are unrecorded — both are true failures.
    expect(codes(v)).toEqual(new Set(['classification_mismatch', 'suite_not_recorded']))
  })
})

describe('nc6 — review missing', () => {
  it('refuses with missing_review only', () => {
    const v = validateManifest(load('nc6-no-review'), backendCtx)
    expect(v.decision).toBe('refuse')
    expect(codes(v)).toEqual(new Set(['missing_review']))
  })
})

describe('nc7 — required suites not recorded', () => {
  it('refuses with suite_not_recorded for both applicable suites', () => {
    const v = validateManifest(load('nc7-suites-missing'), backendCtx)
    expect(v.decision).toBe('refuse')
    expect(codes(v).has('suite_not_recorded')).toBe(true)
    expect(v.reasons.filter((r) => r.code === 'suite_not_recorded').length).toBe(2)
  })
})

describe('nc8 — evaluation negative control not recorded', () => {
  it('refuses with suite_negative_control_missing only', () => {
    const v = validateManifest(load('nc8-eval-negative-control-missing'), backendCtx)
    expect(v.decision).toBe('refuse')
    expect(codes(v)).toEqual(new Set(['suite_negative_control_missing']))
  })
})

describe('arena candidate hold (contract rule 8)', () => {
  it('holds regardless of evidence quality', () => {
    const v = validateManifest(load('positive-backend'), { ...backendCtx, headBranch: 'arena/candidate-b' })
    expect(v.decision).toBe('hold')
    expect(codes(v).has('arena_hold')).toBe(true)
  })
})

describe('manifest integrity rules (inline mutations of the positive control)', () => {
  const base = load('positive-backend') as Record<string, unknown>

  it('rejects a wrong manifestVersion', () => {
    const v = validateManifest({ ...base, manifestVersion: 2 }, backendCtx)
    expect(codes(v)).toEqual(new Set(['invalid_manifest']))
  })
  it('rejects a manifest pointed at a different PR', () => {
    const v = validateManifest({ ...base, pr: 100, prUrl: 'https://github.com/OCPdev25/obv-hackaton/pull/100' }, backendCtx)
    expect(codes(v)).toEqual(new Set(['pr_mismatch']))
  })
  it('rejects a failed review (no invented approvals)', () => {
    const mutated = structuredClone(base) as Record<string, unknown>
    ;(mutated.review as Record<string, unknown>).result = 'fail'
    const v = validateManifest(mutated, backendCtx)
    expect(codes(v)).toEqual(new Set(['review_not_passing']))
  })
  it('rejects failed evidence (evidence_result_not_passing)', () => {
    const mutated = structuredClone(base) as Record<string, unknown>
    ;(mutated.evidence as Array<Record<string, unknown>>)[0]!.result = 'fail'
    const v = validateManifest(mutated, backendCtx)
    expect(codes(v)).toEqual(new Set(['evidence_result_not_passing']))
  })
  it('rejects a suite run that failed', () => {
    const mutated = structuredClone(base) as Record<string, unknown>
    ;(mutated.suites as Record<string, Record<string, unknown>>).security.result = 'fail'
    const v = validateManifest(mutated, backendCtx)
    expect(codes(v)).toEqual(new Set(['suite_not_passing']))
  })
  it('rejects non-JSON garbage with invalid_manifest', () => {
    const v = validateManifest('not a manifest', backendCtx)
    expect(v.decision).toBe('refuse')
    expect(codes(v).has('invalid_manifest')).toBe(true)
  })
})

describe('manifest extraction (latest-wins across body and comments)', () => {
  const marker = 'verification-manifest:v1'
  // Recording format: HTML comment marker, then a json fence (GitHub renders
  // the comment invisibly).
  const block = (json: string): string => `<!-- ${marker} -->\n\`\`\`json\n${json}\n\`\`\``

  it('finds the marker block in a PR body', () => {
    const body = `some prose\n\n${block('{"manifestVersion":1}')}\nmore prose`
    const found = extractManifests(body, 'body')
    expect(found.length).toBe(1)
    expect(found[0]!.source).toBe('body')
    expect(found[0]!.ok).toBe(true)
  })
  it('latest valid manifest wins, ordered by comment time then id', () => {
    const body = block('{"manifestVersion":1}')
    const c1 = block('{"manifestVersion":1,"notes":"first comment"}')
    const c2 = block('{"manifestVersion":1,"notes":"second comment"}')
    const blocks = [
      ...extractManifests(body, 'body'),
      ...extractManifests(c1, 'comment 1'),
      ...extractManifests(c2, 'comment 2'),
    ]
    expect(blocks.length).toBe(3)
    const latest = latestManifest(blocks)
    expect(latest?.ok).toBe(true)
    if (latest?.ok) expect((latest.raw as { notes?: string }).notes).toBe('second comment')
  })
  it('a later malformed marker block invalidates rather than falling back', () => {
    const c1 = block('{"manifestVersion":1,"notes":"good"}')
    const c2 = `<!-- ${marker} -->\n\`\`\`json\n{"manifestVersion":1, broken\n\`\`\``
    const blocks = [...extractManifests(c1, 'comment 1'), ...extractManifests(c2, 'comment 2')]
    expect(blocks.length).toBe(2)
    expect(blocks[0]!.ok).toBe(true)
    expect(blocks[1]!.ok).toBe(false)
    const latest = latestManifest(blocks)
    expect(latest?.ok).toBe(false)
  })
  it('ignores prose mentioning the marker without a fenced block', () => {
    const body = `we should add a <!-- ${marker} --> block here`
    expect(extractManifests(body, 'body').length).toBe(0)
  })
})
