# Verification Gate

Executes the repo's review → repair → merge contract (`.obvious/obvious.md`)
as an inspectable tool instead of prose. Zero dependencies, runs under Bun.

**Load-bearing assumption:** a PR-comment manifest plus live GitHub reads can
carry the contract's merge decision without inventing approvals. The gate
validates only what is recorded and observed; it can detect contradiction, not
verify intent — a fabricated-but-self-consistent manifest passes. What keeps
that honest: every field must carry a URL, the sweep re-observes live state
(checks on the exact head SHA, live diff paths), and the evidence receipt
records everything for post-hoc review. If a receipt is ever found to
misstate reality, the manifest's `reviewer`/`url` fields name who claimed it.

## Manifest format

Recorded on the PR (body or any comment; the **latest** block across
body + comments wins, and a later malformed block fails loudly rather than
falling back):

````html
<!-- verification-manifest:v1 -->
```json
{
  "manifestVersion": 1,
  "pr": 13,
  "prUrl": "https://github.com/OCPdev25/obv-hackaton/pull/13",
  "testedHeadSha": "<40-hex HEAD under review>",
  "classification": "ui | backend-only | docs-only",
  "classificationJustification": "required for backend-only / docs-only",
  "review": { "result": "pass|pass-with-notes", "reviewer": "...",
              "reviewedHeadSha": "...", "date": "YYYY-MM-DD", "url": "..." },
  "checks": [{ "name": "...", "status": "green", "headSha": "...", "url": "..." }],
  "evidence": [
    { "kind": "behavior-run | test-run | suite-run | playable-flow",
      "name": "...", "headSha": "...", "result": "pass", "url": "..." }
  ],
  "suites": {
    "security":   { "ran": true, "result": "pass", "headSha": "...", "url": "..." },
    "evaluation": { "ran": true, "result": "pass", "headSha": "...",
                    "negativeControl": "fail-as-expected", "url": "..." }
  },
  "notes": "optional"
}
```
````

## What the validator enforces (each pinned by a test)

| Code | Meaning |
| --- | --- |
| `invalid_manifest` | structure: version, SHA shapes, evidence item shape |
| `pr_mismatch` | manifest points at a different PR than the one validated |
| `arena_hold` | branch is `arena/candidate-*` — excluded from auto-merge (rule 8) |
| `stale_head_sha` | `testedHeadSha` ≠ live PR head (rule 5: results don't carry over) |
| `mismatched_sha` | review/check/evidence/suite recorded against a different commit |
| `missing_review` / `review_not_passing` / `invalid_review_fields` | rule 2–3 review record |
| `missing_checks` | no named green CI check recorded (rule 4) |
| `missing_evidence` / `evidence_result_not_passing` | failing/absent behavior evidence |
| `no_playable_flow` / `invalid_playable_flow` | UI PRs need scenario + assertions + environment |
| `native_claim_unsupported` | on-device/simulator/TestFlight claims need playable-flow evidence |
| `classification_mismatch` | claimed classification contradicts the live diff paths |
| `classification_justification_required` | backend-only/docs-only need a justification |
| `suite_not_recorded` / `suite_not_passing` / `suite_negative_control_missing` | security + evaluation runs on the tested HEAD |

Suite applicability is derived from the **live diff**: any change under
`apps/`, `backend/`, `packages/`, `security/`, or `evaluation/` requires both
suites; docs-only changes require neither.

## CLI

```bash
bun verification/src/cli.ts validate-pr --pr=<n>            # CI-safe advisory
bun verification/src/cli.ts validate-pr --pr=<n> --require  # strict (merge owner)
bun verification/src/cli.ts check --file=f.json --pr=<n> --head=<sha> --branch=<b> --paths=a,b
bun verification/src/cli.ts sweep --pr=<n> --owner=<name> [--dry-run] [--smoke] [--post-receipt]
```

The **sweep** is the serialized merge owner's gate, in order: open PR on
master, not draft → not an arena candidate → live checks green on the exact
head SHA → latest manifest parses → validator merge → `gh pr merge --squash`
→ receipt. `--smoke` re-runs the full local verification table on the merge
commit from a temp worktree. Exit codes: 0 merge/would-merge, 1 refuse/hold,
2 environment error.

Factual limits: checks/comments are read from a single page (~100); check-run
pagination would be needed past that. The sweep trusts `gh` auth entirely.

## Tests

```bash
cd verification && bun test ./test   # 2 positive controls + 9 negative controls + extraction tests
```
