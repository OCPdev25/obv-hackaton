# qa/ — Flow-recording harness + evidence receipts

Standalone Playwright harness that records the caregiver **capture → inspect →
correct → save (failure/recovery) → reopen → handoff** flow against the
repository's worked-example `CandidateAdapter` protocol
(`evaluation/src`), producing a validated `FlowManifest`, per-step
screenshots, a session WebM, and a mergeable evidence receipt.

Like `security/` and `evaluation/`, this directory is **not a pnpm workspace
member** — CI's `pnpm turbo run test` does not cover it. Run it locally
whenever you touch it.

## Quick start

```bash
cd qa
bun install
bunx playwright install chromium        # first run only (headless shell)
bun run typecheck                       # strict TS, repo conventions
bun run record --scenario=capture-flow  # records + writes evidence/
```

Output lands in `qa/evidence/<runId>/`: `manifest.json` (validated shape,
HEAD-bound), `receipt.md`, `tc-*.png` (1440×900, ≥720px shorter edge),
`tc-flow-session.webm`. Structural re-check any manifest with
`bun src/validate.ts evidence/<runId>/manifest.json`.

## What the recording proves

The six `tc-N` steps map the product flow onto the acceptance corpus
fixtures (`evaluation/fixtures`) and adapter semantics:

| Step | Proves |
| --- | --- |
| `tc-1` capture | Raw transcript preserved byte-for-byte (SHA-256 computed in page); resilient `captureId` assigned by the adapter |
| `tc-2` inspect | Extracted typed events: count, categories in transcript order, `occurredAt` instants resolved via relative time + timezone, confidences in [0,1] |
| `tc-3` correct | Malformed capture still persists raw with zero events (`captured_with_event_errors`); corrected capture succeeds |
| `tc-4` save | Backend failure surfaces an error state **without persisting**; retry recovers; double-submit is an idempotent replay (original wins) |
| `tc-5` reopen | Cold-start reload re-reads the durable timeline — nothing lost, duplicated, or mutated; transcripts byte-identical |
| `tc-6` handoff | Invited caregiver reads the attributed timeline; unrelated viewer is fail-closed denied (nothing rendered) |

Assertions read deterministic state from the console fixture's
`window.__qa.state()` hook **and** the visible DOM, so screenshots and
assertions can never disagree. Settle detection is seq-based: the console
bumps a monotonic counter after each async action, and the harness waits for
that counter to advance — a step can never assert against a pre-click state.

## Adapter contract for scenarios

A scenario records against any implementation of the repository's
`CandidateAdapter` protocol (`evaluation/src/adapter.ts`):
`createEntry(input, ctx)` → `Created | IdempotentReplay | Rejected`,
`readTimeline()`, `reload()`. The bundled console fixture wraps
`evaluation/src/example/example-adapter.ts` (in-memory, corpus known-good)
with a fail-save injection seam for the failure/recovery step.

**Master's product UI is an arena-held candidate lineage**, so this recording
evidences the flow *protocol* + harness. When the product UI lands, point a
scenario's steps at the app URL — the manifest, receipt, and upload path are
unchanged.

## Native adapter contract (Apple worker)

The iOS-side recording is owned by the Apple worker and plugs in here. The
contract:

- **Same `FlowManifest` shape** with `"platform": "native"`; driver field
  names the actual mechanism (e.g. simulator + screen recording).
- **Stable `tc-N` step ids** matching the browser scenario (`tc-1` … `tc-6`),
  each with `prove`, result, assertions, and asset roles.
- **HEAD-bound evidence**: manifest records the tested `headSha`/branch;
  results from an earlier commit do not carry over (repo contract).
- **Synthetic data only** — fictional child, synthetic caregiver ids, no real
  persons, no credentials, mirrored in `fixtureSeed.note`.
- **Merge into one receipt** with the browser run:

```bash
cd qa && bun src/receipt.ts \
  --manifest=evidence/<browser-run>/manifest.json \
  --manifest=<native-run>/manifest.json \
  --pr=<PR URL> \
  --out=combined-receipt.md
```

Native manifests validate with the same `bun src/validate.ts` structural
check (platform + driver + tc-N shape), so the browser and native runs are
comparable evidence, not two formats.

## Evidence receipt (per merged PR)

The generated `receipt.md` follows the repo contract (`.obvious/obvious.md`
§ "Evidence receipt"): PR, tested head SHA, review result, checks, merge
commit, post-merge smoke, unlocked tasks. Worker-filled fields are written by
the recording; merge-owner fields (review result, checks, merge commit,
post-merge smoke, unlocked tasks) stay explicitly pending until the merge
owner fills them — a receipt with any field missing is not evidence yet.

## Data policy

Synthetic family data only (fictional child "Ava", synthetic `caregiver-1`).
No real persons, no credentials, no network calls — the console fixture is
served from `127.0.0.1` and the adapter is in-memory.
