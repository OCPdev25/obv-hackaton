/**
 * Pure merge-eligibility validator for PR verification manifests.
 *
 * PR #10 policy → executable. I/O-free by design: callers build a
 * VerificationContext from live GitHub state (verification/src/gh.ts); every
 * rule below is pinned by a positive or negative control in
 * verification/test/validate.test.ts.
 *
 * Rules implemented (contract rule references are .obvious/obvious.md):
 *   R1  manifest structure          — schema/version/SHA shape (invalid_manifest)
 *   R2  PR identity                 — pr number + prUrl match the live PR (pr_mismatch)
 *   R3  arena hold                  — arena/candidate-* → hold (rule 8)
 *   R4  HEAD freshness              — testedHeadSha === live head; internal SHAs
 *                                     (review, checks, evidence, suites) all equal
 *                                     testedHeadSha (rules 3 & 5: stale/mismatched)
 *   R5  independent review recorded — pass | pass-with-notes, reviewer, date,
 *                                     link, reviewed HEAD (rules 2–3)
 *   R6  checks                      — ≥1 named green check on the tested HEAD
 *                                     (rule 4; live greenness is verified by the sweep)
 *   R7  evidence                    — ≥1 passing item on the tested HEAD; UI also
 *                                     needs playable-flow with scenario,
 *                                     assertions, environment; backend-only needs
 *                                     executable behavior evidence
 *   R8  classification              — backend-only/docs-only need justification;
 *                                     claimed class must match the actual diff
 *                                     (unsupported claims refuse)
 *   R9  native claims               — on-device/simulator/TestFlight-style claims
 *                                     require passing playable-flow evidence with
 *                                     environment + link, else refuse
 *   R10 applicable suites          — diffs touching code require security and
 *                                     evaluation suite runs (incl. the evaluation
 *                                     negative control) on the tested HEAD
 */
import type { Reason, ReasonCode, SuiteName, VerificationContext, Verdict } from './types.ts'
import { SHA_RE, short } from './types.ts'

const UI_PATH_RE = /^(apps\/|packages\/ui\/)/
const CODE_PATH_RE = /^(apps\/|backend\/|packages\/|security\/|evaluation\/)/
const DOCS_PATH_RE = /^(docs\/.*|.*\.md)$/

const NATIVE_CLAIM_RE =
  /\b(on[\s-]?device|physical device|native device|native build|device build|simulator|emulator|expo go|testflight)\b/i

const EVIDENCE_KINDS = ['playable-flow', 'behavior-run', 'test-run', 'suite-run'] as const
const CLASSIFICATIONS = ['ui', 'backend-only', 'docs-only'] as const

/**
 * Suites applicable to a diff. Both suites are fast (17 access cases + 6
 * fixtures) and both exercise contracts any code change can perturb, so any
 * change under a code path requires both; docs-only requires neither.
 */
export function requiredSuites(changedPaths: string[]): SuiteName[] {
  return changedPaths.some((p) => CODE_PATH_RE.test(p)) ? ['security', 'evaluation'] : []
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): v is string {
  return typeof v === 'string'
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function shaOk(v: unknown): v is string {
  return str(v) && SHA_RE.test(v)
}

export function validateManifest(raw: unknown, ctx: VerificationContext): Verdict {
  const reasons: Reason[] = []
  const add = (code: ReasonCode, detail: string): void => reasons.push({ code, detail })

  if (!isRecord(raw)) {
    add('invalid_manifest', 'manifest is not a JSON object')
    return decide(reasons)
  }
  const m = raw as Record<string, unknown>

  // --- R1: structure ---------------------------------------------------------
  if (m.manifestVersion !== 1) {
    add('invalid_manifest', `manifestVersion must be 1, got ${JSON.stringify(m.manifestVersion)}`)
  }
  const testedHeadSha = m.testedHeadSha
  if (!shaOk(testedHeadSha)) {
    add('invalid_manifest', 'testedHeadSha must be a 40-char hex SHA')
  }
  if (!shaOk(ctx.liveHeadSha)) {
    throw new Error(`VerificationContext.liveHeadSha is not a 40-char hex SHA: ${String(ctx.liveHeadSha)}`)
  }

  // --- R2: PR identity -------------------------------------------------------
  if (m.pr !== ctx.prNumber) {
    add('pr_mismatch', `manifest targets PR ${JSON.stringify(m.pr)} but validates PR ${ctx.prNumber}`)
  }
  if (m.prUrl !== `https://github.com/OCPdev25/obv-hackaton/pull/${ctx.prNumber}`) {
    add('pr_mismatch', `prUrl must be https://github.com/OCPdev25/obv-hackaton/pull/${ctx.prNumber}, got ${JSON.stringify(m.prUrl)}`)
  }

  // --- R3: arena hold --------------------------------------------------------
  if (/^arena\/candidate-/.test(ctx.headBranch)) {
    add(
      'arena_hold',
      `branch ${ctx.headBranch} is an arena candidate — excluded from individual auto-merge until arena selection completes (contract rule 8)`,
    )
  }

  // --- R4: HEAD freshness (live + internal) ----------------------------------
  if (shaOk(testedHeadSha) && testedHeadSha !== ctx.liveHeadSha) {
    add(
      'stale_head_sha',
      `manifest tested ${short(testedHeadSha)} but PR HEAD is ${short(ctx.liveHeadSha)} — results from an earlier commit do not carry over (contract rule 5)`,
    )
  }
  const headMatch = (sha: unknown, what: string): void => {
    if (!shaOk(sha)) {
      add('invalid_manifest', `${what} must be a 40-char hex SHA`)
    } else if (shaOk(testedHeadSha) && sha !== testedHeadSha) {
      add('mismatched_sha', `${what} is on ${short(sha)} but the manifest tested ${short(testedHeadSha)}`)
    }
  }

  // --- R5: independent review ------------------------------------------------
  const review = m.review
  if (!isRecord(review)) {
    add('missing_review', 'manifest records no review object')
  } else {
    if (review.result !== 'pass' && review.result !== 'pass-with-notes') {
      add('review_not_passing', `review.result must be "pass" or "pass-with-notes", got ${JSON.stringify(review.result)}`)
    }
    if (!nonEmpty(review.reviewer)) {
      add('invalid_review_fields', 'review.reviewer must name the independent reviewer')
    }
    if (!str(review.date) || !/^\d{4}-\d{2}-\d{2}$/.test(review.date)) {
      add('invalid_review_fields', 'review.date must be YYYY-MM-DD')
    }
    if (!nonEmpty(review.url)) {
      add('invalid_review_fields', 'review.url must link to the review thread/comment')
    }
    if (shaOk(review.reviewedHeadSha) && shaOk(testedHeadSha) && review.reviewedHeadSha !== testedHeadSha) {
      add('mismatched_sha', `review covered ${short(review.reviewedHeadSha)} but the manifest tested ${short(testedHeadSha)}`)
    } else {
      headMatch(review.reviewedHeadSha, 'review.reviewedHeadSha')
    }
  }

  // --- R6: checks (manifest-level; live greenness is the sweep's job) --------
  const checks = m.checks
  if (!Array.isArray(checks) || checks.length === 0) {
    add('missing_checks', 'manifest records no CI checks')
  } else {
    for (const [i, c] of checks.entries()) {
      if (!isRecord(c) || !nonEmpty(c.name) || c.status !== 'green' || !nonEmpty(c.url)) {
        add('missing_checks', `checks[${i}] must be { name, status: "green", headSha, url }`)
        continue
      }
      headMatch(c.headSha, `check "${c.name}"`)
    }
  }

  // --- R7: evidence ----------------------------------------------------------
  const evidence = m.evidence
  const items: Array<Record<string, unknown>> = Array.isArray(evidence) ? evidence.filter(isRecord) : []
  if (!Array.isArray(evidence) || evidence.length === 0) {
    add('missing_evidence', 'manifest records no evidence items')
  } else {
    if (items.length !== evidence.length) {
      add('invalid_manifest', 'evidence must be an array of objects')
    }
    for (const [i, e] of items.entries()) {
      const label = `evidence[${i}]`
      if (!nonEmpty(e.name) || !nonEmpty(e.url)) {
        add('invalid_manifest', `${label} needs a non-empty name and url`)
      }
      if (!str(e.kind) || !EVIDENCE_KINDS.includes(e.kind)) {
        add('invalid_manifest', `${label}.kind must be one of ${EVIDENCE_KINDS.join(', ')}`)
      }
      headMatch(e.headSha, `${label}`)
      if (e.result !== 'pass') {
        add('evidence_result_not_passing', `${label}.result must be "pass" — failing runs are not merge evidence`)
      }
      if (e.kind === 'playable-flow') {
        const missing: string[] = []
        if (!nonEmpty(e.scenario)) missing.push('scenario')
        if (!Array.isArray(e.assertions) || e.assertions.length === 0 || !e.assertions.every(nonEmpty)) {
          missing.push('assertions')
        }
        if (!nonEmpty(e.environment)) missing.push('environment')
        if (missing.length > 0) {
          add('invalid_playable_flow', `${label} is playable-flow but missing ${missing.join(', ')}`)
        }
      }
    }
  }

  // --- R8: classification ----------------------------------------------------
  const classification = m.classification
  if (!str(classification) || !CLASSIFICATIONS.includes(classification)) {
    add('invalid_manifest', `classification must be one of ${CLASSIFICATIONS.join(', ')}`)
  }
  const justification = m.classificationJustification
  if ((classification === 'backend-only' || classification === 'docs-only') && !nonEmpty(justification)) {
    add(
      'classification_justification_required',
      `classification "${String(classification)}" requires a non-empty classificationJustification`,
    )
  }
  if (str(classification)) {
    if (classification === 'ui' && !ctx.changedPaths.some((p) => UI_PATH_RE.test(p))) {
      add('classification_mismatch', 'classified "ui" but no changed path is a UI path (apps/** or packages/ui/**)')
    }
    if (classification === 'backend-only' && ctx.changedPaths.some((p) => UI_PATH_RE.test(p))) {
      add(
        'classification_mismatch',
        'classified "backend-only" but the diff touches UI paths (apps/** or packages/ui/**) — reclassify "ui" and supply playable-flow evidence',
      )
    }
    if (classification === 'docs-only' && ctx.changedPaths.some((p) => !DOCS_PATH_RE.test(p))) {
      add('classification_mismatch', 'classified "docs-only" but the diff touches non-documentation paths')
    }
    if (classification === 'backend-only') {
      const behavior = items.some(
        (e) => e.kind === 'behavior-run' || e.kind === 'test-run' || e.kind === 'suite-run',
      )
      if (!behavior) {
        add(
          'missing_evidence',
          'backend-only requires executable behavior evidence (behavior-run | test-run | suite-run) on the tested HEAD',
        )
      }
    }
    if (classification === 'ui') {
      const playable = items.some((e) => e.kind === 'playable-flow')
      if (!playable) {
        add(
          'no_playable_flow',
          'ui changes require at least one playable-flow evidence item (scenario, assertions, environment, linked to the tested HEAD)',
        )
      }
    }
  }

  // --- R9: native/device claims ---------------------------------------------
  const claimParts = [
    nonEmpty(justification) ? justification : '',
    nonEmpty(m.notes) ? m.notes : '',
    ...items.flatMap((e) => [nonEmpty(e.name) ? e.name : '', nonEmpty(e.scenario) ? e.scenario : '', nonEmpty(e.environment) ? e.environment : '']),
  ]
  if (claimParts.some((p) => NATIVE_CLAIM_RE.test(p))) {
    const playable = items.some(
      (e) => e.kind === 'playable-flow' && e.result === 'pass' && nonEmpty(e.environment) && nonEmpty(e.url),
    )
    if (!playable) {
      add(
        'native_claim_unsupported',
        'manifest claims native/device verification but records no passing playable-flow evidence with environment + link — supply the evidence or drop the claim',
      )
    }
  }

  // --- R10: applicable suites ------------------------------------------------
  for (const suite of requiredSuites(ctx.changedPaths)) {
    const suites = isRecord(m.suites) ? m.suites : {}
    const rec = suites[suite]
    if (!isRecord(rec)) {
      add('suite_not_recorded', `suite "${suite}" is applicable to this diff but the manifest records no run (see verification/README.md)`)
      continue
    }
    if (!nonEmpty(rec.url)) {
      add('suite_not_recorded', `suite "${suite}" needs a run URL`)
    }
    if (rec.ran !== true || rec.result !== 'pass') {
      add('suite_not_passing', `suite "${suite}" must be recorded as ran: true, result: "pass"`)
      continue
    }
    headMatch(rec.headSha, `suite "${suite}"`)
    if (suite === 'evaluation' && rec.negativeControl !== 'fail-as-expected') {
      add(
        'suite_negative_control_missing',
        'evaluation suite requires negativeControl "fail-as-expected" — the broken-adapter control must be recorded as failing',
      )
    }
  }

  return decide(reasons)
}

function decide(reasons: Reason[]): Verdict {
  if (reasons.some((r) => r.code === 'arena_hold')) return { decision: 'hold', reasons }
  return reasons.length === 0 ? { decision: 'merge', reasons: [] } : { decision: 'refuse', reasons }
}
