## Evidence receipt — flow recording

| Field | Value |
| --- | --- |
| PR | _(this PR — self-demonstration)_ |
| Tested head SHA | `8de8cfadfad0c2a9633d1ccee5c2a7e706dcec4b` |
| Review result | pending review — _(merge-owner field)_ |
| Checks | _(merge-owner field: all CI checks green on this SHA required before merge)_ |
| Merge commit | _(merge-owner field)_ |
| Post-merge smoke | _(merge-owner field: pnpm typecheck && pnpm test && pnpm build on the merge commit)_ |
| Unlocked tasks | _(merge-owner field)_ |

### Recording — Capture → inspect → correct → save (failure/recovery) → reopen → handoff

- **Platform / driver**: `browser` · qa/record.ts (playwright chromium 153.0.8010.12)
- **Run**: 2026-09-17T20-17-03-146Z-capture-flow · captured 2026-09-17T20:17:05.503Z · branch `HEAD` · clean worktree
- **Environment**: node=v24.3.0 · bun=1.3.14 · browser=chromium 153.0.8010.12 (headless shell) · viewport=1440x900 · adapter=evaluation/src/example/example-adapter.ts (in-memory, corpus known-good) · backend=in-memory — reopen = adapter.reload() cold-start equivalence · servedFrom=http://127.0.0.1:38477
- **Fixture seed**: evaluation/fixtures [multi-event-narrative, malformed-extraction, retry-double-submit, raw-fidelity, reload-persistence] · capturedAt=1789563600000 · America/New_York · author=caregiver-1
- **Data policy**: Synthetic family data only (fictional child 'Ava', synthetic caregiver-1) — no real persons, no credentials.
- **Session recording**: `tc-flow-session.webm` (recording)

| Step | Proves | Result | Assertions | Assets |
| --- | --- | --- | --- | --- |
| `tc-1` capture | Capture preserves the raw transcript byte-for-byte and issues a resilient captureId | ✅ 4/4 | ✓ createEntry resolved Created — state=created<br>✓ captureId assigned (resilient capture identity) — cap-demo-001<br>✓ raw transcript preserved byte-for-byte (SHA-256, computed in page)<br>✓ raw fidelity verdict visible in UI — input  sha256 87e8cd1ceec7f8d2…   stored sha256 87e8cd1ceec7f8d2…   ✓ byte-for-byte preserved | `tc-1-capture-form.png` (before) · `tc-1-capture.png` (result) |
| `tc-2` inspect | Inspect shows extracted typed events with resolved instants from the corpus fixture | ✅ 4/4 | ✓ event count matches fixture (3) — 3<br>✓ categories in transcript order [meal, potty, mood] — meal,potty,mood<br>✓ occurredAt resolved to fixture-expected instants (relative-time + timezone) — 1789560000000,1789565400000,1789577100000 vs 1789560000000,1789565400000,1789577100000<br>✓ confidences finite within [0,1] | `tc-2-inspect.png` (result) |
| `tc-3` correct | Correct: malformed capture is stored raw with zero events (captured_with_event_errors); corrected capture succeeds | ✅ 6/6 | ✓ malformed capture persisted (extraction failure never blocks capture) — state=created<br>✓ zero schema-valid events extracted — 0<br>✓ captured_with_event_errors badge shown<br>✓ raw preserved byte-for-byte through validation failure (control chars intact)<br>✓ corrected capture created — state=created<br>✓ corrected capture extracted exactly one potty event — potty | `tc-3-correct-before.png` (error) · `tc-3-correct-after.png` (result) |
| `tc-4` save-failure-recovery | Save: backend failure surfaces an error state without persisting; retry recovers; double-submit is an idempotent replay | ✅ 6/6 | ✓ simulated backend failure surfaced as visible error state — Simulated backend failure — qa fail-save injection<br>✓ failed save did not persist (timeline unchanged) — 3 → 3<br>✓ retry persisted the entry (recovery) — state=created<br>✓ double-submit resolved IdempotentReplay (original wins) — state=idempotent-replay<br>✓ no second entry persisted after replay — 4 → 4<br>✓ captureIds in timeline unique — 4/4 | `tc-4-save-error.png` (error) · `tc-4-save-recovered.png` (result) |
| `tc-5` reopen | Reopen: cold-start reload re-reads the durable timeline — nothing lost, duplicated, or mutated; transcripts byte-identical | ✅ 4/4 | ✓ timeline re-read after simulated cold start — state=reloaded<br>✓ no entries lost across reload — 6 → 6<br>✓ all transcripts byte-identical after reload (SHA-256, incl. unicode/control-char raw) — 5/5 matched<br>✓ no duplicated captures after reload — 6/6 | `tc-5-reopen.png` (result) |
| `tc-6` handoff | Handoff: invited caregiver reads the attributed timeline; unrelated viewer is fail-closed denied | ✅ 4/4 | ✓ invited caregiver authorized — timeline visible — authorized=true count=6 (expected 6)<br>✓ author attribution visible in timeline row — cap-demo-001 · draft · by caregiver-1 · 3 event(s) · 2026-09-16T13:00:00.000Z"Ava had 8 ou<br>✓ unrelated viewer fail-closed: nothing rendered — authorized=false count=0<br>✓ denial message visible | `tc-6-handoff-authorized.png` (result) · `tc-6-handoff-denied.png` (error) |

> Platform: browser (headless Chromium). Native (iOS) recording pending — Apple worker adapter contract: qa/README.md.

> Adapter: the evaluation corpus's worked example (in-memory, known-good). Master's product UI is an arena-held candidate lineage, so this recording evidences the flow PROTOCOL + harness; the same tooling records the product UI when it lands (point --scenario steps at the app URL).

### Native (Apple worker adapter)

Status: **pending** — native (iOS) recording is owned by the Apple worker adapter. The contract it fulfills is documented in `qa/README.md` § "Native adapter contract" (same `FlowManifest` shape with `platform: "native"`, stable `tc-N` ids, HEAD-bound evidence, synthetic data policy). Native manifests merge into this receipt with:

```bash
cd qa && bun src/receipt.ts --manifest=evidence/<browser-run>/manifest.json --manifest=<native-run>/manifest.json --pr=<PR URL> --out=combined-receipt.md
```

### Reproduce

```bash
cd qa && bun install && bun run record --scenario=capture-flow
```

Manifest of record: `evidence/2026-09-17T20-17-03-146Z-capture-flow/manifest.json` (validated shape, HEAD-bound). Structural check: `bun src/validate.ts evidence/2026-09-17T20-17-03-146Z-capture-flow/manifest.json`.
