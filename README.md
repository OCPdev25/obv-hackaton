# obv-hackaton

Shared Child Journal — AI dictation-powered agent companion monorepo.

## deploy/thin-path branch — deployment-verification vehicle

> **This branch is a deployment-verification vehicle, not a product stack.** It carries
> the minimal thin-path Convex functions used to prove deployment + synthetic write→read
> on the existing dev deployment. Candidates own their own stacks; the winning candidate
> replaces this branch's `convex/` + `package.json` at integration.

Deployed to the **existing** Convex dev deployment `reliable-panther-823`
(https://reliable-panther-823.convex.cloud — created by Gil; the stored
`CONVEX_DEPLOY_KEY` scopes to it; no project was created, no login performed).

- Evidence: [`deploy/thin-path-evidence.md`](deploy/thin-path-evidence.md)
- Deployed code commit: `94e706c`
- Contract: Shared Child Journal — Effect v4 Schema Contract v0.1 (`art_I2TCG08V`), `effect@4.0.0-rc.115`

Functions (all evidence is **cloud dev + synthetic CLI data** — not live-LLM, not native
device, not browser UI):

| Function | Type | Contract behavior |
|---|---|---|
| `children:create` | mutation | Non-empty name, optional `birthDate` (unix ms) |
| `entries:createEntry` | mutation | Raw transcript always preserved; events decoded through the canonical Effect schema; idempotent on `captureId` retry (original wins); invalid events return `captured_with_event_errors` — capture is never blocked |
| `timeline:list` | query | Per-child, chronological |

## Commands

```sh
npm install
npm run contract:smoke        # local Effect contract decode/reject/encode checks
npm run deploy:thin-path      # CONVEX_DEPLOY_KEY=... npx convex deploy
CONVEX_DEPLOY_KEY=... npx convex run children:create '{"name":"Ada (synthetic)"}'
CONVEX_DEPLOY_KEY=... npx convex run timeline:list '{"childId":"<id>"}'
```

## Deployment-verified findings for other candidates

1. **Convex rejects stored fields starting with `_`** (reserved for system fields) — the
   contract's wire-level `_tag` literal must be stripped on write and re-wrapped on read;
   it cannot be persisted as the contract's mapping table assumed. See Finding F1 in
   [`deploy/thin-path-evidence.md`](deploy/thin-path-evidence.md).
2. **`import { Schema } from 'effect/Schema'` does not resolve on `effect@4.0.0-rc.115`** —
   the subpath exports members directly; use `import * as Schema from 'effect/Schema'`.
3. `convex codegen` / `convex deploy` typecheck against bindings generated from the
   current schema — regenerate before judging type errors after a schema change.
