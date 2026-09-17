# spikes/effect-compat — Effect v4 Compatibility Spike

Bounded compatibility spike for the Shared Child Journal monorepo: prove the
schema-first contract approach on ONE canonical schema (Entry + Event),
end-to-end, with everything pinned and every claim test-verified.

**Scope guard:** this directory is the ONLY thing owned by the
`spike/effect-contracts-adapters` branch. The monorepo scaffold lives elsewhere
(`feat/monorepo-scaffold`); findings feed `packages/domain` there.

## Layout

```
src/schema.ts           canonical executable schema (Entry, Event, Quantity, Confidence...)
src/json-schema.ts      JSON Schema derivation wrapper (toJsonSchemaDocument, draft-2020-12)
src/convex-adapter.ts   Effect schema -> Convex validators (single sanctioned representation bridge)
src/llm/contract.ts     extraction contract: captureId+attempt envelope, typed errors, strict decode
src/llm/openai.ts       OpenAI provider behind OPENAI_API_KEY (structural client, mocked in tests)
test/                   vitest suites — schema, JSON Schema, adapter round-trip, LLM (mocked)
FINDINGS.md             pinned versions, verified behaviors, gotchas, non-goals
```

## Run

```bash
bun install
bunx tsc --noEmit   # strict typecheck
bunx vitest run     # 37 tests
```

## Contract consumer notes (parallel lanes)

- Mock against `ExtractEvents` from `src/llm/contract.ts` — the envelope carries
  `captureId` + `attempt`; results are only applied when they are the latest attempt
  for a capture (stale-result suppression), and applying the same attempt twice is a no-op.
- Entry visibility is per-entry (`draft` | `published`); audience/permissions are a
  separate dimension resolved from household/relationship grants — never fused into one enum.
- Details and verified caveats: `FINDINGS.md`.
