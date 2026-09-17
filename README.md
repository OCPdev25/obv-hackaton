# Shared Child Journal — Monorepo

Hackathon monorepo for a child-centered shared journal: caregivers capture
informal voice/photo updates, AI extracts typed care events, and authorized
household members follow a child's timeline without parent-to-parent chat.

## Stack

| Layer | Choice |
| --- | --- |
| Tooling | pnpm 10 (via Corepack) + Turborepo 2 |
| Mobile | Expo 57 / React Native 0.86 (TypeScript) with the Convex client wired |
| Backend | Convex — schema derived from the Effect domain contracts |
| Contracts | `packages/domain` — Effect v4 (4.0.0-rc.115) schemas, single source of truth |
| Extraction | `packages/extraction` — Effect pipeline stub (no LLM call yet) |
| UI | `packages/ui` — minimal shared React Native components |

## Layout

```
apps/mobile          Expo app; ConvexProvider reads EXPO_PUBLIC_CONVEX_URL
backend/convex       Convex schema + functions (children, households, entries, events)
packages/domain      Canonical Effect schemas + Convex-validator adapter + JSON Schema derivation
packages/extraction  Transcript -> typed events interface (stub)
packages/ui          Shared RN primitives (placeholder)
```

## Run

Requirements: Node 20.20.2, Bun 1.3.14 (tests), Corepack (bundled with Node).

```bash
corepack enable
pnpm install

pnpm typecheck        # turbo typecheck across all packages
pnpm build            # turbo build for buildable packages
pnpm test             # domain contract round-trip tests (bun)

# Mobile app (real or simulated device)
cp apps/mobile/.env.example apps/mobile/.env   # set EXPO_PUBLIC_CONVEX_URL
pnpm --filter @journal/mobile start

# Convex backend
cd backend/convex
npx convex dev        # requires `npx convex login` first
```

## Effect Schema contracts (why it matters)

`packages/domain` defines executable Effect v4 schemas for `Child`,
`Household`, `Entry`, and `Event` plus operation input/output schemas for
Convex queries/mutations. TypeScript types are inferred from schemas
(`typeof Schema.Type`) — never hand-written. All external inputs and LLM
outputs decode through these schemas with typed error channels. The
`@journal/domain/convex` adapter derives Convex validators from the same
schemas (covered by round-trip tests), and `toolSchemaFor` derives JSON Schema
(draft 2020-12) for LLM tool definitions.

### Confect decision

Confect (`@confect/*` 9.4.3) declares `effect: ^3.21.2` as a peer dependency
and npm refuses to install it alongside Effect v4 (ERESOLVE). We therefore use
plain Convex schemas derived from the Effect domain contracts through the
tested adapter instead of maintaining a parallel Confect layer.

## Thin-path deployment record (PR #5)

Before this monorepo scaffold landed, a standalone deployment-verification
vehicle (root `convex/` tree + npm `package.json`) proved deployment and
synthetic write→read on the existing dev deployment `reliable-panther-823`.
Per that PR's own integration note, the winning monorepo scaffold replaces the
standalone tree; its function behavior (idempotent `entries:createEntry`,
per-child `timeline:list`, `children:create`) ports onto
`backend/convex` in follow-up work against the canonical domain contract.

- Evidence: [`deploy/thin-path-evidence.md`](deploy/thin-path-evidence.md)
- Deployment-verified findings that still apply: Convex rejects stored fields
  starting with `_` (F1); `convex codegen`/`deploy` typecheck against bindings
  generated from the current schema (F3). See the evidence doc for details.

## CI

CI runs `pnpm install --frozen-lockfile` then `pnpm turbo run typecheck`,
`test`, and `build` on every PR to master (`.github/workflows/ci.yml`). The
pipeline was merged ahead of this scaffold and its package-level steps are
designed to go green with it.
