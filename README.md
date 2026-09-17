# obv-hackaton — Shared Child Journal (arena candidate C)

Minimal-but-real vertical slice: a caregiver submits synthetic text; raw input is
retained unchanged; a schema-validated event set is persisted; the entry renders in a
child timeline after reload — deduplicated by a stable `captureId`.

**Stack:** pnpm/Turborepo · Expo/React Native (Expo 54.0.28, RN 0.83.0) · Convex 1.46.0
(local dev) · Effect 4.0.0-rc.115 · TypeScript 5.9.3 strict.

```
packages/domain        Effect v4 schema authority + capture state machine + services
packages/persistence   CaptureStore: in-memory double + live Convex adapter + functions
packages/extraction    Deterministic extractor double + labeled live-LLM boundary
apps/cli               Journey driver — the whole contract as a runnable command
apps/mobile            Expo capture screen on the same domain machine
```

## Quickstart

```bash
pnpm install
pnpm -r typecheck && pnpm -r test && pnpm -r build
# deterministic, dependency-free journey:
node apps/cli/dist/main.js --store=memory
# live local Convex (backend on 127.0.0.1:3210):
cd packages/persistence && npx convex dev &   # keep running
node apps/cli/dist/main.js --store=convex
```

Run it twice in convex mode — the second process finds the same entry, no duplicate.

Arena details, evidence labels (local-real vs test double vs cloud-absent), and design
rationale: [docs/ARENA-CANDIDATE-C.md](docs/ARENA-CANDIDATE-C.md).
