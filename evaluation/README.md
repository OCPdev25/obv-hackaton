# Acceptance Corpus & Evaluation Harness

Shared acceptance/evaluation corpus plus a candidate-agnostic harness that the
arena cross-review runs **identically** against all four candidates
(`arena/candidate-a|b|c|d`). Fixtures are pure **data** — inputs plus expected
outcomes, independent of any candidate code — so per-candidate results are
directly comparable.

Design sources: the Effect v4 schema contract (wire shapes for `Event`/`Entry`,
Unix-ms timestamps, six categories, `_tag` literals) and the product
architecture blueprint (capture flow: preserve raw source → extract typed
events → review → publish; resilient capture identifiers; duplicate protection).

## Layout

```
evaluation/
  src/
    adapter.ts                  ← THE adapter interface (narrow, stated in types)
    fixtures.ts                 ← fixture data types + fail-fast loader
    manifest.ts                 ← fixture-AREA manifest: classes, runner bindings, fail-fast registration
    manifest-selfcheck.ts       ← registration self-check (seed manifest + fail-fast rejection rules)
    match.ts                    ← canonical JSON, SHA-256 byte fidelity, event matcher
    runner.ts                   ← fixed per-fixture protocols (identical for every candidate)
    run.ts                      ← CLI entry (manifest-driven)
    example/example-adapter.ts  ← worked example adapter (in-memory, contract-shaped)
    example/broken-adapter.ts   ← deliberate negative control (must fail the corpus)
  fixtures/                     ← fixture areas (data only); registration in fixtures/manifest.json
```

## The adapter contract

Implement `CandidateAdapter` (see `src/adapter.ts`) and export a **named
factory** from one module:

```ts
import type { CandidateAdapter, CreateEntryInput, CreateEntryResult, WireEntry } from '../../evaluation/src/adapter.ts'

export function createAdapter(): CandidateAdapter {
  return {
    name: 'my-candidate',
    async createEntry(input: CreateEntryInput): Promise<CreateEntryResult> { /* ... */ },
    async readTimeline(): Promise<readonly WireEntry[]> { /* ... */ },
    async reload(): Promise<void> { /* ... */ },
  }
}
```

Semantic rules every adapter must honor (the runner checks all of them):

- **`createEntry`** runs the full capture pipeline for one dictation: preserve
  the raw `transcript` **byte-for-byte** (no trim, no Unicode normalization, no
  re-encoding), extract events, resolve relative times against
  `capturedAt`/`timezone`, validate against the contract, persist, and resolve
  only after extraction and persistence have settled.
- **Idempotency**: `captureId` is the idempotency key. A second submission with
  the same `captureId` must return `{ _tag: 'IdempotentReplay', entry }` with
  the **existing** record — never a second entry, never new events.
- **Extraction failure never blocks capture** (contract rule): when no
  schema-valid event can be produced, the entry is still **created** with
  `events: []` — returning `Rejected` for extraction failure is a contract
  violation. `Rejected` is reserved for raw-input policy refusals (e.g. an
  empty transcript; the corpus never triggers it).
- **Fresh entries are `draft`** — review/publish happens later, outside corpus
  scope. `readTimeline()` returns all persisted entries (corpus scope: one
  child's timeline, drafts only).
- **`reload()`** simulates a cold start: after it resolves, `readTimeline()`
  must equal what a fresh process would read from durable state. A
  server-backed adapter whose reads are already cold-start-equivalent may
  no-op.
- **Wire shapes** mirror the schema contract: `occurredAt`/`createdAt` are
  Unix-ms **numbers**, `_tag` literals are required, optional fields are
  **absent** — explicit `null` (e.g. `quantity: null`, `note: ""`) is a
  violation. One deliberate addition: `WireEntry.captureId` carries the
  capture identifier (resilient capture / duplicate-protection key), which the
  Entry contract predates — map your capture identity to it.

## The corpus (6 fixtures, data only)

| # | File | Kind | Pins |
|---|------|------|------|
| 1 | `01-multi-event-narrative.json` | `multi-event-narrative` | 3 events from one narrative: exact count, exact categories/quantities, transcript order, absolute times |
| 2 | `02-relative-time-timezones.json` | `relative-time` | 8 single-event cases: exact absolute instants across `America/New_York`, `Pacific/Auckland` (NZST **and** NZDT), `UTC` |
| 3 | `03-malformed-extraction.json` | `malformed-extraction` | Hostile raw input (control chars, DEL, tabs): entry still created, **0** events persisted, raw preserved |
| 4 | `04-retry-double-submit.json` | `retry-double-submit` | Same `captureId` twice → `Created` then `IdempotentReplay`, exactly 1 entry / 1 event on the timeline |
| 5 | `05-raw-fidelity.json` | `raw-fidelity` | SHA-256 byte equality of the raw transcript across a validation failure and a retry (created entry, replay, timeline read) |
| 6 | `06-reload-persistence.json` | `reload-persistence` | Timeline identical (canonical JSON deep-equal) across a simulated cold start; events unchanged |

### Time conventions (fixture 2 holds candidates to these)

| Expression | Resolves to |
|---|---|
| `this morning` | 08:00 local on the capture date, in the capture zone |
| `yesterday 6pm` | 18:00 local on the calendar day before the capture date, in the capture zone (offset taken **at that instant** — DST-safe) |
| `an hour ago` | `capturedAt` − exactly 3 600 000 ms (zone-independent) |
| `just now` | `capturedAt` exactly (zone-independent) |

Expected instants were machine-computed with the IANA tz database via
`Intl.DateTimeFormat` (offset at the resolved instant, iterative convergence).
Highlights that pin the hard cases: NZST→NZDT boundary (Sep 27 2026) shifts
"yesterday 6pm" from `+12:00` (`1789452000000`) to `+13:00` (`1790571600000`),
and the US DST end (Nov 1 2026) makes "yesterday 6pm" resolve in EST
(`1793574000000` = Nov 1 18:00 EST). The generator used to derive every
expected value is archived in the PR authoring notes.

### What is (and isn't) pinned

- **Pinned exactly**: event count and order, category, `occurredAt` (default
  tolerance 0 — fixtures may allow slack via `toleranceMs`), quantity
  (presence, value, unit), note keywords (`noteContains`, case-insensitive —
  free text is matched by keywords, not exact strings), `authorId`, entry
  status `draft`, raw byte-fidelity, idempotency, reload stability.
- **Not pinned**: `confidence` value (only finite within [0,1]) and
  `createdAt` (only finite — candidates may stamp wall clock; every pinned
  time is `occurredAt`). NLP quality beyond these fixtures is judged
  qualitatively by the cross-review, not by this harness.

## Fixture areas & the manifest (namespace registration)

The corpus root is flat, but fixture areas may also live in sub-namespaces
(e.g. `agent-experience/catchup/` — scenario-and-authorization data that bun
test suites in `packages/domain/test/` consume directly). Flat directory
scanning cannot see sub-namespaces, so registration is explicit:
**`fixtures/manifest.json`** lists every fixture AREA with its class and
runner binding. The harness reads ONLY registered areas — an unregistered
directory is invisible to every run, by design.

```json
{
  "version": 1,
  "areas": [
    { "path": ".", "fixtureClass": "extraction-accuracy", "runnerBinding": "adapter-corpus" }
  ]
}
```

- `path` — the area's directory, relative to the directory CONTAINING the
  manifest file. `.` is that directory itself (the flat root corpus).
  Allowed forms: `.` or slash-separated `[A-Za-z0-9._-]` segments — no `..`,
  no absolute paths, no trailing slash. Registration fails fast on anything
  else. Enumeration is non-recursive: an area owns exactly its own directory.
- `fixtureClass` — what the area's data pins and who validates it (closed set
  in `src/manifest.ts` `FIXTURE_CLASSES`).
- `runnerBinding` — who executes the data. Each class admits exactly one
  legal binding; a mismatched pair fails registration.

### Fixture classes

| Class | Binding | Validator semantics (at registration) | Runner semantics |
|---|---|---|---|
| `extraction-accuracy` | `adapter-corpus` | Every `*.json` file parses and carries a known `kind` + non-empty `id` (the corpus runner's dispatch needs it) | Executed by the candidate-agnostic corpus runner (`src/runner.ts`) against a `CandidateAdapter`; results count toward pass/fail |
| `scenario-and-authorization` | `bun-test-data` | Every `*.json` file parses (JSON-loadable). No kind/schema discipline here — schemas belong to the consuming test suites | Never executed by this harness. Consumed directly by bun test suites (e.g. `packages/domain/test/catchup.test.ts`); semantic validation and execution live with the consumer |

Rules that hold for every area:

- **Fail-fast registration.** An area that doesn't exist, owns no `*.json`
  file, or violates its class's validator rules fails the whole run before
  any fixture executes. Nothing is silently skipped.
- **The manifest never loads as a fixture.** `fixtures/manifest.json` is
  excluded from every area's file list — including the root area (`.`) that
  contains it.
- **A corpus run needs a corpus.** The manifest must register at least one
  `extraction-accuracy` area; a manifest without one fails registration.
- **Determinism.** Areas are processed in manifest order; files within an
  area, in sorted order. With no `scenario-and-authorization` areas
  registered, `bun src/run.ts` output is byte-identical to the pre-manifest
  harness.
- **Registration ≠ execution** for `bun-test-data` areas: the CLI validates
  their structure and lists them at the end of the run, but they never
  execute there and never affect the exit code.

### How a new area registers

1. Create the area directory under `evaluation/fixtures/` (e.g.
   `agent-experience/catchup/`) and add its `*.json` fixture files — pure
   data, no code.
2. Add ONE entry to `fixtures/manifest.json`:
   - Extraction-accuracy area (transcript→events expectations): 
     `{ "path": "your-area", "fixtureClass": "extraction-accuracy", "runnerBinding": "adapter-corpus" }`.
     Files must carry a known `kind` (see `src/fixtures.ts` `KNOWN_KINDS`).
   - Scenario-and-authorization area (scenario setup, grants, expected
     outcomes for bun tests):
     `{ "path": "your-area", "fixtureClass": "scenario-and-authorization", "runnerBinding": "bun-test-data" }`.
     No `kind` needed; your bun test suite owns the schema and execution.
3. Verify: `bun src/manifest-selfcheck.ts` (registration rules), then
   `bun src/run.ts` — corpus fixtures run as before; scenario areas are
   listed (not executed) at the end of the output. A new extraction-accuracy
   area's fixtures join the corpus run and its pass/fail counts.

An area needs no code in `src/` — registration is data-only. Only a NEW
CLASS (a third validator/runner semantic) touches `src/manifest.ts`
(`FIXTURE_CLASSES`) plus dispatch behavior in `src/run.ts`.

## Exact commands

No runtime dependencies — any TS runner works. Primary (matches the repo's
bun availability):

```bash
cd evaluation
bun src/run.ts                                        # corpus vs the worked example adapter (manifest-driven)
bun src/run.ts --adapter=./path/to/your-adapter.ts    # corpus vs a candidate adapter
bun src/run.ts --adapter=./src/example/broken-adapter.ts --expect-failure
bun src/manifest-selfcheck.ts                         # fixture-area registration rules (seed manifest + fail-fast rejections)
bun install && bun run typecheck                      # tsc --noEmit, strict
```

Node-flavored alternative (zero-dep harness, tsx fetches itself):

```bash
npx tsx src/run.ts
```

Exit codes: `0` = all fixtures passed; `1` = at least one failure. With
`--expect-failure`, inverted (exit `0` iff the run **caught** a failure) — the
negative control depends on that.

## Attaching a candidate adapter (cross-review)

1. Author one module exporting `createAdapter(): CandidateAdapter` that wraps
   the candidate's **entry-creation** and **timeline-read** entry points
   (plus a `reload()`; a no-op is acceptable for always-fresh server reads).
   Import interface types from `evaluation/src/adapter.ts` (or
   `@journal/evaluation` once workspace-wired).
2. Run `bun src/run.ts --adapter=./your/adapter.ts` and attach the full output
   as the candidate's evidence. The harness never imports candidate code and
   candidate adapters never import corpus internals — only the interface.
3. Arena isolation: adapters must not read other candidates' branches; the
   corpus is identical for all four.

## Validation evidence (observed, this branch)

Ran on `eval/corpus-harness` (Node's IANA tzdb via bun 1.3.14 / tsc 5.9.3):

| Command | Result |
|---|---|
| `bun src/run.ts` (worked example adapter) | **6/6 fixtures PASS**, exit 0 — `multi-event-narrative` (3 events), `relative-time-timezones` (8 cases), `malformed-extraction` (failure path, raw preserved), `retry-double-submit` (exactly one entry, no duplicate events), `raw-fidelity` (2 cases, sha256-checked), `reload-persistence` (2 entries, cold-start) |
| `bun src/run.ts --adapter=./src/example/broken-adapter.ts --expect-failure` | **Faults caught** (exit 0): retry created a duplicate (`expected IdempotentReplay, got Created`), trimmed transcripts rejected by SHA-256 byte check on created/replayed/timeline surfaces, 0-event entries rejected on every event expectation — 5 of 6 fixtures flagged. `malformed-extraction` still passes, correctly (the control happens to satisfy that contract) |
| `bun run typecheck` | exit 0 — strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` |

Fixtures that execute: all six (1 + 8 + 1 + 1 + 2 + 2 = 15 adapter workloads).
Observed per-fixture results are printed by the runner; nothing was skipped.

## Non-goals

- Not an NLP benchmark: extraction quality beyond what these transcripts pin
  is judged qualitatively at cross-review.
- Not the E2E/integration task (that proves one integrated flow end-to-end);
  this judges all candidates identically on capture-pipeline semantics.
- No publish/review transitions, multi-child scoping, or authz — corpus scope
  is one child's draft timeline.
