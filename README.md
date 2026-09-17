# obv-hackaton

**ARENA CANDIDATE B — capture → persist → timeline vertical slice.** Frozen start at
`origin/master@49224e0`, branch `arena/candidate-b`, delivered independently of other
candidates per the four-candidate arena contract. No PR to master from this branch.

## What this proves

In a minimal-but-real Expo/React Native + Convex + Effect v4 app:

1. A caregiver enters synthetic dictation text; the **raw input is retained unchanged**
   (persisted verbatim before anything else happens).
2. Extraction proposes a **schema-validated event**; a mutation persists it as a journal
   entry keyed by a client-minted, stable `captureId`.
3. A **validation failure + retry** demo: corrupt the meal `amount` to `"half"` (out of
   vocabulary) → the backend's Effect Schema decode rejects the event → the UI surfaces
   the failure, the raw text stays intact, and a corrected republish on the **same
   captureId** succeeds with **exactly one** entry in the timeline (no duplicate).
4. The entry renders in the **child timeline after reload**.

## Stack — exact pinned versions

| Package | Version | Role |
|---|---|---|
| `effect` | `4.0.0-rc.115` | Domain authority: executable schemas, TS types inferred, boundary decode |
| `convex` (backend CLI) | `1.19.3` | Function codegen + deployment against the self-hosted backend |
| `convex` (browser client) | `1.46.0` | Typed HTTP client in the Expo app |
| `convex-local-backend` binary | `precompiled-2026-09-16-8600144` | Self-hosted local-real persistence on port 3210 |
| `expo` | `57.0.23` | App runtime, web export via Metro |
| `react-native` / `react-native-web` | `0.86.3` / `0.21.2` | Renderer |
| `react` / `react-dom` / `@types/react` | `19.2.3` | React runtime |
| `typescript` | `5.9.3` | Strict typecheck |
| `vitest` | `5.0.1` | Contracts test runner |
| `bun` | `1.3.14` (toolchain) | Workspaces, script runner, test driver |

Why Convex `1.19.3` on the backend: Convex `1.46.0`'s CLI requires interactive
authentication/provisioning for its local dev flow, which cannot run in a headless
sandbox. The self-hosted backend binary keeps persistence **local-real** (real HTTP
Convex server, real SQLite) with no interactive login. The mobile client stays on
`1.46.0` (no CLI needed). Both versions are pinned in their manifests.

## Repository layout

```
packages/contracts   Effect v4 domain: schemas, capture machine, extraction service, fixtures
packages/backend     Convex functions (schema + mutations + queries), local demo script
apps/mobile          Expo app: capture screen, machine-driving hook, Metro monorepo config
```

## Commands

```bash
bun install                                   # install workspace dependencies
bun run typecheck                             # tsc --noEmit in contracts, backend, mobile
bun run test                                  # vitest suites (contracts)
bun run demo                                  # backend end-to-end demo against the local Convex backend

# Local Convex backend (terminal 1) — see env vars below
packages/backend/convex-local-backend         # serves http://127.0.0.1:3210

# Deploy functions + seed fixtures (terminal 2)
cd packages/backend
bun run convex:dev -- --once                  # codegen + deploy ("Convex functions ready!")
bun run demo                                  # seed + raw persistence + idempotency + publish demo

# Expo app (terminal 3)
cd apps/mobile
EXPO_PUBLIC_CONVEX_URL=http://127.0.0.1:3210 npx expo start --web --port 8081
```

`EXPO_PUBLIC_CONVEX_URL` is a public env var baked into the bundle at build time
(defaults to `http://127.0.0.1:3210`). Point it at a tunnel/preview URL of the local
backend when the browser runs on a different machine.

Backend CLI env (in `packages/backend/.env.local`, gitignored — create locally):
`CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210` and
`CONVEX_SELF_HOSTED_ADMIN_KEY=<from the backend binary's output>`.

If Metro serves stale workspace code after editing `packages/contracts`, restart Expo
with `--clear` (clears the Metro transform cache).

## Test walkthrough (the required demo, click by click)

1. Type `She slept from one thirty to three with the bear` → **Capture text** →
   machine reaches **Review** proposing `sleep — nap` → **Publish** → `Published ✓`,
   timeline gains the entry.
2. Tick **Corrupt next meal event**, type `She ate most of her pasta at lunch` →
   **Capture text** → Review shows `meal — amount: half` → **Publish** →
   `EVENT_DECODE_FAILED: Expected "none" | "some" | "most" | "all" at ["amount"]` —
   raw text intact, machine stays in Review, nothing persisted.
3. **Retry publish (corrected, same captureId)** → `Published ✓`; the timeline holds
   **exactly one** entry for that captureId.

## Evidence labels (per the arena contract)

- **LOCAL-REAL**: Convex persistence above — self-hosted backend binary, real HTTP
  transport, real SQLite storage, real schema validation at the mutation boundary.
- **CONTROLLED TEST DOUBLE**: `extractDeterministic` keyword rules (contracts) —
  deterministic extraction, also the shipping offline fallback; extraction never
  gates capture. Unit-tested via the `ExtractionService` Effect interface.
- **CLOUD-ABSENT (labeled, not hidden)**: no deployed Convex cloud instance, no live
  LLM provider, no API keys anywhere in this slice. The live-LLM path is stubbed at
  the service boundary (`live_unavailable` reason) by design.

## Known limitations

- Native iOS/Android runtimes are untested in this slice (sandbox is headless); the app
  is verified through Expo web against the same Metro bundle.
- Food extraction labels ("most of" as a food noun) are cosmetic quirks of the
  deterministic double, not of the schema or persistence path.
- The Expo web dev server requires a browser reachable from the machine running it;
  cross-origin browser testing uses preview URLs for both the app (8081) and the
  backend (3210).
