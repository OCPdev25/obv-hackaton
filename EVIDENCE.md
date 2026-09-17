# Evidence — arena/candidate-a

Every claim below was produced by the command shown and quoted from its
observed output on 2026-09-17 in this sandbox. Re-run them all with the four
commands in §1.

## 1. Commands

```bash
# Local Convex dev backend (anonymous mode — no cloud, no login):
CONVEX_AGENT_MODE=anonymous npx convex dev      # in tmux, stays running

# Domain gate, unit gate, e2e gate:
pnpm typecheck      # tsc --noEmit over the whole app + convex + scripts
pnpm test:unit      # vitest run
pnpm e2e            # tsx scripts/e2e-local-convex.ts against 127.0.0.1:3210

# Expo app config parse (composition-root sanity; no device in this sandbox):
npx expo config --type public
```

## 2. Observed output

### 2.1 `pnpm typecheck` — exit 0, no output (0 errors)

App (`App.tsx`, `src/app/**`), domain (`src/domain/**`), services
(`src/services/**`), interpreter (`src/engine/**`), Convex functions
(`convex/**`), and the e2e script all compile under the strict Expo tsconfig.

### 2.2 `pnpm test:unit`

```text
 ✓ src/domain/schema.test.ts (10 tests) 10ms
 ✓ src/services/extraction.test.ts (3 tests) 8ms
 ✓ src/services/repository.test.ts (2 tests) 5ms
 ✓ src/domain/captureState.test.ts (13 tests) 10ms
 ✓ src/engine/interpreter.test.ts (3 tests) 7ms

 Test Files  5 passed (5)
      Tests  31 passed (31)
```

### 2.3 `pnpm e2e` — against the REAL local Convex backend

```text
e2e: local Convex backend at http://127.0.0.1:3210
(persistence: LIVE local backend — extraction: DETERMINISTIC double — cloud/LLM: NOT exercised)
  PASS  fixtures ensured (child + caregivers upserted, ids are stable keys)

Scenario A — publish cap-e2e-a-1789669016616
  PASS  capture parks at review before publishing
  PASS  flow reached published
  PASS  row appears after a fresh-client reload
  PASS  raw transcript survived the wire BYTE-IDENTICAL
  PASS  event decoded with category + caregiver name
  PASS  timestamp decoded as Date

Scenario B — validation failure then retry cap-e2e-b-1789669016656
  PASS  first attempt lands in validationFailed
  PASS  raw transcript PRESERVED in the failure state
  PASS  retry lands at review with the preserved transcript
  PASS  publish after retry reaches published
  PASS  exactly ONE row after the retried publish (idempotent, no duplicate entry)
  PASS  retried row keeps the raw transcript byte-identical
  PASS  retried row decoded with category sleep + second caregiver

Scenario C — server-side idempotency and domain-authority rejection
  PASS  re-publishing the same captureId returns duplicate:true
  PASS  re-publish returns the SAME record id (no second row)
  PASS  timeline still holds exactly one row for that captureId
  PASS  server rejects confidence outside [0,1] via the Effect Schema (domain authority)
  PASS  rejected payload stored NOTHING

RESULT: 19 passed, 0 failed
```

### 2.4 `npx expo config --type public`

```text
env: load .env.local
env: export CONVEX_DEPLOYMENT EXPO_PUBLIC_CONVEX_SITE_URL EXPO_PUBLIC_CONVEX_URL

{
  name: 'Shared Child Journal',
  slug: 'shared-child-journal',
  ...
}
```

## 3. Provider labels (explicit, per the arena brief)

| Layer | Implementation exercised | Label |
|---|---|---|
| Extraction | `makeDeterministicExtraction` — fixed `"<category>: <text>"` rule, no network | **deterministic test double** |
| Persistence | Convex anonymous local backend at `http://127.0.0.1:3210`, real HTTP via `ConvexHttpClient`, documents durably stored in `.localbackend/` | **local-real persistence** |
| Live LLM | not present anywhere in this branch | **labeled absence — not exercised** |
| Cloud deployment | no Convex cloud deploy was made | **labeled absence — not exercised** |
| Device UI | Expo app code typechecks and the config parses; no iOS/Android emulator in this sandbox | **labeled absence — device verification pending** |

The e2e banner prints these labels on every run, so no evidence can be
mistaken for cloud/LLM evidence.

## 4. Pinned dependencies (from package.json)

- `effect@4.0.0-rc.115` — Effect v4 RC; Schema is the domain authority
- `convex@1.46.0` — transport + local backend
- `expo@~57.0.23`, `react@19.2.3`, `react-native@0.86.3`, `expo-status-bar@~57.0.1`
- dev: `typescript@~6.0.3`, `vitest@5.0.1`, `tsx@4.23.13`, `@types/node@22.20.3`, `@types/react@~19.2.2`
- `packageManager: pnpm@10.17.1` (Corepack)

## 5. What the e2e proves (mapped to the arena contract)

- **Raw input retained unchanged** — byte-identical transcript read back from
  the backend by a FRESH `ConvexHttpClient` (simulated app reload), leading
  and trailing spaces intact.
- **Schema-validated event persisted** — `publishCapture` re-decodes the wire
  payload through the Effect `Entry` schema server-side; a confidence of `1.5`
  is rejected and stores NOTHING (Scenario C).
- **Renders after reload** — timeline query joins caregiver names; decoded
  rows carry `Date` objects.
- **Validation failure + retry without input loss or duplication** — the
  machine parks in `validationFailed` with the raw transcript, retry re-extracts
  from the PRESERVED text (no re-entry), publish lands exactly one row, and a
  replay of the same `captureId` returns `duplicate: true` with the ORIGINAL
  record id (server-side idempotency, mirrored by the in-memory double).
- **Idempotency on a stable captureId** — both in the pure update, the
  interpreter, and the Convex function.

## 6. Honest limitations

- Extraction is rule-based by design; no LLM call was made, so nothing here
  evidences live model behavior.
- The Convex backend is the anonymous local one; no cloud deployment.
- UI verification is type-level + config-level only; rendering was not
  exercised on a device in this environment.
- No PR was opened: the arena contract forbids PRs to master and requires the
  branch push only. PR-level visual QA evidence therefore does not apply.
