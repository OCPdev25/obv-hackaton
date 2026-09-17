# Parent-Home Journey Pack (`src/home/` + `fixtures/home/`)

Executable companion to the pre-registered rubric **art_uWsp80Fg v1.0**
("Parent Home Arena — Independent Evaluation Rubric & User Journeys"). It
scores the three parent-home candidates (Home-A, Home-B, Home-C) against the
same five journeys (J1–J5) through machine-checkable protocols (P1–P6).

Evidence label for every run in this pack: **DETERMINISTIC TEST DOUBLE** —
no live LLM, no device, no cloud. This pack is separate from (and additional
to) the extraction-corpus harness in `src/` — different candidates, shared
canonical contracts.

## Layout

```
fixtures/home/utterances.json    capture inputs + expected outcomes (data only)
fixtures/home/mini-history.json  5-day synthetic seed (stand-in for slot-03 corpus)
fixtures/home/journeys.json      J1–J5 as data (steps, gates, dims, evidence)
src/home/timestamps.ts           pinned epochs — single source of truth, self-asserting
src/home/adapter.ts              HomeCandidateAdapter seam v1 (six methods)
src/home/match.ts                expected-set matcher (windows, occurrences, G5 guard)
src/home/validate.ts             fixture structure validator
src/home/run.ts                  protocol runner P1–P6 (CLI)
src/home/example/…-adapter.ts    worked example (all gates pass) + negative control
```

## Commands

```bash
bun src/home/validate.ts                                             # fixtures must validate
bun src/home/run.ts                                                  # protocols vs example adapter (expect 6/6)
bun src/home/run.ts --adapter=./src/home/example/home-broken-adapter.ts --expect-failure
                                                                     # negative control must be caught
```

All three run in CI via `pnpm --dir evaluation test` (chained in the `test`
script). The pack reuses the merged harness match module (`../match.ts`) for
canonical JSON, SHA-256 byte fidelity, and note normalization.

## Protocols

| Protocol | Proves | Gates |
|---|---|---|
| P1/voice, P1/text | U1 (voice) vs U2 (text) produce schema-equivalent event sets; raw stored byte-for-byte | G3, G5 |
| P5/stale | interrupted capture: older attempt resolving late cannot overwrite the newer; zero-event captures still publish | G2 |
| P2/idempotent-publish | double publish → one write, identical receipt | G2 |
| P3/no-write+audience | questions leave history byte-identical; private-audience event hidden from non-authors, visible to the author; missed day disclosed as gap | G4, G1, G7 |
| P4/lineage | patch/reject are append-only revisions with retrievable originals; unresolved references come back as questions, never guesses | G6 |
| P6/authorization | non-member and out-of-scope refusals, all with empty disclosure; positive control for authorized reads | G1 |

## Pinned time context

Fixtures land on **2026-11-01, the US DST fall-back day** (America/New_York):
02:00 EDT becomes 01:00 EST, so all Nov 1 instants are EST (UTC-5) while the
seed days Oct 28–31 are EDT (UTC-4). `timestamps.ts` asserts every epoch —
including the cross-anchor from the merged corpus (Nov 1 18:00 EST =
1793574000000) — at import time; a wrong value aborts the run. The capture
day is deliberately left empty in the seed so the journeys fill it.

## Using the pack for a candidate

Implement `HomeCandidateAdapter` (six methods, seam v1) around the
candidate's real stores and run:

```bash
bun src/home/run.ts --adapter=./path/to/candidate-adapter.ts
```

Gate verdicts feed the rubric's hard-gate table (PASS/FAIL/ND per §4 — a
deliverable that cannot host the seam runs its journeys as scripted
clickthrough evidence instead). The pack proves mechanics; the rubric scores
the experience around them.
