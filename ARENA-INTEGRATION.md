# ARENA Integration — Base Pick, Graft Ledger, Verification Evidence

Branch: `task/arena-integration-pick-base-graft-justif-qKuZn1nq` (non-candidate,
from master `fd7a6ab` — post PR #28 + #31). Authoritative inputs: Arena
Cross-Review Receipts v1 (`art_KR73IkfH`); PR #26 verification gate; PR #6
corpus harness.

## Base pick (receipts §4, unchanged)

**Candidate D** (`8514d1b`) — the only candidate both structurally compliant on
the PR #6 harness and fully green untouched in a clean worktree (typecheck 4/4,
48/48 tests, build incl. Expo export). Canonical stack preserved: Expo 57 /
RN 0.86 / pnpm 10.34.5, `_generated` committed.

## Graft ledger (receipts §5)

| # | Source | Graft | Where it landed | Justification |
| --- | --- | --- | --- | --- |
| 1 | C `6230ecc` | Raw-first draft persistence at `TextCaptured` + `RetryPersistRaw` on failure | `packages/capture/src/update.ts`, `state.ts`, `runtime.ts`; backend `entries.ts` (raw-capture row on create) | A caregiver's words must be durable before any derived processing; the corpus `raw-fidelity` fixture checks byte-for-byte survival across retry |
| 2 | C `6230ecc` | Wire codecs derived from `Encoded` types | `packages/capture/src/wire.ts` | Candidate-native wire vocabulary must round-trip through the canonical `EventSchema` without restating it |
| 3 | C `6230ecc` | 17-test fail-closed security suite | **Not duplicated** — see "Rejected ideas" | master's `security/` (29 cases, 13 negative + 4 positive + knowledge cases) already supersedes C's 17-case suite; grafting would fork the suite |
| 4 | C `6230ecc` | Journey CLI contract probe | `packages/capture/src/journey/run.ts` (15 checks) | Executable behavioral probe of the full capture loop incl. failure parking and replay |
| 5 | A `ea5c736` | Server-side Effect re-decode of publish/append payloads | `backend/convex/convex/entriesInput.ts` `decodeAppendEvents` + the `appendEvents` mutation | The backend must reject out-of-bounds confidence (1.5) regardless of client validation — proven executable in `test/entries.test.ts` |
| 6 | A `ea5c736` | Failure-park state modeling | `packages/capture/src/state.ts` (`RawPersistFailed`) + `update.ts` arms | Storage failures park with raw retained instead of dropping the caregiver's words |
| 7 | A `ea5c736` | EVIDENCE.md claim discipline | this document + `packages/capture/README.md` | Every claim names where it was executed |
| 8 | B `15fe84f9` | Append-only raw-captures table + server-enforced raw-before-events | `backend/convex/convex/schema.ts` (`rawCaptures`, backend-local `RawCaptureFields` composition), `entriesInput.ts` (`requireRawCaptureBeforeEvents`, `buildRawCaptureRow`), `entries.ts` (`appendEvents`) | Entries are mutable (extraction status, structured links, the v0.4 retraction fold); the immutable raw text needs its own append-only storage, and events must fail closed without it |

**B's event model was NOT grafted** (per the receipts): the per-category union,
one-event entries, and explicit-null shapes cannot express the canonical wire.
Canonical events (`EventFields`: bounded confidence, payload record, lineage)
win wherever the two conflict.

## Settled decisions honored (not re-opened)

1. **Corpus status reading** — draft-with-events at creation. D's
   draft-at-publish behavior was deliberately fixed: `AttachEvents` keeps the
   entry a draft (canonical `visibility`), and the corpus `reload-persistence`
   + `retry-double-submit` fixtures pin the semantics.
2. **Relative time + quantity** — unsolved in all four candidates. The
   deterministic double grafts the example adapter's conventions
   (`packages/extraction` + corpus worked example): spelled-out `ounces of`,
   first-match-per-sentence rules in example-adapter order (multi-event
   narratives are separate sentences), DST-safe zone resolution. Documented as
   an extracted-service seam for the future model-backed extractor.

## Rejected ideas / dropouts (with reasons)

- **Duplicating C's 17-test security suite** — master's security suite is a
  verified superset (29/0 this session, includes the fail-closed access cases
  C's 17 cover plus the later knowledge cases). A second suite would fork the
  failure surface. The superset relationship was verified, not assumed.
- **B's event model** (per-category union, one-event entries, explicit null) —
  cannot express the canonical wire; canonical contracts win (rule 2).
- **Grafting into `packages/domain`** — rule-2 discipline: canonical Effect
  schemas are the contract source of truth; every graft composes or adapts
  around them. `git diff` over `packages/domain` is empty on this branch.
- **Deferring the backend enforcement entirely** — the receipts marked B's
  server-enforced raw-before-events as ND (backend blocker). Rather than drop
  the claim, it is implemented and evidenced at the validator level this
  session (below); runtime-harness evidence remains the standing N1 limitation.

## ND-claim disposition (receipts)

| Claim | Receipts status | Disposition on this branch |
| --- | --- | --- |
| B: server-enforced raw-before-events | ND (backend blocker) | **Implemented** — `requireRawCaptureBeforeEvents` + `appendEvents`; 4 dedicated validator tests; handler wiring proven by strict typecheck against the generated API (`rawCaptures` table resolves in `dataModel`) |
| A: server-side re-decode rejects confidence 1.5 | proven on A | **Re-run here** — `decodeAppendEvents` + test rejects 1.5 through the canonical `EventFields` decoder |
| Convex runtime behavior of the capture path | ND | **Still ND** — no local Convex runtime harness (N1); documented, not claimed |

## Verification evidence (this session, this branch)

Executed in `/home/user/work/arena-int` (worktree of
`task/arena-integration-pick-base-graft-justif-qKuZn1nq`, base `fd7a6ab`):

- `pnpm turbo run typecheck test build --force` — **20/20 tasks, 0 cached**
  (baseline clean-master was 18/18; +2 = the new capture package).
- `bun test ./security` — **29 pass, 0 fail** (unchanged by this branch).
- `bun test` in `backend/convex` — **31 pass, 0 fail** (17 knowledge + 14 new
  entries-graft tests).
- `bun src/run.ts --adapter=./src/integrated-adapter.ts` (PR #6 harness) —
  **6/6 fixtures** on the integrated adapter; negative control
  (`broken-adapter.ts --expect-failure`) fails as required (1/6).
- `pnpm --filter @journal/capture journeys` — **15/15 checks**.
- `packages/domain` diff vs `fd7a6ab` — **empty** (rule-2 discipline held).

## Known limitations (stated, not hidden)

- **N1** — no local Convex runtime harness; the append path's handler wiring is
  proven by generated-API typecheck + validator-level tests, not live Convex.
- **Codegen side effect** — regenerating `_generated` ran `npx convex codegen`
  with the deploy key; its log included an "Uploading functions to Convex…"
  step (the command's own help says it does not modify the deployment; this
  was not separately verified). The dev deployment should be re-synced from
  master after merge.
- **Model-backed extraction** remains out of scope — the deterministic double
  is the demo-path stand-in by settled decision.
