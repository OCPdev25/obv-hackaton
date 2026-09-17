/**
 * Flow-recording manifest types — THE integration seam between recording
 * drivers. The browser harness writes this shape; the Apple native worker
 * adapter writes the SAME shape with `platform: "native"` (see README.md,
 * "Native adapter contract"). The receipt generator merges any number of
 * manifests into one evidence receipt.
 *
 * Asset naming and step ids follow the Obvious autobuild-qa capture policy:
 * stable `tc-N` ids allocated in acceptance-criterion order, PNG default,
 * short WebM only for interactions, every asset ≤ 25 MiB, evidence bound to
 * the exact tested HEAD SHA.
 */

export type AssetRole = "before" | "after" | "recording" | "error" | "result" | "evidence"

export interface AssetRef {
  /** File name relative to the manifest's directory. */
  readonly file: string
  readonly role: AssetRole
}

export interface AssertionRecord {
  readonly name: string
  readonly pass: boolean
  readonly detail?: string
}

export interface StepRecord {
  /** Stable per-scenario test-case id (`tc-N`) — matches autobuild-qa dedupe rules. */
  readonly id: string
  readonly name: string
  readonly title: string
  readonly status: "pass" | "fail"
  /** Fixture ids from the acceptance corpus that seed this step. */
  readonly fixtureIds: readonly string[]
  readonly assertions: readonly AssertionRecord[]
  readonly assets: readonly AssetRef[]
}

export interface FixtureSeed {
  /** Fixture corpus directory, e.g. "evaluation/fixtures". */
  readonly corpus: string
  readonly fixtureIds: readonly string[]
  readonly capturedAtMs: number
  readonly timezone: string
  readonly authorId: string
  /** Must state the synthetic-data policy for this run. */
  readonly note: string
}

export interface FlowManifest {
  readonly manifestVersion: 1
  readonly runId: string
  readonly platform: "browser" | "native"
  /** Driver identity, e.g. "qa/record.ts (playwright chromium)" or "apple-worker-adapter". */
  readonly driver: string
  readonly capturedAt: string
  readonly headSha: string
  readonly branch: string
  readonly worktreeDirty: boolean
  readonly pr: string | null
  readonly scenario: string
  readonly scenarioTitle: string
  readonly fixtureSeed: FixtureSeed
  readonly environment: Readonly<Record<string, string>>
  readonly steps: readonly StepRecord[]
  readonly videos: readonly AssetRef[]
  readonly notes: readonly string[]
}

/** Structural validation for driver-produced manifests (native adapter compliance). */
export function validateManifest(value: unknown): readonly string[] {
  const errors: string[] = []
  if (typeof value !== "object" || value === null) return ["manifest must be a JSON object"]
  const m = value as Record<string, unknown>
  if (m.manifestVersion !== 1) errors.push("manifestVersion must be 1")
  for (const key of ["runId", "driver", "capturedAt", "headSha", "branch", "scenario"] as const) {
    const v = m[key]
    if (typeof v !== "string" || v.length === 0) errors.push(`${key} must be a non-empty string`)
  }
  if (m.platform !== "browser" && m.platform !== "native") {
    errors.push(`platform must be "browser" or "native", got ${JSON.stringify(m.platform)}`)
  }
  if (typeof m.headSha !== "string" || !/^[0-9a-f]{40}$/.test(m.headSha)) {
    errors.push("headSha must be a full 40-char git SHA (evidence binds to the exact tested HEAD)")
  }
  const seed = m.fixtureSeed
  if (typeof seed !== "object" || seed === null) {
    errors.push("fixtureSeed must be an object")
  } else {
    const s = seed as Record<string, unknown>
    if (!Array.isArray(s.fixtureIds) || s.fixtureIds.length === 0) errors.push("fixtureSeed.fixtureIds must be non-empty")
    if (typeof s.note !== "string" || !/synthetic/i.test(s.note)) {
      errors.push('fixtureSeed.note must state the synthetic-data policy (mention "synthetic")')
    }
  }
  if (!Array.isArray(m.steps) || m.steps.length === 0) errors.push("steps must be a non-empty array")
  else {
    const ids = new Set<string>()
    for (const step of m.steps as readonly Record<string, unknown>[]) {
      const id = step.id
      if (typeof id !== "string" || !/^tc-[0-9]+$/.test(id)) errors.push(`step id ${JSON.stringify(id)} must match tc-N`)
      else if (ids.has(id)) errors.push(`duplicate step id ${id} (autobuild-qa dedupe drops later criteria)`)
      else ids.add(id)
      if (!Array.isArray(step.assertions) || step.assertions.length === 0) errors.push(`step ${String(id)} needs assertions`)
      if (step.status !== "pass" && step.status !== "fail") errors.push(`step ${String(id)} status must be pass|fail`)
    }
  }
  return errors
}
