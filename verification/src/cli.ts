/**
 * Verification gate CLI (runs under bun; zero dependencies).
 *
 * Commands:
 *   check        — offline validation of a manifest file against a synthetic
 *                  context (tests, fixtures, local what-ifs)
 *   validate-pr  — live validation of the PR's recorded manifest; strict when a
 *                  manifest exists, advisory when absent (CI mode), refusing
 *                  when absent with --require (merge-owner mode)
 *   sweep        — the serialized merge owner's gate: preflight refusals, live
 *                  green checks on the exact head SHA, manifest validation,
 *                  then merge (or dry-run) + receipt
 *
 * Exit codes: 0 = merge/would-merge/not-applicable · 1 = refuse/hold ·
 * 2 = environment error (gh/network).
 */
import { extractManifests, latestManifest, type ExtractedManifest } from './manifest.ts'
import { validateManifest, requiredSuites } from './validate.ts'
import {
  liveChecks, masterSha, mergeSquash, postPrComment, prBody, prChangedPaths, prComments, prView, sleep,
} from './gh.ts'
import { short, type VerificationContext, type Verdict } from './types.ts'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// --- arg plumbing -----------------------------------------------------------

function args(): Map<string, string> {
  const map = new Map<string, string>()
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 2) {
        map.set(a.slice(2, eq), a.slice(eq + 1))
        continue
      }
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        map.set(key, next)
        i++
      } else {
        map.set(key, '')
      }
    }
  }
  return map
}

function need(map: Map<string, string>, key: string): string {
  const v = map.get(key)
  if (v === undefined || v === '') {
    console.error(`missing required --${key}`)
    process.exit(2)
  }
  return v
}

function printVerdict(v: Verdict): void {
  for (const r of v.reasons) console.log(`  ✗ ${r.code}: ${r.detail}`)
  if (v.reasons.length === 0) console.log('  ✓ all applicable rules satisfied')
  console.log(`VERDICT ${JSON.stringify({ decision: v.decision, reasons: v.reasons.map((r) => r.code) })}`)
}

// --- check (offline) ---------------------------------------------------------

function cmdCheck(): number {
  const map = args()
  const file = need(map, 'file')
  const pr = Number(need(map, 'pr'))
  const head = need(map, 'head')
  const branch = need(map, 'branch')
  const paths = (map.get('paths') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    console.error(`could not read/parse ${file}: ${String(err)}`)
    return 2
  }
  const ctx: VerificationContext = { liveHeadSha: head, headBranch: branch, prNumber: pr, changedPaths: paths }
  const verdict = validateManifest(raw, ctx)
  console.log(`offline check: ${file} (pr=${pr} head=${short(head)} branch=${branch} paths=[${paths.join(', ')}])`)
  console.log(`required suites from diff: ${requiredSuites(paths).join(', ') || 'none'}`)
  printVerdict(verdict)
  return verdict.decision === 'merge' ? 0 : 1
}

// --- manifest collection (live) ----------------------------------------------

function collectManifestBlocks(n: number): { ok: true; latest?: ExtractedManifest } | { ok: false; err: string } {
  const bodyRes = prBody(n)
  if (!bodyRes.ok) return { ok: false, err: bodyRes.err }
  const commentsRes = prComments(n)
  if (!commentsRes.ok) return { ok: false, err: commentsRes.err }

  const blocks = [
    ...extractManifests(bodyRes.body, 'PR body'),
    ...commentsRes.comments.flatMap((c) => extractManifests(c.body, `comment ${c.id} (${c.createdAt})`)),
  ]
  return { ok: true, latest: latestManifest(blocks) }
}

// --- validate-pr (live) --------------------------------------------------------

function cmdValidatePr(): number {
  const map = args()
  const n = Number(need(map, 'pr'))
  const requireManifest = map.has('require')

  const view = prView(n)
  if (!view.ok) {
    console.error(`gh pr view failed: ${view.err}`)
    return 2
  }
  const pr = view.pr
  const diff = prChangedPaths(n)
  if (!diff.ok) {
    console.error(`gh pr diff failed: ${diff.err}`)
    return 2
  }
  const ctx: VerificationContext = {
    liveHeadSha: pr.headRefOid,
    headBranch: pr.headRefName,
    prNumber: pr.number,
    changedPaths: diff.paths,
  }

  console.log(`validate-pr: PR #${pr.number} "${pr.title}" head=${short(pr.headRefOid)} branch=${pr.headRefName}`)
  console.log(`changed paths (${ctx.changedPaths.length}): ${ctx.changedPaths.join(', ') || '(none)'}`)
  console.log(`required suites from diff: ${requiredSuites(ctx.changedPaths).join(', ') || 'none'}`)

  const collected = collectManifestBlocks(n)
  if (!collected.ok) {
    console.error(collected.err)
    return 2
  }
  if (collected.latest === undefined) {
    if (requireManifest) {
      console.log('✗ manifest_missing: no verification manifest recorded on this PR — merge gate refuses (verification/README.md)')
      console.log('VERDICT {"decision":"refuse","reasons":["manifest_missing"]}')
      return 1
    }
    console.log('ℹ no verification manifest recorded yet — PR is not merge-eligible until one is; nothing to validate (CI mode)')
    console.log('VERDICT {"decision":"refuse","reasons":["manifest_missing"],"advisory":true}')
    return 0
  }
  if (!collected.latest.ok) {
    console.log(`✗ invalid_manifest: latest manifest block (${collected.latest.source}) does not parse: ${collected.latest.error}`)
    console.log('VERDICT {"decision":"refuse","reasons":["invalid_manifest"]}')
    return 1
  }

  const verdict = validateManifest(collected.latest.raw, ctx)
  console.log(`validating latest manifest (${collected.latest.source}) against live head ${short(pr.headRefOid)}`)
  printVerdict(verdict)
  return verdict.decision === 'merge' ? 0 : 1
}

// --- sweep (merge owner) -------------------------------------------------------

function cmdSweep(): number {
  const map = args()
  const n = Number(need(map, 'pr'))
  const owner = need(map, 'owner')
  const dryRun = map.has('dry-run')
  const smoke = map.has('smoke')
  const postReceipt = map.has('post-receipt')

  console.log(`merge sweep (owner: ${owner})${dryRun ? ' — DRY RUN' : ''}`)

  const view = prView(n)
  if (!view.ok) {
    console.error(`gh pr view failed: ${view.err}`)
    return 2
  }
  const pr = view.pr
  console.log(`PR #${pr.number} "${pr.title}" state=${pr.state} draft=${pr.isDraft} base=${pr.baseRefName} head=${short(pr.headRefOid)} branch=${pr.headRefName} url=${pr.url}`)

  if (pr.state === 'MERGED') {
    console.log('✗ already_merged: this PR is already merged; nothing to do')
    console.log('VERDICT {"decision":"refuse","reasons":["already_merged"]}')
    return 1
  }
  if (pr.state !== 'OPEN') {
    console.log('✗ not_open: PR is not open — refusing')
    console.log('VERDICT {"decision":"refuse","reasons":["not_open"]}')
    return 1
  }
  if (pr.isDraft) {
    console.log('✗ draft: PR is a draft — refusing (mark ready and record a verification manifest first)')
    console.log('VERDICT {"decision":"refuse","reasons":["draft"]}')
    return 1
  }
  if (pr.baseRefName !== 'master') {
    console.log(`✗ wrong_base: PR targets ${pr.baseRefName}, not master — refusing (master is the only PR target)`)
    console.log('VERDICT {"decision":"refuse","reasons":["wrong_base"]}')
    return 1
  }

  const diff = prChangedPaths(n)
  if (!diff.ok) {
    console.error(`gh pr diff failed: ${diff.err}`)
    return 2
  }

  const ctx: VerificationContext = {
    liveHeadSha: pr.headRefOid,
    headBranch: pr.headRefName,
    prNumber: pr.number,
    changedPaths: diff.paths,
  }
  console.log(`changed paths (${ctx.changedPaths.length}): ${ctx.changedPaths.join(', ') || '(none)'}`)
  console.log(`required suites from diff: ${requiredSuites(ctx.changedPaths).join(', ') || 'none'}`)

  // Arena hold (contract rule 8) — decided before anything else: candidates are
  // excluded from individual auto-merge until selection, whatever their evidence.
  if (/^arena\/candidate-/.test(pr.headRefName)) {
    console.log(`⏸ arena_hold: branch ${pr.headRefName} is an arena candidate — excluded from individual auto-merge until arena selection completes`)
    console.log('VERDICT {"decision":"hold","reasons":["arena_hold"]}')
    return 1
  }

  const live = liveChecks(pr.headRefOid)
  if (!live.ok) {
    console.error(live.err)
    return 2
  }
  console.log(`live checks on ${short(pr.headRefOid)}: ${live.checks.detail}`)
  if (!live.checks.any) {
    console.log('✗ no_live_checks: no check runs or commit statuses on the head SHA — checks-green-required cannot be verified')
    console.log('VERDICT {"decision":"refuse","reasons":["no_live_checks"]}')
    return 1
  }
  if (live.checks.pending > 0) {
    console.log(`✗ live_checks_pending: ${live.checks.pending} check(s) still running — merge refused until all are terminal`)
    console.log('VERDICT {"decision":"refuse","reasons":["live_checks_pending"]}')
    return 1
  }
  if (live.checks.failed > 0) {
    console.log(`✗ live_checks_failed: ${live.checks.failed} check(s) red on the head SHA`)
    console.log('VERDICT {"decision":"refuse","reasons":["live_checks_failed"]}')
    return 1
  }

  const collected = collectManifestBlocks(n)
  if (!collected.ok) {
    console.error(collected.err)
    return 2
  }
  if (collected.latest === undefined) {
    console.log('✗ manifest_missing: no verification manifest recorded on this PR (marker + fenced JSON, verification/README.md) — refusing')
    console.log('VERDICT {"decision":"refuse","reasons":["manifest_missing"]}')
    return 1
  }
  if (!collected.latest.ok) {
    console.log(`✗ invalid_manifest: latest manifest block (${collected.latest.source}) does not parse: ${collected.latest.error}`)
    console.log('VERDICT {"decision":"refuse","reasons":["invalid_manifest"]}')
    return 1
  }

  const verdict = validateManifest(collected.latest.raw, ctx)
  console.log(`manifest from ${collected.latest.source}:`)
  printVerdict(verdict)

  if (verdict.decision !== 'merge') {
    console.log(`→ refusing to merge PR #${n} (${verdict.decision})`)
    return 1
  }

  if (dryRun) {
    console.log(`→ ELIGIBLE: PR #${n} would merge now (--squash) — dry run, no merge executed`)
    printReceipt(pr, collected.latest.raw as Record<string, unknown>, '(dry run — no merge commit)')
    return 0
  }

  console.log(`→ merging PR #${n} with --squash (single serialized merge owner: ${owner})`)
  const merge = mergeSquash(n)
  if (!merge.ok) {
    console.error(`merge failed: ${merge.err}`)
    return 2
  }

  const preMaster = masterSha()
  let mergeSha = '(lookup pending)'
  for (let i = 0; i < 10; i++) {
    sleep(3000)
    const now = masterSha()
    if (now.ok && now.sha !== preMaster.sha) {
      mergeSha = now.sha
      break
    }
  }
  console.log(`merge commit on master: ${mergeSha}`)
  printReceipt(pr, collected.latest.raw as Record<string, unknown>, mergeSha)

  if (smoke && /^[0-9a-f]{40}$/.test(mergeSha)) {
    const code = runSmoke(mergeSha)
    if (code !== 0) {
      console.error('post-merge smoke FAILED — investigate before treating downstream tasks as unlocked')
      return code
    }
  }

  if (postReceipt) {
    const receipt = renderReceipt(pr, collected.latest.raw as Record<string, unknown>, mergeSha, smoke ? 'ran via --smoke (see sweep log)' : 'pending — run the local verification table on the merge commit')
    const posted = postPrComment(n, receipt)
    if (!posted.ok) {
      console.error(`receipt post failed (merge itself succeeded): ${posted.err}`)
      return 2
    }
    console.log('receipt posted as PR comment')
  }

  return 0
}

function renderReceipt(pr: { url: string; number: number }, manifest: Record<string, unknown>, mergeSha: string, smoke: string): string {
  const review = manifest.review as { result?: string; reviewer?: string; date?: string; url?: string }
  const checks = (manifest.checks as Array<{ name?: string }> | undefined) ?? []
  const head = String(manifest.testedHeadSha ?? '')
  return [
    '### Evidence receipt (verification gate)',
    '',
    '```',
    `PR:               ${pr.url}`,
    `Tested head SHA:  ${head}`,
    `Review result:    ${review?.result ?? '?'} — ${review?.reviewer ?? '?'}, ${review?.date ?? '?'} (${review?.url ?? '?'})`,
    `Checks:           ${checks.map((c) => c.name).join(', ')} — green on ${head}`,
    `Merge commit:     ${mergeSha}`,
    `Post-merge smoke: ${smoke}`,
    'Unlocked tasks:   (merge owner fills)',
    '```',
  ].join('\n')
}

function printReceipt(pr: { url: string }, manifest: Record<string, unknown>, mergeSha: string): void {
  console.log('----- evidence receipt (fill "Unlocked tasks"; record per contract) -----')
  console.log(renderReceipt(pr, manifest, mergeSha, 'pending — run the local verification table on the merge commit'))
}

/** Post-merge smoke: full local verification table on the merge commit (temp worktree). */
function runSmoke(sha: string): number {
  const worktree = `/tmp/verification-smoke-${Date.now()}`
  console.log(`post-merge smoke on ${short(sha)} (worktree ${worktree})`)
  const steps: Array<[string, string]> = [
    ['fetch', `git fetch origin master`],
    ['worktree', `git worktree add --detach ${worktree} ${sha}`],
    ['install', `cd ${worktree} && corepack pnpm install --frozen-lockfile`],
    ['verify', `cd ${worktree} && pnpm turbo run typecheck test build`],
    ['security', `cd ${worktree} && bun test ./security`],
    ['evaluation', `cd ${worktree}/evaluation && bun src/run.ts && bun src/run.ts --adapter=./src/example/broken-adapter.ts --expect-failure`],
  ]
  for (const [label, cmd] of steps) {
    console.log(`  smoke/${label}…`)
    const res = spawnSync('bash', ['-c', cmd], { stdio: 'inherit', env: process.env })
    if (res.status !== 0) {
      console.error(`  smoke/${label} exited ${res.status}`)
      return res.status ?? 1
    }
  }
  spawnSync('bash', ['-c', `git worktree remove --force ${worktree || ''} 2>/dev/null || true`], { stdio: 'ignore' })
  console.log('post-merge smoke: PASS')
  return 0
}


// --- main ----------------------------------------------------------------------

function main(): number {
  const command = process.argv[2]
  switch (command) {
    case 'check':
      return cmdCheck()
    case 'validate-pr':
      return cmdValidatePr()
    case 'sweep':
      return cmdSweep()
    default:
      console.error(`usage: bun verification/src/cli.ts <check|validate-pr|sweep> [flags]
  check        --file=<manifest.json> --pr=<n> --head=<sha> --branch=<name> --paths=a,b
  validate-pr  --pr=<n> [--require]        (strict when a manifest exists; --require refuses when absent)
  sweep        --pr=<n> --owner=<name> [--dry-run] [--smoke] [--post-receipt]`)
      return 2
  }
}

process.exitCode = main()
