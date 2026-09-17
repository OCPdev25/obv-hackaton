# @journal/capture — arena-integrated capture slice

Deterministic capture pipeline integrating the ARENA vertical-slice result:
candidate D (`8514d1b`) as the structural base, with justified grafts from C
(`6230ecc`), A (`ea5c736`), and B (`15fe84f9`) per the Arena Cross-Review
Receipts (art_KR73IkfH §5).

## Shape

```
src/
  event.ts        capture-surface event/entry schemas (canonical-composed)
  state.ts        capture machine states incl. RawPersistFailed park
  commands.ts     PersistRawDraft / ExtractEvents / AttachEvents / PublishEntry
  update.ts       pure reducer (stale-result guard, failure parking, retry)
  runtime.ts      sequential command execution loop (side effects live here)
  wire.ts         wire codecs derived from Encoded return types
  services/       extraction (deterministic, corpus-tuned) + relative time
  journey/run.ts  15-check CLI contract probe
  loop.test.ts    13 unit/integration tests
```

## Pipeline (raw-first, per candidate C)

1. `CompletedTranscription` → emits `PersistRawDraft` **only** — the durable
   draft exists before any extraction work.
2. `SubmittedForExtraction` → `ExtractEvents` (a separate step, so extraction
   can never overtake raw persistence).
3. Extraction success → draft-with-events at creation (corpus status reading,
   settled decision 1); failure → back to `Transcribed` (raw already durable,
   same captureId re-runs extraction).
4. Storage failures (persist from `Transcribed` or attach/publish from
   `Review`) → **park** in `RawPersistFailed` with the raw transcript retained;
   `RetryPersistRaw` re-issues the idempotent persist.

Relative time + quantity extraction is the unsolved-in-all-candidates problem:
the deterministic double here follows the example adapter's conventions
(`packages/extraction` + the evaluation corpus worked example) — spelled-out
`ounces of` quantities, first-match-per-sentence category rules in the
example-adapter order, DST-safe IANA-zone resolution.

## Verification

```bash
pnpm --filter @journal/capture typecheck
pnpm --filter @journal/capture test          # 13 tests
pnpm --filter @journal/capture journeys      # 15/15 checks
cd ../../evaluation && bun src/run.ts --adapter=./src/integrated-adapter.ts
                                             # 6/6 corpus fixtures
```

`packages/domain` is untouched: the capture package composes the canonical
Effect schemas (`EventFields`, `CaptureId`, `EventSchema`) and adapts to the
canonical entry model (`visibility`, `extractionStatus`, `structuredEventIds`)
via the codecs in `wire.ts`. The backend mirror of the raw-first invariants
lives in `backend/convex` (`entriesInput.ts` + the `rawCaptures` table).
