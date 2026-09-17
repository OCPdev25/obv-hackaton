# Design rationale — Candidate A

## The one load-bearing decision

**Effect Schema is the domain authority; Convex validators are a derived
transport adapter.** `src/domain/schema.ts` is executable — Event, Entry, ids,
state, message, and command unions are all schemas; TS types are inferred; every
external input is decoded at its boundary (UI text input, Convex handler args,
server responses, query rows). The Convex `v.*` validators exist only for the
transport envelope; `publishCapture` re-decodes the payload through the Effect
schema and rejects domain violations (confidence outside [0,1], empty
transcripts) with a ConvexError before touching storage — the part `v.number()`
cannot express.

## State machine

`Idle → Recording → Transcribed → Extracting → Review → Publishing → Published`,
plus `ValidationFailed` and `PersistFailed`. Pure `(state, message) →
[state, commands]` in `src/domain/captureState.ts`; every state/message/command
is itself an executable schema (inspectable, round-trippable). Commands are
named and self-contained (`extractEvents{captureId, authorId, transcript}`,
`persistCapture{...entry fields}`) so the interpreter executes them without
re-reading state, and `update` never mints timestamps (purity).

## Retry without loss

Failures are data: extraction/persistence failures land in
`ValidationFailed`/`PersistFailed` with the raw transcript (and events) still in
state. `retryRequested` re-runs the named command from the PRESERVED data under
the SAME `captureId`. Idempotency is enforced server-side too: `publishCapture`
checks `captureId` first and returns the original record with `duplicate: true`,
so even a client-side double-submit stores exactly one entry.

## Effects behind service interfaces

`ExtractionService` and `CaptureRepositoryService` are Effect `Context.Service`
keys with NO default (a missing service fails loudly at the boundary).
`Context.Reference` was rejected deliberately: on effect@4.0.0-rc.115 a
Reference's Identifier is `never`, which makes `provideService`'s
`Exclude<R, I>` removal a type-level no-op — the R channel never narrowed and
every composition root leaked requirements. `Context.Service<Shape>("key")`
carries the interface as the Identifier, so providing genuinely removes it
(verified with a compile-time probe: `Effect<…, never, never>` after two
`provideService` calls). `makeConvexRepository` (live
local backend) and `makeInMemoryRepository` (controlled double mirroring the
server idempotency contract) share one interface; `makeDeterministicExtraction`
supports scripted attempt plans (`["invalid", "classify"]`) to reproduce
failure-then-retry deterministically. Same binary, swapped providers.

## Rejected alternatives

1. **Convex validators as the source of truth** — rejected: they cannot express
   Date materialization, branded ids, or range constraints; duplicating the
   domain in two validation layers invites drift. Effect-first keeps one
   authority and treats Convex as storage.
2. **Confect (Effect-typed Convex)** — rejected: peer-depends on Effect 3.x,
   incompatible with the mandated Effect v4 line; also hides the boundary the
   task asks to demonstrate.
3. **Normalized tables (entries + separate events table)** — rejected for this
   slice: entries are append-only journal records with their reviewed events as
   an embedded array; normalization adds cross-table transactionality without a
   consumer. The storage schema stays open to normalizing later without domain
   changes (the adapter direction is schema → validators).
4. **Live LLM extraction in the loop** — rejected: nondeterministic, keyed, and
   network-dependent; the brief requires deterministic reproducibility. The
   service interface leaves the seat open (a live implementation only needs to
   return `ExtractionOutcome`).
5. **Reducer with effectful `Date.now()` inside `update`** — rejected: purity of
   the update function is load-bearing for replay; `createdAt` is minted in the
   interpreter at persist time.

## Fixtures, not limits

One child (Ada) and two caregivers (Maya, Noah) are fixtures in
`src/services/fixtures.ts`; no schema anywhere caps the number of children,
caregivers, entries, or events.
