# References & Answer Invalidation — Spike Prototype

Bounded, dependency-free prototype of slice 1 of the Remember & Retrieve synthesis:
**ambiguous-reference clarify** and **correction-driven answer invalidation** — the
read-only clarify gate and the never-serve-superseded answer rule, as pure
deterministic reducers over typed contracts.

## Contract source

- **Contract:** `art_gCDrtx4S` — "Remember & Retrieve — Ambiguous References &
  Correction Invalidation (proposal v0.1)" — §3 (schema deltas: LineageWatermark,
  ClarifyQuestion/ClarifyOutcome, RevisionLink, additive `Answered` fields,
  AnswerError), §5–6 (fixture cases + option-derivation rule).
- **Synthesis:** `art_gfwpdmWF` — cross-area synthesis §3 (fold-reconciliation
  constraints) and §6 (executable slice queue; this is slice 1).

## Layout

```
schema.ts          Effect v4 contract schemas (the proposal's deltas, standalone)
reducer.ts         Pure reducers: computeClarify, bumpWatermark, commitRevision,
                   invalidateAnswers, serveAnswer
fixtures/            8 deterministic JSON cases (F-AX-*)
references.test.ts bun suite: round-trips, per-case outcomes, invariants
```

## Schemas (schema.ts)

Implements the proposal's contract deltas as Effect v4 schemas pinned to
`4.0.0-rc.115`:

- `LineageWatermark` — `(captureId, attempt)` lineage plus monotonic `version`
  (unix-ms era integer), applied to the corpus.
- `ClarifyOption` / `ClarifyQuestion` / `ClarifyOutcome` — bounded (≤ 4 options),
  read-only; carries no write payload.
- `ResolvedBinding` — the resolved arm of the outcome (provenance-qualified).
- `RevisionLink` — correction revision carrying `targetRecordId` (+ optional
  `containingEntryId`) exactly as art_gCDrtx4S §3 specifies; the changed-record
  set is derived by the tested pure `changedRecordSet(revision)`.
- `Answered` additive fields — `answerId`, `readWatermark` (keyed by
  `(envelopeId, readWatermark.version)`), `status`, `supersededByRevisionId`,
  `citations` (citation-intersection inputs).
- `AnswerError` — `unresolved-reference` and `watermark-moved`, both `retryable`-
  flagged, both carrying no user content.

Conventions followed (matching `packages/domain/src/event.ts` and the folded
v0.3 domain): root `import { Schema } from "effect"` (the `effect/Schema` path
does not resolve on this pin); `Schema.Struct` with `Schema.optionalKey` for
absent-key optionals; `_tag` literal-union discriminants with unix-ms numbers
(`Schema.Number`); `convexId(table)` string annotations on id fields; branded id
types; `.js` import extensions; strict / `noUncheckedIndexedAccess` clean.

## Reducers (reducer.ts)

Pure, deterministic TypeScript — no Convex, no LLM, no clock, no randomness:

- `computeClarify(envelope)` → `ClarifyOutcome`: `resolved` (single in-scope
  candidate, or exactly one user-asserted candidate among several) |
  `clarification` (2–4 options, provenance-labeled, visibility-filtered,
  current-child first) | `unresolved-reference` (no candidate, cross-child
  blocked, invisible target, or bound exceeded — typed `reason`, no
  existence leak).
- `bumpWatermark` + `commitRevision` — strictly monotonic +1 watermark bump;
  idempotent, append-only revision commit.
- `invalidateAnswers` — an `Answered` is superseded **iff** its cited record ids
  intersect the revision's derived `changedRecordSet(revision)` (entry-level
  citations cover contained events); exhausts every match.
- `serveAnswer` — serves a stored answer while its `status` is `current`,
  **even when the watermark has moved**: invalidation is citation-intersection,
  not version comparison, so a revision to unrelated records must not retire a
  truthful answer. A superseded answer is never served — the caller gets a
  typed, retryable `watermark-moved` error that **never** includes the old
  content, and recomputes at the current watermark. Never-serve-superseded is
  the hard rule.

## Fixtures (fixtures/)

The proposal's six canonical cases plus two dedup-refinement cases from the
PR #28 review (finding F1), all pure-data JSON with fixed ISO-8601 UTC times
(`2026-09-17T18:30:00Z` family), synthetic `fx_*` ids only, no real names, no
medical content. Every `expected` block is derivable from scenario semantics
alone:

| Case | Scenario | Exercised rule |
| --- | --- | --- |
| `F-AX-CLARIFY-001` | "we took both" with two in-scope children | bounded clarification, exact options |
| `F-AX-CORRECT-ANSWER-001` | correction supersedes an answered claim | citation-intersection invalidation + lineage bump |
| `F-AX-RESUME-REFS-001` | re-opened capture re-resolves from restated refs | provenance-driven re-binding, historical supersession |
| `F-AX-STALE-ANSWER-001` | answer predates a committed revision | typed retryable stale error, never the old value |
| `F-AX-UNRESOLVED-CORRECTION-001` | correction names nothing resolvable | typed unresolved error, zero writes |
| `F-AX-LEAK-001` | private sibling reference in viewContext | fails typed without leaking id or content |
| `F-AX-CLARIFY-002` | two visible references to the same child, currentChild absent | dedup before count checks → resolved, never a 1-option question |
| `F-AX-CLARIFY-003` | same, with currentChild asserted | tiebreak then dedup → resolved via currentChild, never a 1-option question |

## Evidence labels (honest)

- **LOCAL-REAL (deterministic reducer):** `reducer.ts` + `schema.ts` are real,
  running code verified by `bun test` on the exact commit SHA reported in the PR
  (26 tests, 149 assertions) plus strict `tsc --noEmit`. No provider, no network,
  no clock, no randomness anywhere in the module.
- **DETERMINISTIC DOUBLE (fixtures):** the eight fixture cases (six canonical,
  two dedup-refinement) are pure JSON doubles — they demonstrate reducer
  semantics, not provider or device behavior.
  Nothing here exercises a real extraction provider or an LLM call.
- **Nothing device-verified:** no iOS/audio/capture-path verification of any
  kind is claimed by this spike.
- **Placement pending the v0.4 fold:** this lives under `spikes/` on purpose.
  The fold home for the schemas is `packages/domain/src/clarifyAnswer.ts`
  (per the synthesis); the reducers graduate only with that fold. This module is
  deliberately **not** a pnpm workspace member: the `pnpm-workspace.yaml` globs
  (apps/, packages/) exclude `spikes/`, so CI's turbo pipeline does NOT run it,
  and `.github/workflows/verification.yml` does not run it either. The only
  execution evidence for this spike is local runs (`bun test` + strict
  `tsc --noEmit`) — the same treatment `.obvious/obvious.md` gives the
  standalone `security/` and `evaluation/` suites.
- **Fixture namespace pending manifest reconciliation:** the `F-AX-*` namespace
  is claimed for the agent-experience area, but registering these cases into
  `evaluation/`'s manifest-driven registry is the harness owner's decision
  (todo_UXReKD0P) and is intentionally **not** done here.

## Reconciliation notes

- **Envelope equivalents are restated, not imported.** The task premise said the
  context-envelope module was not on `origin/master` yet; master has since
  absorbed the v0.3 fold (`packages/domain/src/contextEnvelope.ts`,
  `operations.ts`, `lineage.ts`, `ids.ts`). The isolation instruction stands:
  this spike still restates minimal locals (envelope id fields, provenance,
  candidate-reference record) rather than importing `packages/domain`, so it
  cannot couple to lanes still in flight. The `RECONCILIATION` comments in
  `schema.ts` name the canonical exports that drop-in replace each restated
  symbol at the fold.
- **Spike-local additions the proposal implies but the folded domain does not yet
  carry** (each flagged inline): `relatedChildId` on references (needed to derive
  child options per the proposal's option rule), the `resolved` reducer outcome
  arm (proposal describes clarify as question-or-error; the reducer must also
  express the no-question path), `retryable` on `unresolved-reference`, and the
  five-kind citation union's pending growth at the fold. None change the
  proposal's semantics; each is a naming/shaping decision for the fold.
- **Import-path deviations only:** no deviation from `art_gCDrtx4S` beyond
  root-effect imports and the reconciliation comments above.
