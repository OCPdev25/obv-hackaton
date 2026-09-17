# FINDINGS — Effect v4 Compatibility Spike

Date: 2026-09-17 · Branch: `spike/effect-contracts-adapters` · Scope: `spikes/effect-compat/` only

## Pinned versions (exact)

| Package | Version | Note |
| --- | --- | --- |
| `effect` | `4.0.0-rc.115` | the `rc` dist-tag; `latest` still points at 3.22.2 (2026-09-17) |
| `convex` | `1.46.0` | |
| `openai` | `7.17.0` | |
| `vitest` | `5.0.1` | |
| `typescript` | `5.9.3` | strict, `noUncheckedIndexedAccess` |
| `@types/node` | `20.19.43` | |

Bun was used as the package manager/runner (npm hit an Arborist `edgesOut` resolution failure on this sandbox).

## 1. Executable schema → inferred TS types — WORKS

`effect/Schema` in v4 exports everything flat. Proven on the canonical `Entry`/`Event`
schemas (`src/schema.ts`):

- `Schema.TaggedStruct('Event', {...})` — tagged decode shape with `_tag`.
- `Schema.DateFromMillis` — decodes unix-millis numbers to `Date`, encodes back.
- `Schema.optional(S)` vs `Schema.optionalKey(S)` — the former allows present-but-undefined,
  the latter allows the key to be absent. We use `optionalKey` (wire fields disappear).
- `Schema.isBetween(0, 1)` refinement — bounds `confidence`, inclusive of both bounds (verified).
- Types are inferred with `Schema.Schema.Type<typeof SchemaValue>` — no hand-written interfaces.

## 2. JSON Schema derivation — WORKS, one path only (verified with real imports)

- `import 'effect/JSONSchema'` (the v3 module) → **fails**: `ERR_MODULE_NOT_FOUND`. It does not exist in v4.
- `Schema.toJsonSchemaDocument(schema)` → **works**. Returns a `JsonSchema.Document<'draft-2020-12'>`
  (`{ dialect, schema, definitions }`). Derived doc for `Entry` (verified by running it):
  - category → `{ "type": "string", "enum": ["potty","meal","sleep","mood","milestone","school"] }`
  - `DateFromMillis` fields → `{ "type": "integer" }`
  - confidence → `{ "type": "number", "minimum": 0, "maximum": 1 }`
  - root: `type: "object"` with all non-optional keys in `required`
- `Schema.toStandardJSONSchemaV1(Entry)` → **does not yield a JSON Schema document on this pin**:
  it returns the schema itself (no `schema` property to read). Do not use it for derivation here.
- **Caveat:** `Schema.optional(S)` renders as `anyOf: [S, { "type": "null" }]` in the derived
  document — undefined is approximated as null. Fine for LLM function-calling schemas; lossy for
  strict wire validation. Our Convex adapter ignores this by construction (it models absence, not null).

## 3. Effect schema → Convex validators adapter — WORKS with loud gaps

`src/convex-adapter.ts` walks the public `effect/SchemaRepresentation` tree (the introspection
surface; no AST archaeology needed) and emits `convex/values` validators for the **encoded** wire form.

Verified mapping table:

| Effect representation | Convex validator |
| --- | --- |
| `Objects` (struct) | `v.object({...})` |
| `Literal` | `v.literal(value)` |
| `Union` (+ `Undefined` member filtering) | `v.union(...)` / unwrap when single member remains |
| `String` / `Number` / `Boolean` | `v.string()` / `v.number()` / `v.boolean()` |
| `BigInt` | `v.int64()` |
| `Null` | `v.null()` |
| `Arrays` (homogeneous rest) | `v.array(element)` |
| optional property (`optional`/`optionalKey`) | `v.optional(inner)` |
| tuples, index signatures/records | **throws `UnsupportedRepresentationError`** — loud, never silent |

**Convex 1.46 gotcha (bit us):** optionality is a marker string `isOptional: 'required' | 'optional'`
ON the validator itself — there is no separate "optional wrapper" validator kind, and `v.optional(x)`
returns the same kind as `x` with the marker flipped. Truthiness checks on `isOptional` therefore
always pass ('required' is a truthy string) and optional fields silently stay required. Compare
against `=== 'optional'`.

**Round-trip evidence** (test/convex-adapter.test.ts): `Schema.encodeSync(Entry)` →
`convexToJson` → `jsonToConvex` → `compareValues(...) === 0` → `Schema.decodeSync(Entry)` →
`toStrictEqual` deep equality with the original decoded value, including `Date` restoration and
optional-quantity present/absent paths. Note: Effect encodes into readonly structures; Convex's
`Value` type wants mutable ones — `structuredClone` is the documented handoff cast (shapes identical).

Also verified: `convexToJson` rejects `Date` objects (hence encoding first), and undefined-valued
fields are dropped during serialization (so absent optionals survive the wire).

## 4. LLM adapter contract — WORKS (fully mocked)

`src/llm/contract.ts` + `src/llm/openai.ts`:

- Contract: `(request: { captureId, attempt, transcript }) => Effect<ExtractionResult, ExtractionError>`
  where `ExtractionResult = { captureId, attempt, events }` and every event is decoded through the
  canonical `Event` schema — callers never re-validate.
- Typed errors only: `ProviderFailure` (network/quota/missing key), `MalformedModelOutput`
  (non-JSON or wrong envelope), `EventsFailedSchema` (schema-invalid model output, strict fail-fast
  with the failing index).
- OpenAI is behind `OPENAI_API_KEY` (fail-fast at construction); the provider depends on a minimal
  structural `ChatCompletionsClient` so tests inject a fake — no network, no key in tests (verified:
  full suite runs offline).
- **Interruption semantics (contract requirement, per Gil):** client interruption does NOT cancel a
  running server extraction. The action completes server-side; results carry `captureId` +
  monotonically increasing `attempt` so the backend can (1) suppress stale results (only the latest
  attempt per capture applies) and (2) apply idempotently (duplicate `captureId`+`attempt` is a no-op).

## 5. Visibility vs audience — two independent dimensions (per Gil, v0.2)

`Entry.visibility: 'draft' | 'published'` is per-entry publication state ONLY. WHO may see a
published entry (audience) is resolved from household/relationship grants and is deliberately NOT
modeled on the entry — no `status` enum that fuses the two, no `audience` field. Pinned by tests
(`rejects visibility values outside draft|published`, `no audience field`).

## What I did NOT prove / not in scope

- Live OpenAI calls (hackathon key gating is implemented; tests are mocked by design).
- Tuples / index signatures in the adapter (loud failure instead — extend deliberately when needed).
- Actual Convex deployment of the validators (scaffold owner integrates; this spike only proves the mapping).
- `effect/JSONSchema`-style standard-schema interop (`toStandardJSONSchemaV1`) — broken on this pin, see §2.

## Run it

```bash
cd spikes/effect-compat
bun install
bunx tsc --noEmit   # strict typecheck — clean
bunx vitest run     # 37/37 passing (4 files)
```
