/**
 * Verification manifest v1 — types for the executable verification gate.
 *
 * Policy source: `.obvious/obvious.md` → "Review → repair → merge workflow"
 * (merged via PR #10, squash 241ffe6). A PR's workers record one manifest as a
 * PR comment (marker + fenced JSON, see verification/README.md); the validator
 * (verification/src/validate.ts) decides merge eligibility from it against the
 * live PR state.
 *
 * Design constraints:
 * - Zero dependencies (runs under `bun` directly, standalone like `security/`
 *   and `evaluation/` — not a pnpm workspace member).
 * - Reason codes are stable and documented in verification/README.md; the test
 *   suite pins the exact reason set per control, so a validator that refuses
   * for the wrong reason also fails (same discipline as security/access).
 */

export type Classification = 'ui' | 'backend-only' | 'docs-only'
export type EvidenceKind = 'playable-flow' | 'behavior-run' | 'test-run' | 'suite-run'
export type SuiteName = 'security' | 'evaluation'

export interface EvidenceItem {
  kind: EvidenceKind
  name: string
  /** 40-hex — evidence only counts for the exact tested HEAD (contract rule 3) */
  headSha: string
  result: 'pass' | 'fail'
  url: string
  /** playable-flow only: what a person did in the running app */
  scenario?: string
  /** playable-flow only: assertions observed on screen/state */
  assertions?: string[]
  /** playable-flow only: where it ran (device/simulator/browser + data note) */
  environment?: string
}

export interface SuiteRun {
  ran: boolean
  result: 'pass' | 'fail'
  headSha: string
  url: string
  /** evaluation only: the broken-adapter negative control ran and failed as expected */
  negativeControl?: 'fail-as-expected'
}

export interface VerificationManifest {
  manifestVersion: 1
  pr: number
  prUrl: string
  /** 40-hex — exact HEAD the review and every evidence item ran against */
  testedHeadSha: string
  classification: Classification
  /** required for backend-only and docs-only */
  classificationJustification?: string
  review: {
    result: 'pass' | 'pass-with-notes'
    reviewer: string
    reviewedHeadSha: string
    date: string
    url: string
  }
  checks: Array<{ name: string; status: 'green'; headSha: string; url: string }>
  evidence: EvidenceItem[]
  suites?: Partial<Record<SuiteName, SuiteRun>>
  notes?: string
}

/** Stable refusal/hold codes — documented in verification/README.md, pinned by tests. */
export type ReasonCode =
  | 'invalid_manifest'
  | 'arena_hold'
  | 'stale_head_sha'
  | 'mismatched_sha'
  | 'pr_mismatch'
  | 'missing_evidence'
  | 'evidence_result_not_passing'
  | 'invalid_playable_flow'
  | 'no_playable_flow'
  | 'missing_review'
  | 'review_not_passing'
  | 'invalid_review_fields'
  | 'missing_checks'
  | 'classification_justification_required'
  | 'classification_mismatch'
  | 'native_claim_unsupported'
  | 'suite_not_recorded'
  | 'suite_not_passing'
  | 'suite_negative_control_missing'

export interface Reason {
  code: ReasonCode
  detail: string
}

/**
 * merge  — every applicable rule satisfied for the live context
 * refuse — a policy rule failed; the merge owner must not merge
 * hold   — arena/candidate-* branch: waits for arena selection regardless of
 *          manifest quality (contract rule 8)
 */
export type Decision = 'merge' | 'refuse' | 'hold'

export interface Verdict {
  decision: Decision
  reasons: Reason[]
}

export interface VerificationContext {
  /** live PR head SHA at validation time (gh pr view → headRefOid) */
  liveHeadSha: string
  /** PR head branch name (drives the arena/candidate-* hold) */
  headBranch: string
  /** live PR number */
  prNumber: number
  /** paths changed by the PR (gh pr diff --name-only) — drives classification and suite applicability */
  changedPaths: string[]
}

export const SHA_RE = /^[0-9a-f]{40}$/

export const REPO = 'OCPdev25/obv-hackaton'

export function short(sha: string): string {
  return SHA_RE.test(sha) ? sha.slice(0, 12) : sha
}
