/**
 * Flow-recording CLI orchestrator.
 *
 *   bun src/record.ts --scenario=capture-flow [--pr=<url>] [--scenario=...]
 *
 * Builds the console fixture bundle, serves it locally, drives the scenario
 * in headless Chromium (1440×900 per capture policy), collects per-step
 * assertions + screenshots + a session video, and writes manifest.json +
 * receipt.md into qa/evidence/<runId>/. Exit 1 on any failed assertion or
 * browser console error — evidence is never written green.
 */
import { mkdirSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseArgs } from "./args.ts"
import { gitInfo } from "./gitinfo.ts"
import { launchDriver, VIEWPORT } from "./driver.ts"
import { renderReceipt } from "./receipt.ts"
import type { AssetRole, FlowManifest, StepRecord } from "./types.ts"
import type { Scenario, StepHandle } from "./scenario.ts"
import { startConsoleServer } from "../console/serve.ts"

const qaRoot = dirname(import.meta.dir) // qa/
const repoRoot = dirname(qaRoot)

const args = parseArgs(process.argv.slice(2))
const scenarioName = typeof args.scenario === "string" ? args.scenario : "capture-flow"
const pr = typeof args.pr === "string" ? args.pr : null
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${scenarioName}`
const evidenceDir = join(qaRoot, "evidence", runId)
const videoDir = join(evidenceDir, "_video")

// 1. Build the console fixture bundle for the browser.
const build = await Bun.build({
  entrypoints: [join(qaRoot, "console/src/console.ts")],
  outdir: join(qaRoot, "console/dist"),
  target: "browser",
})
if (!build.success) {
  console.error("console bundle failed:", build.logs)
  process.exit(1)
}

// 2. Serve the fixture + gather git facts.
const server = startConsoleServer()
console.log(`console fixture served at ${server.url}`)
const git = await gitInfo(repoRoot)
console.log(`evidence binds to HEAD ${git.headSha} (branch ${git.branch}, ${git.worktreeDirty ? "dirty" : "clean"})`)

// 3. Load the scenario.
const mod = (await import(`./scenarios/${scenarioName}.ts`)) as { scenario: Scenario }
const scenario = mod.scenario

// 4. Drive the flow.
mkdirSync(videoDir, { recursive: true })
const driver = await launchDriver({ videoDir, baseUrl: server.url })

const steps: StepRecord[] = []
let runFailed = false

for (const def of scenario.steps) {
  console.log(`\n[${def.id}] ${def.name} — ${def.title}`)
  const assets: StepRecord["assets"] extends readonly (infer A)[] ? A[] : never[] = []
  const assertions: { name: string; pass: boolean; detail?: string }[] = []
  const handle: StepHandle = {
    assert(name, pass, detail) {
      assertions.push({ name, pass, detail })
      console.log(`  ${pass ? "✓" : "✗"} ${name}${detail === undefined ? "" : ` — ${detail}`}`)
      if (!pass) runFailed = true
    },
    async shot(file, role) {
      await driver.page.screenshot({ path: join(evidenceDir, file), fullPage: true })
      assets.push({ file, role })
    },
  }
  try {
    await def.run(driver.page, handle)
  } catch (err) {
    runFailed = true
    assertions.push({ name: "step completed without throwing", pass: false, detail: err instanceof Error ? err.message : String(err) })
    console.error(`  ✗ step threw:`, err)
  }
  const passed = assertions.length > 0 && assertions.every((a) => a.pass)
  steps.push({ id: def.id, name: def.name, title: def.title, status: passed ? "pass" : "fail", fixtureIds: [...def.fixtureIds], assertions, assets })
}

// 5. Close (flushes the session video).
const { videoPath, consoleErrors } = await driver.close()
server.stop()

const videos: { file: string; role: "recording" }[] = []
if (videoPath !== null) {
  const target = join(evidenceDir, "tc-flow-session.webm")
  renameSync(videoPath, target)
  videos.push({ file: "tc-flow-session.webm", role: "recording" })
}

// 6. Manifest + receipt.
const manifest: FlowManifest = {
  manifestVersion: 1,
  runId,
  platform: "browser",
  driver: `qa/record.ts (playwright chromium ${driver.browserVersion})`,
  capturedAt: new Date().toISOString(),
  headSha: git.headSha,
  branch: git.branch,
  worktreeDirty: git.worktreeDirty,
  pr,
  scenario: scenario.name,
  scenarioTitle: scenario.title,
  fixtureSeed: scenario.fixtureSeed,
  environment: {
    node: process.version,
    bun: Bun.version,
    browser: `chromium ${driver.browserVersion} (headless shell)`,
    viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
    adapter: "evaluation/src/example/example-adapter.ts (in-memory, corpus known-good)",
    backend: "in-memory — reopen = adapter.reload() cold-start equivalence",
    servedFrom: server.url,
  },
  steps,
  videos,
  notes: [
    ...(consoleErrors.length > 0 ? [`browser console errors during run: ${consoleErrors.join(" | ")}`] : []),
    "Platform: browser (headless Chromium). Native (iOS) recording pending — Apple worker adapter contract: qa/README.md.",
    "Adapter: the evaluation corpus's worked example (in-memory, known-good). Master's product UI is an arena-held candidate lineage, so this recording evidences the flow PROTOCOL + harness; the same tooling records the product UI when it lands (point --scenario steps at the app URL).",
  ],
}

await Bun.write(join(evidenceDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
await Bun.write(join(evidenceDir, "receipt.md"), renderReceipt([manifest], { prUrl: pr }))

const passedCount = steps.filter((s) => s.status === "pass").length
console.log(`\nrun ${runId}: ${passedCount}/${steps.length} steps pass${consoleErrors.length > 0 ? ` (+${consoleErrors.length} browser console errors — run marked failed)` : ""}`)
console.log(`evidence: qa/evidence/${runId}/ (manifest.json, receipt.md, tc-*.png, tc-flow-session.webm)`)
process.exit(runFailed || consoleErrors.length > 0 ? 1 : 0)
