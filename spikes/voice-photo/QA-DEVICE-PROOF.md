# QA device-proof status — PR #8 checklist reproduction

Status of the 10-item device-proof checklist from this README, with the
evidence taxonomy the QA brief requires. Updated by the Apple-native QA lane
(thread `th_Kd5oUXW3`, 2026-09-17). Evidence classes: **FAKE-ADAPTER** (the
38 deterministic unit tests), **SIMULATOR** (iOS simulator via the runbook),
**LOCAL-REAL-BACKEND** (real Convex server, local-real deployment, CLI-driven),
**HARDWARE-ONLY** (requires a physical Apple Intelligence-capable device),
**BLOCKED** (no Apple machine reachable at all).

## Blocker (access, concrete)

The Obvious workspace cannot provision an Apple sandbox:
`computers provisionSandbox --platform=macos` returns `FORBIDDEN — macos
sandboxes are not enabled for this workspace` (feature gate), and no Apple
device is paired (`computers listDevices` is empty). Until the gate is lifted
or a Mac is registered over SSH, every SIMULATOR item below is prepared and
replayable but not executed. The runbook (`scripts/qa-ios-sim-proof.sh`) is the
exact reproduction script for the moment an Apple machine exists.

## Verified on Linux against master `32d1f00` (this QA lane)

- **Baseline gates**: `npm ci` (520 packages) clean, `tsc --noEmit` strict
  clean, `vitest run` 38/38 pass — FAKE-ADAPTER evidence still green on the
  current integrated code.
- **Integration gap fixed**: the spike was NOT wired into `apps/mobile` — no
  plugin config, no native deps, no proof surface. This lane adds the wiring
  (isolated branch `qa/ios-sim-proof`): pinned native deps in the app,
  `app.json` plugins + `NSSpeechRecognitionUsageDescription`, the proof screen
  (`apps/mobile/src/proof/`), the QA Convex module set
  (`spikes/voice-photo/qa-convex/`), the real-backend driver
  (`spikes/voice-photo/qa/evidence-3request-flow.ts`), and the macOS runbook.
- **Metro graph validation**: `npx expo export --platform ios` bundles the iOS
  JS graph off-Mac — proves the spike imports resolve through Metro's platform
  extensions and the native deps are wired (the JS half of the dev client).

## Checklist status

| # | Item | Class | Status |
|---|---|---|---|
| 1 | iOS 26 runtime SpeechAnalyzer behavior | HARDWARE-ONLY (chip floor unstated by Apple; simulator run informative but not conclusive) | not executed — blocked |
| 2 | Custom dev-client build + TurboModule global | SIMULATOR (build) — prepared in runbook steps 4-6; JS graph validated on Linux | prepared, not executed — blocked |
| 3 | Microphone permission prompt | SIMULATOR — runbook step 6 with `--fresh` | prepared, not executed — blocked |
| 4 | Photo permission prompt | SIMULATOR — runbook step 6 with `--fresh` | prepared, not executed — blocked |
| 5 | Speech-recognition authorization prompt | SIMULATOR (whether SpeechAnalyzer even triggers it stays doc-vs-ship) | prepared, not executed — blocked |
| 6 | `prepare(locale)` model assets + failure mapping | SIMULATOR | prepared, not executed — blocked |
| 7 | Locale availability matrix | SIMULATOR | prepared, not executed — blocked |
| 8 | Recording hardware path (preset, bytes) | SIMULATOR (byte stream to bridge) | prepared, not executed — blocked |
| 9 | Live Convex 3-request upload flow | **LOCAL-REAL-BACKEND — EXECUTED 2026-09-17, EVIDENCE GREEN 7/7** against an anonymous local-real backend (anonymous-qa-convex): upload URL issued → photo POST accepted (storageId) → commit persisted (photoId), using the spike's real `storePhotoCapture` flow code; read-back SHA-256 matched (`49779094…`), byte integrity through file storage proven | executed — see below |
| 10 | Live streaming transcription | out of spike scope (batch-only MVP) | unchanged — hardware-only |

Item 9 evidence runs from the CLI against a local-real Convex backend
(`npx convex dev --dir=spikes/voice-photo/qa-convex`), synthetic 1×1 PNG,
photo-only commit (the v0.1 contract has no Entry↔photo linkage), read-back
SHA-256 must match. The driver also probes the entry-carrying commit path as
the F1 negative control (PR #5 finding: Convex rejects `_`-prefixed stored
fields) and records the observed behavior either way.

## Honest limits of this lane

- Nothing here claims device or simulator execution of items 1-8 until the
  Apple gate is lifted — the runbook exists precisely so the first Mac (or
  enabled macOS sandbox) reproduces everything with one command.
- The `mediaTypes: ["images"]` picker option, `AudioModule` exports, and the
  `File` API are pinned-package surfaces; the Linux typecheck run against the
  installed `.d.ts` files validates them, but runtime confirmation happens in
  the simulator run.
