# obv-hackaton

## Status: arena candidate C on arena/candidate-c (frozen start origin/master@49224e0)

pnpm/Turborepo monorepo: Effect v4 domain, Convex persistence, Expo app, CLI journey
driver. Written by arena candidate C; other candidates may diverge on their own
branches.

## Stack (verified in-sandbox)

- Node 20.20.2, pnpm 12.4.2 (user-local: `export PATH="$HOME/.npm-global/bin:$PATH"`), Bun 1.3.14
- TypeScript 5.9.3 (strict), Vitest 5.0.1, Effect 4.0.0-rc.115, Convex 1.46.0, Expo 54.0.28

## Codebase map

- `packages/domain` — Effect v4 schema authority: branded ids, Event/Entry/TimelineItem,
  capture state machine (pure `[state, commands]` update), service interfaces, fixtures.
- `packages/persistence` — `CaptureStore` implementations (in-memory double, live Convex
  adapter), schema-derived wire codecs, Convex functions + schema (`convex/`).
- `packages/extraction` — deterministic extractor double + `provider_unavailable` boundary.
- `apps/cli` — journey driver: `node apps/cli/dist/main.js --store=memory|convex`.
- `apps/mobile` — Expo capture screen on the same domain machine.

## Commands

```bash
pnpm install
pnpm -r typecheck && pnpm -r test && pnpm -r build   # full gate: 14 tests
node apps/cli/dist/main.js --store=memory            # dependency-free journey
cd packages/persistence && npx convex dev            # local backend on 127.0.0.1:3210
node apps/cli/dist/main.js --store=convex            # live local Convex journey
```

## Conventions

- Effect v4 RC: import schemas/Effect from the root `effect` module; `Effect.catch`
  (not catchAll); encoded types via `(typeof X)['Encoded']`, decoded via
  `Schema.Schema.Type<typeof X>`.
- All external inputs decoded through canonical schemas at boundaries; wire types are
  derived, never restated; `_tag` stays on the wire.
- Idempotency keys live in the store (`captureId`), not in callers.
- Evidence labels distinguish local-real persistence vs deterministic test doubles vs
  absent cloud/live-LLM — see `docs/ARENA-CANDIDATE-C.md`.

## Sandbox snapshot details

To be filled by the next setup run.
