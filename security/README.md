# security/ — Household Membership & Visibility

Threat model and executable fail-closed access cases for the Shared Child Journal.

## Run

```bash
bun test ./security            # 17 tests: 13 negative cases + 4 positive controls
```

Static check (optional, run from a scratch dir with typescript + @types/bun installed — the repo has no root tsconfig yet):

```bash
tsc --noEmit --strict --exactOptionalPropertyTypes \
  --target es2022 --module esnext --moduleResolution bundler --skipLibCheck \
  --typeRoots <scratch>/node_modules/@types --types bun \
  security/access/*.ts
```

Zero dependencies — no install required. The repo at the time of this folder has no package manager scaffold; when the Turborepo scaffold lands, wire `bun test ./security` (or the CI pipeline's test task) to pick this path up.

## Files

| File | Purpose |
|---|---|
| [`THREAT-MODEL.md`](./THREAT-MODEL.md) | The model: actors, assets, trust boundaries, two-dimension rule, abuse cases with severity, fail-closed rules, contract gaps. |
| [`access/types.ts`](./access/types.ts) | Principal / Resource / Action / Decision types. |
| [`access/policy.ts`](./access/policy.ts) | `evaluateAccess` — pure, fail-closed decision function; `visibleEntries` — timeline projection. |
| [`access/schema-mock.ts`](./access/schema-mock.ts) | Contract v0.1 shape mock (art_I2TCG08V). ⚠️ PENDING: swap to the real spike package when `spike/effect-contracts-adapters` is pushed. |
| [`access/policy.test.ts`](./access/policy.test.ts) | Executable negative cases (`AB-*`, `DIM-*`) + positive controls (`PC-*`); each test documents the exact assertion that denies access. |

## Dependency labels (read before extending)

1. **Spike package pending.** `spikes/effect-compat` (branch `spike/effect-contracts-adapters`) was not on origin when this was written. Shapes are mocked per contract rule 1; swap the import when the package lands.
2. **Scoping types are extensions, not schema claims.** Contract v0.1 has no `householdId`/`childId`/roster — those live in `types.ts` as the threat model's required contract extensions (THREAT-MODEL.md §8).
3. **Enforcement is not wired.** No Convex function calls `evaluateAccess` yet; this is the reference decision function for whichever lane wires enforcement.
