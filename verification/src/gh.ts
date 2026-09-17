/**
 * Thin read-mostly `gh` CLI wrappers for the verification CLI.
 *
 * Auth: uses whatever `gh` is configured with (GH_TOKEN in CI, gh auth in the
 * sandbox). No credentials are read, written, or stored here. All calls are
 * read-only except mergeSquash and postPrComment (both explicit merge-owner
 * actions).
 */
import { spawnSync } from 'node:child_process'
import { REPO } from './types.ts'

export interface GhResult {
  ok: boolean
  out: string
  err: string
}

function gh(args: string[]): GhResult {
  const res = spawnSync('gh', args, { encoding: 'utf8', env: process.env, maxBuffer: 16 * 1024 * 1024 })
  if (res.error) return { ok: false, out: '', err: `gh failed to run: ${res.error.message}` }
  if (res.status !== 0) return { ok: false, out: res.stdout, err: (res.stderr || res.stdout || `gh ${args.join(' ')} exited ${res.status}`).trim() }
  return { ok: true, out: res.stdout, err: '' }
}

export interface PrView {
  number: number
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  baseRefName: string
  headRefName: string
  headRefOid: string
  url: string
  title: string
}

export function prView(n: number): { ok: true; pr: PrView } | { ok: false; err: string } {
  const res = gh([
    'pr', 'view', String(n), '--repo', REPO,
    '--json', 'number,state,isDraft,baseRefName,headRefName,headRefOid,url,title',
  ])
  if (!res.ok) return { ok: false, err: res.err }
  try {
    return { ok: true, pr: JSON.parse(res.out) as PrView }
  } catch (err) {
    return { ok: false, err: `could not parse gh pr view output: ${String(err)}` }
  }
}

export function prBody(n: number): { ok: true; body: string } | { ok: false; err: string } {
  const res = gh(['pr', 'view', String(n), '--repo', REPO, '--json', 'body', '--jq', '.body'])
  return res.ok ? { ok: true, body: res.out } : { ok: false, err: res.err }
}

export interface PrComment {
  id: number
  createdAt: string
  body: string
}

/** Issue comments on the PR, chronological (GitHub returns ascending). */
export function prComments(n: number): { ok: true; comments: PrComment[] } | { ok: false; err: string } {
  const res = gh(['api', `repos/${REPO}/issues/${n}/comments?per_page=100`])
  if (!res.ok) return { ok: false, err: res.err }
  try {
    const parsed = JSON.parse(res.out) as Array<{ id: number; created_at: string; body: string }>
    const comments = parsed
      .map((c) => ({ id: c.id, createdAt: c.created_at, body: c.body }))
      .sort((a, b) => (a.createdAt === b.createdAt ? a.id - b.id : a.createdAt < b.createdAt ? -1 : 1))
    return { ok: true, comments }
  } catch (err) {
    return { ok: false, err: `could not parse PR comments: ${String(err)}` }
  }
}

/** Changed file paths on the PR (names only). */
export function prChangedPaths(n: number): { ok: true; paths: string[] } | { ok: false; err: string } {
  const res = gh(['pr', 'diff', String(n), '--repo', REPO, '--name-only'])
  if (!res.ok) return { ok: false, err: res.err }
  return { ok: true, paths: res.out.split('\n').map((s) => s.trim()).filter(Boolean) }
}

export interface LiveChecks {
  /** any check run or commit status present at all */
  any: boolean
  pending: number
  failed: number
  allGreen: boolean
  names: string[]
  detail: string
}

/**
 * Live check state for an exact SHA — check runs (Actions) plus legacy commit
 * statuses. Single page per source (>100 checks per commit would need
 * pagination; documented as a factual limit in verification/README.md).
 */
export function liveChecks(sha: string): { ok: true; checks: LiveChecks } | { ok: false; err: string } {
  const names: string[] = []
  let pending = 0
  let failed = 0
  let any = false

  const cr = gh(['api', `repos/${REPO}/commits/${sha}/check-runs`])
  if (!cr.ok) return { ok: false, err: `check-runs lookup failed: ${cr.err}` }
  try {
    const parsed = JSON.parse(cr.out) as { total_count: number; check_runs: Array<{ name: string; status: string; conclusion: string | null }> }
    for (const run of parsed.check_runs ?? []) {
      any = true
      if (run.status !== 'completed') {
        pending += 1
        names.push(`${run.name} (${run.status})`)
      } else if (run.conclusion !== 'success' && run.conclusion !== 'neutral' && run.conclusion !== 'skipped') {
        failed += 1
        names.push(`${run.name} (${run.conclusion})`)
      } else {
        names.push(`${run.name} (${run.conclusion})`)
      }
    }
  } catch (err) {
    return { ok: false, err: `could not parse check-runs: ${String(err)}` }
  }

  const st = gh(['api', `repos/${REPO}/commits/${sha}/status`])
  if (!st.ok) return { ok: false, err: `commit status lookup failed: ${st.err}` }
  try {
    const parsed = JSON.parse(st.out) as { state: string; total_count: number; statuses: Array<{ context: string; state: string }> }
    if (parsed.total_count > 0) {
      any = true
      if (parsed.state === 'pending') pending += 1
      else if (parsed.state !== 'success') failed += 1
      for (const s of parsed.statuses) names.push(`${s.context} (${s.state})`)
    }
  } catch (err) {
    return { ok: false, err: `could not parse commit status: ${String(err)}` }
  }

  return {
    ok: true,
    checks: {
      any,
      pending,
      failed,
      allGreen: any && pending === 0 && failed === 0,
      names,
      detail: names.length === 0 ? 'no checks on this SHA' : names.join(', '),
    },
  }
}

export function mergeSquash(n: number): GhResult {
  return gh(['pr', 'merge', String(n), '--repo', REPO, '--squash'])
}

export function masterSha(): { ok: true; sha: string } | { ok: false; err: string } {
  const res = gh(['api', `repos/${REPO}/commits/master`, '--jq', '.sha'])
  if (!res.ok) return { ok: false, err: res.err }
  const sha = res.out.trim()
  return /^[0-9a-f]{40}$/.test(sha) ? { ok: true, sha } : { ok: false, err: `unexpected master sha: ${sha}` }
}

export function postPrComment(n: number, body: string): GhResult {
  return gh(['pr', 'comment', String(n), '--repo', REPO, '--body', body])
}

export function sleep(ms: number): void {
  spawnSync('sleep', [String(ms / 1000)])
}
