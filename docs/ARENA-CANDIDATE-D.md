# Arena Candidate D — Capture → Persist → Timeline vertical slice

Branch `arena/candidate-d`, cut from frozen base `origin/master @ 49224e0`.
Status: complete — see [Verification](#verification) for exact commands and
observed output.

## What this candidate delivers

A minimal-but-real Expo (React Native) + Convex + Effect v4 monorepo in which:

1. a caregiver enters synthetic dictation text,
2. the raw input is retained **unchanged** (verbatim, proven by reload reads),
3. a schema-validated event set is persisted through an idempotent boundary,
4. the entry renders in a child timeline after reload (fresh client).

## Stack — actual pinned dependencies

| Package | Version | Role |
|---|---|---|
| `effect` | `4.0.0-rc.115` | domain authority: executable schemas, Layer/Context services, typed errors |
| `convex` | `1.46.0` | persistence (local dev mode) + browser/RN client |
| `expo` | `57.0.23` | RN app shell (bundles `react-native@0.86.3`, `react@19.2.3`, `react-native-web@~0.21.0`, `expo-status-bar@~57.0.1`, `@expo/metro-runtime@~57.0.15`) |
| `typescript` | `5.9.3` | strict typecheck everywhere |
| `vitest` | `3.2.7` | unit/property tests (domain 25, capture 23) |
| `pnpm` | `10.34.5` (via `corepack pnpm`) | workspace package manager |

Node runtime: sandbox Node (tsx runner for scripts). Convex runs in **local dev
mode** via `convex dev` (anonymous local backend, port 3212).

## Architecture

```
packages/domain    Effect Schema: Ids (branded), Entry, Event, CaptureState,
                   CaptureMessage, fixtures (1 child, 2 caregivers), wire codecs
packages/capture   pure reducer ([state, commands]), command runtime, capture
                   loop; ExtractionService + EntryStore as Context.Tag services
                   with Layer factories: deterministic extractor / faulty
                   extractor / unconfigured live LLM; in-memory store / Convex store
packages/backend   Convex schema + entries functions (idempotent publishEntry,
                   timelineForChild), e2e driver
apps/mobile        Expo capture screen: renders CaptureState, dispatches
                   CaptureMessages, wires real services (deterministic extractor
                   + Convex store layer), timeline view
```

**Contract discipline.** Effect Schema is the single source of executable truth:
TS types are inferred via `Schema.Schema.Type`, external inputs (Convex
documents, user text) are decoded at boundaries, wire encoding (`Date` → unix
ms) lives in the schema, not in call sites. Capture is modeled explicitly:
`Idle → Recording → Transcribed → Extracting → Review → Published` plus
`Failed*`/`Cancelled` paths; messages are a tagged union; the reducer is pure
`[state, commands]`; commands are named (`ExtractEvents`, `PublishEntry`);
effectful operations are isolated behind `Context.Tag` service interfaces with
`Layer` factories providing live and controlled test implementations.

**Idempotency.** `publishEntry(captureId, …)` is keyed on a stable `captureId`:
the mutation checks the `by_captureId` index first and returns the existing
entry id on retry. Proven: publish #2 (retry, same captureId) returned the same
id as publish #1; timeline holds exactly one row.

## Design rationale — decisions and rejected alternatives

1. **Plain Convex validators + Effect domain schemas (chosen)** over Confect
   (`@confect/*` schema-as-table-definition). Confect 9.4.3 peers on Effect
   `^3.21.2` — incompatible with the pinned Effect v4 RC. Rejected "effect
   Schema decodes Convex reads/writes by hand": chosen form keeps the Effect
   schema authoritative for domain/wire and Convex validators for storage
   shape, with one encode/decode module owning the mapping.
2. **Pure reducer + command list (chosen)** over imperative React state
   machine hooks inside components. The brief requires pure `[state, commands]`
   updates; Foldkit findings back state-logic-outside-React so the identical
   reducer runs in Vitest, the backend driver, and the RN app unchanged.
3. **`Context.Tag` + `Layer` service boundary (chosen)** over plain module
   injection objects. Layers give typed swap of extraction/store
   implementations per environment (test vs local-real vs unconfigured-live)
   without changing call sites, and keep failures typed (`ExtractionFailed`,
   `StoreUnavailable`).
4. **Deterministic rule-based extractor as default (chosen)** over calling a
   live LLM. Contract requires schema-validated events and reproducible
   evidence; the deterministic double is labeled as such everywhere, and the
   live provider path exists behind the same service interface but fails fast
   ("not configured") rather than faking success.
5. **Expo web export (`output: "single"`) as the visual-evidence runtime
   (chosen)** over iOS simulator. The sandbox has no iOS toolchain; RN-web is
   the same React tree (App.tsx, StyleSheet, Pressable, TextInput) bundled by
   Metro from the same sources, driven headlessly through the real Convex
   backend. Rejected "convex + plain React demo page": it would not prove the
   Expo app compiles and runs.
6. **Storage omits the reserved `_tag` field (chosen)** over renaming domain
   discriminators. Convex forbids leading-underscore fields; the constant
   `"Entry"` discriminator is restored on read. Rejected renaming to
   `kind`/`type` — that would fork the published contract.
7. **`convex dev` local mode / anonymous local backend (chosen)** over a
   manually downloaded backend binary. It is the documented Convex local dev
   flow, manages codegen + push + watch, and needs no account. (A manual
   `convex-local-backend` binary run was proven first, then retired as
   redundant.)
8. **Metro `resolveRequest` shim for `.js` → `.ts` (chosen)** over rewriting
   all intra-package imports to `.ts`. Node/tsx-compatible `.js` specifiers
   stay idiomatic; the single shim keeps Metro resolving TS-source workspace
   packages.
9. **Fixtures via schema decoding (chosen)** over hard-coded literals without
   decoding. Fixtures (child Mila; caregivers Ana, Rafa) must satisfy the
   executable schemas at construction; no fixture-derived limits were added to
   schemas (no array-length caps).

## Evidence labels

- **LOCAL-REAL persistence**: the Convex backend is a real local Convex server
  (`convex dev` anonymous local backend on `127.0.0.1:3212`, SQLite-backed);
  data survives process-level reload semantics (fresh client read-back);
  writes and index-backed reads are real.
- **DETERMINISTIC EXTRACTION TEST DOUBLE**: `makeDeterministicExtractor` is a
  rule-based service implementation — no model call. It is the same
  `ExtractionService` interface a live provider would implement.
- **LIVE-LLM: ABSENT (labeled, not hidden)**: no live LLM was called in this
  candidate. `makeUnconfiguredLiveExtractor` exists and fails fast with
  `ExtractionFailed{reason:"live provider not configured"}`; no API keys, no
  cloud provider integration in scope.
- **DEPLOYED (CLOUD) CONVEX: NOT EXERCISED in this candidate.** The shared
  cloud deployment (`reliable-panther-823`) predates this branch; nothing here
  was pushed to or read from cloud Convex. All persistence evidence is the
  LOCAL-REAL backend above.

## Verification

All commands from the repo root (pnpm via `corepack pnpm`).

```
$ corepack pnpm -r typecheck
apps/mobile typecheck: Done          # tsc --noEmit, strict
packages/backend typecheck: Done
$ corepack pnpm -r test
packages/domain test:  Test Files  1 passed (1)   Tests  25 passed (25)
packages/capture test: Test Files  4 passed (4)   Tests  23 passed (23)
$ corepack pnpm -r build          # mobile: expo export --platform web
apps/mobile build: Exported: dist
GATE_EXIT=0
```

Local backend + E2E driver (LOCAL-REAL persistence, deterministic extraction):

```
$ (packages/backend) corepack pnpm exec convex dev --typecheck=disable   # tmux, watch mode
17:56:48 Convex functions ready! (313.57ms)   # [Local] Port 3212 • No Convex account
$ CONVEX_URL=http://127.0.0.1:3212 corepack pnpm exec tsx e2e/driver.ts
[capture] raw input: "Mila used the potty today. She napped for 90 minutes." (53 chars)
[extract] deterministic extractor produced 2 schema-valid event(s)
[extract]   category=potty note="Mila used the potty today." quantity=null
[extract]   category=sleep note="She napped for 90 minutes." quantity={"value":90,"unit":"minutes"}
[persist] publish #1 stored entry j579sknyq9j9qfjaz4asz75gz98ekx5z (LOCAL-REAL Convex at http://127.0.0.1:3212)
[persist] publish #2 (retry, same captureId) returned j579sknyq9j9qfjaz4asz75gz98ekx5z
[reload] timeline read returned 1 row(s) after reload
[reload] transcript verbatim after reload: YES (53 chars)
[reload] event categories in timeline: [potty, sleep]
E2E PASS (local-real persistence, deterministic extraction)
```

Browser E2E through the real Expo/RN-web app (Playwright Chromium, 1440×900),
driving the same flow against the LOCAL-REAL backend — six checks PASS:
app renders; raw transcript verbatim in Transcribed; review shows potty event;
review shows sleep event with quantity (90 minutes); timeline renders the
published entry after persistence; no page errors. Screenshots
`tc-1-idle.png`, `tc-2-transcribing.png`, `tc-3-review.png`,
`tc-4-published-timeline.png` (evidence directory, not committed).

Validation-failure + retry without losing raw input: covered at unit level
(`packages/capture` tests: schema-invalid extractor output keeps
`rawTranscript` and offers RetryExtraction; late/cancelled results are
suppressed) and structurally in the flow (Review → publish is the only path
that persists; failures never discard the raw transcript).

## Reproduce from a clean checkout

```
corepack pnpm install
corepack pnpm -r typecheck && corepack pnpm -r test
cd packages/backend && corepack pnpm exec convex dev --typecheck=disable   # keep running
CONVEX_URL=http://127.0.0.1:3212 corepack pnpm exec tsx e2e/driver.ts
# optional visual run:
cd apps/mobile && corepack pnpm exec expo export --platform web
python3 -m http.server 8090 -d dist   # then open http://localhost:8090
```

## Not in this candidate (explicitly)

- Live LLM extraction (interface + fail-fast stub only — see labels above).
- Cloud/deployed Convex evidence (see labels above).
- Voice/audio input (text entry is the contract's capture surface; the state
  machine's `Recording` state is the seam where a dictation component plugs in).
- Auth, households, permissions (later slots; fixtures only here).
