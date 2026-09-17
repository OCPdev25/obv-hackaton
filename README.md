# Shared Child Journal — Arena Candidate A

Minimal-but-real vertical slice: a caregiver enters synthetic text, the raw input
is retained unchanged, a schema-validated entry is persisted, and it renders in a
child timeline after reload.

**Branch:** `arena/candidate-a` (frozen start: `origin/master@49224e0`) · **Stack:** Expo/React Native 0.86 + Convex 1.46 (local backend) + Effect 4.0.0-rc.115

## Layout

```
src/domain/      Effect Schema: Event, Entry, ids, state/message/command unions
src/engine/      interpreter — the only place effects run (commands → services)
src/services/    extraction double, Convex repository, in-memory double, fixtures
src/app/         Expo UI: CaptureScreen + useCaptureFlow (composition root)
convex/          transport validators + idempotent mutations + realtime query
scripts/         e2e-local-convex.ts — proof against the real local backend
```

## Commands

```bash
pnpm install                # pinned deps (see package.json)
pnpm test                   # vitest unit tests (state machine, schemas, doubles)
pnpm typecheck              # tsc --noEmit

npx convex dev              # anonymous local backend (no Convex account needed);
                            # serves http://127.0.0.1:3210, writes .env.local
pnpm dev                    # expo web (or scan QR for device)

pnpm e2e                    # scripts/e2e-local-convex.ts against the local backend
```

E2E scenarios: happy-path publish → fresh-client reload shows the row with a
byte-identical raw transcript; validation-failure → retry (same captureId)
without input loss and exactly one stored row; server-side duplicate rejection
and Effect-Schema-gated rejection (confidence outside [0,1]) storing nothing.

## Provider labels (evidence honesty)

- **LIVE local persistence** — real Convex dev backend over HTTP, real storage.
- **DETERMINISTIC extraction double** — rule-based classification, no LLM, no network.
- **ABSENT (labeled, not hidden)** — cloud Convex deployment; live LLM extraction.
