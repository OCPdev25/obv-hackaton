import type { Page } from "playwright"
import type { AssetRole, FixtureSeed } from "./types.ts"

/** Per-step assertion + capture handle handed to scenario steps. */
export interface StepHandle {
  assert(name: string, pass: boolean, detail?: string): void
  /** Full-page screenshot into the evidence dir (shorter edge ≥ 720px policy — viewport is 1440×900). */
  shot(file: string, role: AssetRole): Promise<void>
}

export interface StepDef {
  /** Stable `tc-N`, allocated in acceptance-criterion order (autobuild-qa dedupe rule). */
  readonly id: string
  readonly name: string
  readonly title: string
  readonly fixtureIds: readonly string[]
  run(page: Page, handle: StepHandle): Promise<void>
}

export interface Scenario {
  readonly name: string
  readonly title: string
  readonly fixtureSeed: FixtureSeed
  readonly steps: readonly StepDef[]
}
