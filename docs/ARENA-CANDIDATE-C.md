# Arena Candidate C — capture → persist → timeline vertical slice

Branch: `arena/candidate-c` · Frozen start: `origin/master@49224e0` · Task: todo_as8Avx6r

## What runs

A minimal-but-real monorepo: **Expo/React Native + Convex + Effect v4**, with one vertical
slice — a caregiver submits synthetic text; the raw input is retained unchanged; a
schema-validated event set is persisted; the entry renders in a child timeline after
reload, deduplicated by a stable `captureId`.

| Package | Role |
|---|---|
| `packages/domain` | Effect v4 schema authority: branded ids, canonical Event/Entry/TimelineItem, tagged capture state machine (Idle/Recording/Transcribed/Extracting/Review/Published), pure `[state, commands]` update, named effectful commands, service interfaces (`CaptureStore`, `Extractor`), fixtures (one child, two caregivers) |
| `packages/persistence` | `CaptureStore` implementations: in-memory controlled double + live Convex adapter (`ConvexHttpClient`), schema-derived wire codecs, Convex functions with `by_capture_id` idempotency |
| `packages/extraction` | Deterministic heuristic extractor double + labeled `provider_unavailable` live-LLM boundary |
| `apps/cli` | Journey driver (`--store=memory \| convex`) that runs the whole contract end-to-end |
| `apps/mobile` | Expo capture screen driving the same domain machine and in-memory store |

## Exact pinned dependencies (verified, not claimed)

- `effect` `4.0.0-rc.115` (v4 RC; schemas and Effect from the root `effect` module)
- `convex` `1.46.0` (anonymous local dev; cloud deployment deliberately not used)
- `typescript` `5.9.3`, `vitest` `5.0.1`, `expo` `54.0.28`, `react-native` `0.83.0`, `pnpm` `12.4.2`

## Commands and observed output (this sandbox, this session)

```text
$ pnpm -r typecheck && pnpm -r test && pnpm -r build
packages/domain typecheck: Done
packages/extraction typecheck: Done
packages/persistence typecheck: Done
apps/cli typecheck: Done
apps/mobile typecheck: Done
packages/domain test: Test Files 1 passed (1) · Tests 10 passed (10)
packages/extraction test: Test Files 1 passed (1) · Tests 3 passed (3)
packages/persistence test: Test Files 1 passed (1) · Tests 1 passed (1)
packages/domain build: Done
packages/extraction build: Done
packages/persistence build: Done
apps/cli build: Done
=== FINAL VERIFY EXIT=0 ===

$ npx convex dev            # packages/persistence — anonymous local backend
  [Local] Port 3210 • No Convex account
  ✔ Added table indexes: entries.by_capture_id, entries.by_child_created
  ✔ Convex functions ready! (301.68ms)

$ node apps/cli/dist/main.js --store=memory        → EXIT=0 (full transcript below)
$ node apps/cli/dist/main.js --store=convex        → EXIT=0 (entryId j577p8g1t02p77f7msegaa6x8n8ekh6q)
$ node apps/cli/dist/main.js --store=convex  (2nd process, same captureId)
  republish outcome: AlreadyPublished (entryId j577p8g1t02p77f7msegaa6x8n8ekh6q)
  timeline items for child child-mila: 1
```

Journey steps visible in both modes: schema rejections (event with confidence 1.5,
entry with empty transcript) with the raw transcript untouched → TextCaptured →
scripted persist outage + `RetryPersistRaw` (memory mode) with the raw text preserved
through the failure → deterministic extraction (meal, sleep, milestone, school) →
Review → ConfirmedReview → Published → republish = `AlreadyPublished` (no duplicate) →
timeline reload shows exactly 1 item.

## Evidence labels (explicit, per the contract)

- **LOCAL-REAL PERSISTENCE**: the `--store=convex` runs hit a real local Convex backend
  (`127.0.0.1:3210`), wrote through `ctx.db` mutations, and re-read through a fresh
  `ConvexHttpClient` per call — including the cross-process second run that found the
  SAME document id and NO duplicate.
- **DETERMINISTIC TEST DOUBLE**: extraction in every run is the keyword-rule heuristic
  (`packages/extraction`) — same input → same events, no network.
- **CLOUD ABSENT / LIVE-LLM ABSENT (labeled, not hidden)**: no Convex cloud deployment
  and no live LLM provider is configured. `unavailableProviderExtractorLayer` is the
  replaceable provider boundary; using it fails with the typed
  `provider_unavailable` error. Swapping in a live provider is a layer change, not a
  refactor.
- **NOT DEVICE-VERIFIED**: the Expo app typechecks strict (`apps/mobile typecheck: Done`)
  but was not run on a device/simulator in this arena.

## Design rationale — and rejected alternatives

1. **Effect Schema as the single domain authority.** TS types are inferred from the
   schemas (`Schema.Schema.Type`), external inputs are decoded at boundaries, and the
   wire codecs are DERIVED from the same schemas (`(typeof Entry)['Encoded']`) — no
   hand-restated wire types. Rejected: hand-written duplicate types (drift) and
   zod-adjacent validators (second source of truth).
2. **Pure reducer + named commands.** `update` returns `[state, commands]`;
   `dispatchMessage` executes commands and feeds results back. Rejected: effects inside
   the reducer (breaks determinism/testing) and state stored in a hook (untestable).
3. **Service interfaces with live + controlled implementations.** `CaptureStore` and
   `Extractor` are `Context.Service`s; the CLI/Expo pick layers by flag/config.
   Rejected: mocking modules (fragile) or conditional logic inside callers.
4. **Idempotency on `captureId` at the store, not the caller.** Both store
   implementations key entries by `captureId`; a retry — persist, publish, or a whole
   second process — is a no-op. Rejected: client-side "did I already do this?" flags.
5. **Convex validator = contract wire shape.** `_tag` stays on the wire (contract
   requirement), so the Convex validators mirror it (`v.literal('Event')` etc.) instead
   of stripping it — the wire contract and the validator are one shape.

## Arena note (frozen start, no contamination)

`origin/master` advanced ~9 commits during this attempt (other candidates' work).
Per the arena contract (frozen start at `49224e0`, no reading other candidates' work,
no merging to the shared default branch), candidate C was **not** synced with
origin/master before delivery; the comparison belongs to the cross-review phase.
