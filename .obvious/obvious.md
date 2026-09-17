# obv-hackaton — Agent Guidance

Shared Child Journal hackathon monorepo: caregivers capture informal voice/photo
updates, AI extracts typed care events, and authorized household members follow
a child's timeline — child-centered records, not parent-to-parent chat. Product
scope and architecture live in the project blueprint; this document is the repo
contract: stack, layout, setup, local verification, CI, and the
review → repair → merge workflow every PR follows.

## Stack

| Layer | Choice |
| --- | --- |
| Tooling | pnpm 10.34.5 via Corepack + Turborepo 2, Node ≥ 20 |
| Language | TypeScript ~6.0.3 — strict, `noUncheckedIndexedAccess`, bundler resolution |
| Contracts | Effect v4 (4.0.0-rc.115) schemas in `packages/domain` — single source of truth |
| Backend | Convex (`backend/convex`); schema derived from domain contracts via the tested adapter |
| Mobile | Expo 57 / React Native 0.86; Metro resolver (hoisted pnpm layout via `.npmrc`) |
| Tests | Bun 1.3.14 (domain tests, security suite, evaluation harness) |

Confect is deliberately **not** used — it peers on Effect ^3.21.2 and refuses to
install next to Effect v4 (ERESOLVE). See README "Confect decision".

## Layout

```
apps/mobile          Expo app; ConvexProvider reads EXPO_PUBLIC_CONVEX_URL
backend/convex       Convex schema + functions (children, households, entries, events)
packages/domain      Effect v4 schemas + Convex-validator adapter + JSON Schema (draft 2020-12) derivation
packages/extraction  Transcript → typed events pipeline (stub, no LLM call yet)
packages/month-history  Deterministic month-history view model + executable journeys (28-check rubric, `bun src/run.ts`)
packages/ui          Shared RN primitives
evaluation/          Acceptance corpus (6 fixtures) + candidate-agnostic cross-review harness
security/            THREAT-MODEL.md + executable fail-closed access cases (17 tests)
deploy/              Thin-path deployment evidence (dev deployment reliable-panther-823)
```

Merged history this scaffold absorbed: CI pipeline (PR #3), security negative
cases (PR #4), thin-path deploy evidence (PR #5), acceptance corpus/harness
(PR #6), Effect v4 spike (PR #7), monorepo scaffold + contracts (PR #8→#9,
squash `88f103b`).

## Setup

```bash
corepack enable
pnpm install --frozen-lockfile
```

Environment: copy root `.env.example` → `.env` and `apps/mobile/.env.example` →
`apps/mobile/.env`; both hold `EXPO_PUBLIC_CONVEX_URL`. Never commit `.env`.
Backend dev needs `npx convex login` then `npx convex dev`.

## Local verification (run before every push)

```bash
pnpm typecheck                                # turbo typecheck across all packages
pnpm test                                     # domain contract round-trip tests (bun)
pnpm build                                    # buildable packages
bun test ./security                           # 17 fail-closed access cases (13 negative + 4 positive)
cd evaluation && bun src/run.ts               # corpus vs the worked example adapter
bun src/run.ts --adapter=./src/example/broken-adapter.ts --expect-failure   # negative control must fail
pnpm --filter @journal/month-history journeys   # month-history 28-check rubric (runner + coverage both directions)
```

The security suite and evaluation harness are standalone (`security/` and
`evaluation/` are not pnpm workspace members), so CI's `pnpm turbo run test`
does not cover them — run them locally whenever you touch `security/`,
`evaluation/`, or the domain contracts. `.github/workflows/verification.yml`
runs both suites (plus the evaluation negative control and the
verification-gate validator tests) on every PR and push to `master`.

## Verification gate (executable merge workflow)

The review → repair → merge workflow below is executable in
`verification/` (see `verification/README.md`). PRs record a
`verification-manifest:v1` block (body or comment — review result, check and
suite runs, behavior/playable-flow evidence, all on the exact tested HEAD).
`bun verification/src/cli.ts validate-pr --pr=<n>` validates the latest
manifest against live PR state; the merge owner runs
`sweep --pr=<n> --owner=<name>` which refuses unless the PR is open on
master, checks are green on the exact head SHA, and the manifest validates,
then merges `--squash` and emits the evidence receipt. Arena candidate
branches are held regardless of evidence. The validator is pinned by
positive + negative controls (`cd verification && bun test ./test`).

## CI

`.github/workflows/ci.yml` runs on every PR to `master`: Node 20 + Bun 1.3.14,
Corepack pnpm, cached pnpm store, then `pnpm install --frozen-lockfile` →
`pnpm turbo run typecheck` → `test` → `build` (20-minute timeout,
cancel-in-progress per ref). CI green on the exact head SHA is the merge gate
(workflow below). Note: CI installs with the frozen lockfile — run
`pnpm install` and commit `pnpm-lock.yaml` changes in the same PR as any
dependency edit.

## Review → repair → merge workflow

Repo policy (`.obvious/config.yml`): `mergeMethod: squash` onto `master` (the
only branch PRs target). The repo policy declares **no required human
approvals** — the checks below, not an approval badge, authorize a merge. Merge
methods are platform-verified: squash is allowed on this repo.

1. **Acceptance criteria first.** Every PR states its acceptance criteria in
   the body before review. A PR without stated criteria is not reviewable.
2. **Diff inspection.** The reviewer reads the full diff against those
   criteria — CI green is never a substitute for reading the change. Every
   review comment is replied to in its own thread, then fixed or explicitly
   escalated; nothing is waved through.
3. **Independent verification against current HEAD.** Review results and local
   test runs are only valid against the exact HEAD under review. State the
   tested SHA with every result; results from an earlier commit do not carry
   over.
4. **Checks green required.** All CI checks terminal and passing on the exact
   head SHA before any merge. Red or pending checks block merge, no exceptions.
5. **Repairs invalidate prior results.** Any push to the PR — repair, rebase,
   dependency refresh — invalidates prior review results and local test runs.
   Re-review the delta and re-run verification against the new HEAD before
   merge. Rebase with `--force-with-lease` only.
6. **One serialized merge owner.** At any moment exactly one named owner (the
   PR's worker thread, or an explicitly delegated merger) runs the merge
   command for a given PR. Everyone else supplies reviews and evidence; they do
   not merge. Merges into `master` are serialized — never race two PRs in
   concurrently.
7. **No invented approvals.** Because no human-approval requirement exists,
   never record, imply, or simulate an approval that did not happen. A merge is
   authorized by green checks plus the completed review workflow above — not by
   an "LGTM" no one left.
8. **Arena candidates hold.** PRs from `arena/candidate-*` branches (the
   candidate convention the evaluation harness runs identically against) are
   excluded from individual auto-merge until arena selection completes.
   Individual candidate results are comparable harness outputs, not merge
   evidence for `master`. After selection, the winning candidate merges through
   this same workflow.

### Evidence receipt (per merged PR)

Record one receipt — PR comment or project artifact — with every field filled:

```
PR:               <PR URL>
Tested head SHA:  <sha — exact HEAD review + local tests ran against>
Review result:    <pass | pass-with-notes | fail> — <reviewer>, <date>
Checks:           <all green; name the checks> — CI run on the same SHA
Merge commit:     <squash sha on master>
Post-merge smoke: <what ran on the merge commit, and the result>
Unlocked tasks:   <task IDs / lanes unblocked by this merge>
```

Post-merge smoke = re-run the local verification table (at minimum
`pnpm typecheck && pnpm test && pnpm build`) on the merge commit. If any field
cannot be filled, the receipt is not evidence yet — say so and fill the gap
before treating downstream tasks as unlocked.
