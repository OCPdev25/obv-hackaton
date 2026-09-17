import { $ } from "bun"

export interface GitInfo {
  readonly headSha: string
  readonly branch: string
  readonly worktreeDirty: boolean
}

/**
 * Git facts for the manifest. Evidence binds to the exact HEAD under test
 * (repo contract: results from an earlier commit do not carry over).
 * Dirty = tracked-file modifications; untracked harness output is ignored.
 */
export async function gitInfo(cwd: string = process.cwd()): Promise<GitInfo> {
  const headSha = (await $`git rev-parse HEAD`.cwd(cwd).text()).trim()
  const branch = (await $`git rev-parse --abbrev-ref HEAD`.cwd(cwd).text()).trim()
  const porcelain = (await $`git status --porcelain --untracked-files=no`.cwd(cwd).text()).trim()
  return { headSha, branch, worktreeDirty: porcelain.length > 0 }
}
