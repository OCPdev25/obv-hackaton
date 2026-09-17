import type { FlowManifest } from "./types.ts"

/**
 * Evidence-receipt generator — merges any number of FlowManifests (browser
 * harness runs, Apple native adapter runs) into the repo's evidence-receipt
 * format (.obvious/obvious.md § Evidence receipt) plus a per-run evidence
 * table. Merge-owner-only fields (checks, merge commit, post-merge smoke,
 * unlocked tasks) are rendered as explicit pending placeholders — never
 * simulated.
 */
export interface ReceiptOptions {
  readonly prUrl?: string | null
  readonly reviewResult?: string
  readonly checks?: string
  readonly mergeCommit?: string | null
  readonly postMergeSmoke?: string | null
  readonly unlockedTasks?: string
}

export function renderReceipt(manifests: readonly FlowManifest[], opts: ReceiptOptions = {}): string {
  const first = manifests[0]
  if (first === undefined) throw new Error("no manifests provided")
  const shas = new Set(manifests.map((m) => m.headSha))
  if (shas.size > 1) throw new Error(`manifests span multiple HEAD SHAs — receipts are HEAD-bound: ${[...shas].join(", ")}`)

  const lines: string[] = []
  lines.push("## Evidence receipt — flow recording")
  lines.push("")
  lines.push("| Field | Value |")
  lines.push("| --- | --- |")
  lines.push(`| PR | ${opts.prUrl ?? first.pr ?? "_(this PR — self-demonstration)_"} |`)
  lines.push(`| Tested head SHA | \`${first.headSha}\` |`)
  lines.push(`| Review result | ${opts.reviewResult ?? "pending review — _(merge-owner field)_"} |`)
  lines.push(`| Checks | ${opts.checks ?? "_(merge-owner field: all CI checks green on this SHA required before merge)_"} |`)
  lines.push(`| Merge commit | ${opts.mergeCommit ?? "_(merge-owner field)_"} |`)
  lines.push(`| Post-merge smoke | ${opts.postMergeSmoke ?? "_(merge-owner field: pnpm typecheck && pnpm test && pnpm build on the merge commit)_"} |`)
  lines.push(`| Unlocked tasks | ${opts.unlockedTasks ?? "_(merge-owner field)_"} |`)
  lines.push("")

  for (const m of manifests) {
    lines.push(`### Recording — ${m.scenarioTitle}`)
    lines.push("")
    lines.push(`- **Platform / driver**: \`${m.platform}\` · ${m.driver}`)
    lines.push(`- **Run**: ${m.runId} · captured ${m.capturedAt} · branch \`${m.branch}\`${m.worktreeDirty ? " · ⚠️ dirty worktree" : " · clean worktree"}`)
    lines.push(`- **Environment**: ${Object.entries(m.environment).map(([k, v]) => `${k}=${v}`).join(" · ")}`)
    lines.push(`- **Fixture seed**: ${m.fixtureSeed.corpus} [${m.fixtureSeed.fixtureIds.join(", ")}] · capturedAt=${m.fixtureSeed.capturedAtMs} · ${m.fixtureSeed.timezone} · author=${m.fixtureSeed.authorId}`)
    lines.push(`- **Data policy**: ${m.fixtureSeed.note}`)
    lines.push(`- **Session recording**: ${m.videos.map((v) => `\`${v.file}\` (${v.role})`).join(" · ") || "—"}`)
    lines.push("")
    lines.push("| Step | Proves | Result | Assertions | Assets |")
    lines.push("| --- | --- | --- | --- | --- |")
    for (const step of m.steps) {
      const passed = step.assertions.filter((a) => a.pass).length
      const result = `${step.status === "pass" ? "✅" : "❌"} ${passed}/${step.assertions.length}`
      const assertions = step.assertions
        .map((a) => `${a.pass ? "✓" : "✗"} ${a.name}${a.detail === undefined ? "" : ` — ${a.detail}`}`)
        .join("<br>")
      const assets = step.assets.map((a) => `\`${a.file}\` (${a.role})`).join(" · ") || "—"
      lines.push(`| \`${step.id}\` ${step.name} | ${step.title} | ${result} | ${assertions} | ${assets} |`)
    }
    lines.push("")
    for (const note of m.notes) lines.push(`> ${note}`, "")
  }

  const hasNative = manifests.some((m) => m.platform === "native")
  if (!hasNative) {
    lines.push("### Native (Apple worker adapter)")
    lines.push("")
    lines.push(
      'Status: **pending** — native (iOS) recording is owned by the Apple worker adapter. The contract it fulfills is documented in `qa/README.md` § "Native adapter contract" (same `FlowManifest` shape with `platform: "native"`, stable `tc-N` ids, HEAD-bound evidence, synthetic data policy). Native manifests merge into this receipt with:',
    )
    lines.push("")
    lines.push("```bash")
    lines.push("cd qa && bun src/receipt.ts --manifest=evidence/<browser-run>/manifest.json --manifest=<native-run>/manifest.json --pr=<PR URL> --out=combined-receipt.md")
    lines.push("```")
    lines.push("")
  }

  lines.push("### Reproduce")
  lines.push("")
  lines.push("```bash")
  lines.push("cd qa && bun install && bun run record --scenario=" + first.scenario + (first.pr === null ? "" : ` --pr=${first.pr}`))
  lines.push("```")
  lines.push("")
  lines.push(`Manifest of record: \`evidence/${first.runId}/manifest.json\` (validated shape, HEAD-bound). Structural check: \`bun src/validate.ts evidence/${first.runId}/manifest.json\`.`)
  lines.push("")
  return lines.join("\n")
}

if (import.meta.main) {
  const { parseArgs } = await import("./args.ts")
  const args = parseArgs(process.argv.slice(2))
  const manifestPaths = process.argv.slice(2).filter((a) => a.startsWith("--manifest=")).map((a) => a.slice("--manifest=".length))
  if (manifestPaths.length === 0) {
    console.error("usage: bun src/receipt.ts --manifest=<path.json> [--manifest=...] [--pr=<url>] [--review-result=...] [--out=<file.md>]")
    process.exit(2)
  }
  const manifests: FlowManifest[] = []
  for (const p of manifestPaths) {
    manifests.push(JSON.parse(await Bun.file(p).text()) as FlowManifest)
  }
  const md = renderReceipt(manifests, {
    prUrl: typeof args.pr === "string" ? args.pr : null,
    reviewResult: typeof args["review-result"] === "string" ? args["review-result"] : undefined,
    checks: typeof args.checks === "string" ? args.checks : undefined,
    mergeCommit: typeof args["merge-commit"] === "string" ? args["merge-commit"] : null,
    postMergeSmoke: typeof args["post-merge-smoke"] === "string" ? args["post-merge-smoke"] : null,
  })
  if (typeof args.out === "string") {
    await Bun.write(args.out, md)
    console.log(`receipt written: ${args.out}`)
  } else {
    console.log(md)
  }
}
