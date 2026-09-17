# Voice + Photo Capture Integration Spike

Integration spike from the T3 dictation findings (`art_tXjksHOh`): **record-then-transcribe** on iOS 26 via `@react-native-ai/apple` (SpeechAnalyzer/SpeechTranscriber TurboModule) and **photo capture persisted to Convex file storage**, validated against the published Effect v4 schema contract (`art_I2TCG08V`).

**What is proven here:** the pinned dependency set installs coherently, the wrappers typecheck in strict mode against the real package types, and the transcriber + storage flows pass 38 device-free unit tests.

**What is NOT proven here (device gap):** anything that needs an iOS 26 device, a custom dev-client build, or a live Convex deployment — see the [Device-proof checklist](#device-proof-checklist-what-cannot-be-verified-in-sandbox). No device evidence is claimed.

## Layout

```
spikes/voice-photo/
├── src/contract/schema.ts        # SPIKE-LOCAL MOCK of the published contract (swap for packages/domain)
├── src/transcription/
│   ├── types.ts                  # VoiceTranscriber port, error taxonomy, abort helpers
│   ├── apple.ts                  # AppleVoiceTranscriber (injects the native module)
│   ├── native.ios.ts             # iOS binding (Metro platform extension)
│   ├── native.ts                 # Android/web: null (graceful degradation)
│   └── fake.ts                   # FakeVoiceTranscriber (deterministic)
├── src/photo/
│   ├── types.ts                  # PickedPhoto, PhotoPicker port, PhotoCaptureError
│   └── photoStorage.ts           # 3-request Convex upload flow (transport injected)
├── convex/photoStorage.ts        # REFERENCE server module (contract-mapped validators)
└── test/                         # 38 device-free unit tests (vitest, node env)
```

## Pinned dependency set (exact versions)

All versions retrieved from npm this session. The Expo SDK 57 line comes from the `sdk-57` dist-tags; `react-native 0.86.3` from the `0.86-stable` tag (the same line t3code ships on).

| Package | Pin | Why this pin |
|---|---|---|
| `@react-native-ai/apple` | `0.12.0` | The verified MIT TurboModule from the T3 findings; peer `react-native >= 0.76.0` satisfied |
| `expo` | `57.0.23` | npm `sdk-57` dist-tag |
| `expo-audio` | `57.0.5` | npm `sdk-57` dist-tag |
| `expo-file-system` | `57.0.7` | npm `sdk-57` dist-tag; `File.arrayBuffer()` reads recording/photo bytes |
| `expo-image-picker` | `57.0.18` | npm `sdk-57` dist-tag |
| `react-native` | `0.86.3` | npm `0.86-stable`; New Architecture (required by the TurboModule) |
| `react` | `19.2.3` | `react-native@0.86.3` peer (`^19.2.3`) |
| `effect` | `4.0.0-rc.115` | The contract's verified pin (`art_I2TCG08V`) |
| `convex` | `1.46.0` | npm latest; validators in the reference module |
| `typescript` | `5.9.3` | Mature 5.x line (npm latest is 7.0.2; the spike stays conservative) |
| `vitest` | `4.1.11` | Last line whose engines accept Node ^20 (vitest 5 needs Node ^22.12+) |
| `@types/react` | `19.1.17` | `react-native@0.86.3` peer (`^19.1.1`) |
| `@types/node` | `20.19.43` | Matches the sandbox runtime (Node 20.20.2) |

Verified: `npm install` resolves all peers cleanly (518 packages, no conflicts), `tsc --noEmit` passes in strict mode including the live adapter compiled against the real `@react-native-ai/apple` type surface, and `vitest run` is green.

**Deliberately not adopted:** t3code's 194-line pnpm patch of the Apple package. The findings recommend testing unpatched first; its locale-error codes would surface through the adapter's error wrapping (`cause` preserved) if we need them later.

## API surface correction vs. the T3 findings

The findings described `AppleTranscription.isAvailable()` as a no-arg probe. The actual `@react-native-ai/apple@0.12.0` type surface (read from the package's own `.d.ts` this session) is:

```ts
isAvailable(language: string): boolean                      // sync, per-locale
prepare(language: string): Promise<void>
transcribe(data: ArrayBufferLike, language: string): Promise<{
  segments: { text: string; startSecond: number; endSecond: number }[]
  duration: number
}>
```

The adapter mirrors this surface structurally (`src/transcription/apple.ts`), so tests inject deterministic doubles and the live module binds only in `native.ios.ts`.

## Usage

```ts
import { getLocalVoiceTranscriber } from './transcription/native' // Metro picks .ios.ts on iOS
import { transcribeToText } from './transcription/types'

const transcriber = getLocalVoiceTranscriber()
if (transcriber === null) return // Android/web: hide dictation UI

// record with expo-audio (RecordingPresets.HIGH_QUALITY), then read the file:
const text = await transcribeToText(
  transcriber,
  { bytes: new Uint8Array(await file.arrayBuffer()), mimeType: 'audio/mp4' },
  'en-US',
) // -> insert into the composer; unsupported locales throw { code: 'unsupported-locale' }
```

Photo capture runs the Convex 3-request flow (docs.convex.dev/file-storage/upload-files, fetched this session): mutation returns `ctx.storage.generateUploadUrl()` → client POSTs the bytes (`Content-Type` set) and receives `{ storageId }` → commit mutation persists the storageId plus a contract-shaped Entry. The transport is injected (`src/photo/photoStorage.ts`), so the whole flow is testable without a backend. The reference server module (`convex/photoStorage.ts`) shows the validators mapped one-directionally from the contract.

## Contract alignment (art_I2TCG08V)

- `src/contract/schema.ts` is the **only** place restating the contract — a spike-local mock per the contract's "mock against these shapes / swap the import" rule. When `packages/domain` lands, delete the file and re-point imports.
- Wire conversion goes through the contract's own entry points (`Schema.decodeUnknownSync` / `Schema.encodeSync`); `buildEntryPayload` round-trips every Entry through them before anything downstream trusts it.
- **Not added to the schema:** a photo↔Entry linkage field. The v0.1 contract has no photo field and the spike may not extend it — photo-only captures commit without an Entry. Proposing `Entry.photoCaptures` (or a `photoCaptures.entryId` back-reference) for contract v0.2 is left to the contract thread.
- Convex validators (`convex/photoStorage.ts`) follow the contract's mapping table and never leak into domain code.

## Expo config wiring

Adopt into the app's `app.json`/`app.config.ts` when the monorepo scaffold lands. Plugin props verified from the pinned packages' own plugin sources (the `plugin/` directory in the installed tarballs):

```jsonc
{
  "expo": {
    "plugins": [
      // expo-audio@57.0.5: sets NSMicrophoneUsageDescription (iOS) and RECORD_AUDIO (Android)
      ["expo-audio", {
        "microphonePermission": "Allow Shared Child Journal to access your microphone so you can dictate journal entries."
      }],
      // expo-image-picker@57.0.18: sets NSPhotoLibraryUsageDescription (iOS)
      ["expo-image-picker", {
        "photosPermission": "Allow Shared Child Journal to attach pictures to journal entries."
      }]
    ],
    "ios": {
      "infoPlist": {
        // Declared per the T3 findings' recommendation even though it is
        // UNVERIFIED whether SpeechAnalyzer's on-device transcription triggers
        // this authorization prompt — declaring costs nothing and avoids
        // App Store review surprises.
        "NSSpeechRecognitionUsageDescription": "Shared Child Journal transcribes your dictated entries on-device."
      }
    }
  }
}
```

No config plugin exists for `@react-native-ai/apple` and none is needed (t3code ships none either) — the only wiring is the dev-client build.

## Dev-client build note

**Expo Go will not work.** `@react-native-ai/apple` ships a Swift pod; Expo Go only bundles the fixed SDK module set. Build a custom dev client (`npx expo prebuild` + Xcode, or EAS Build) with RN **New Architecture** enabled (default on RN 0.86), then run `npx expo start --dev-client`. The TurboModule is guarded by `@available(iOS 26, *)` natively; on unsupported devices `getLocalVoiceTranscriber()` still returns a transcriber on iOS but `isAvailable(locale)` reports false — hide the UI on `null` and on unsupported locales.

## Device-proof checklist: what CANNOT be verified in sandbox

This spike makes **no device-evidence claims**. The sandbox has no macOS/Xcode toolchain, no iOS device, and no attached microphone or photo library. Before merging this architecture into the app, verify on hardware:

1. **iOS 26 runtime** — SpeechAnalyzer/SpeechTranscriber behavior on a real Apple Intelligence-capable device (the chip floor for SpeechAnalyzer is not stated in the Apple pages the T3 findings fetched — unverified even there).
2. **Custom dev-client build** — `expo prebuild`/EAS with the `@react-native-ai/apple` pod; TurboModule registration (`__apple__llm__transcribe__` global present at runtime).
3. **Microphone permission prompt** — `NSMicrophoneUsageDescription` dialog on first record (expo-audio plugin wiring is config-only until built).
4. **Photo permission prompt** — `NSPhotoLibraryUsageDescription` dialog on first pick.
5. **Speech recognition authorization** — whether SpeechAnalyzer triggers the `NSSpeechRecognitionUsageDescription` prompt at all (doc-vs-ship conflict flagged in the T3 findings, still unverified).
6. **On-device model assets** — `prepare(locale)` actually downloading/verifying AssetInventory assets; failure mapping to `preparation-failed` under real network conditions.
7. **Locale availability** — which locales `isAvailable(locale)` reports true for on the test device.
8. **Recording hardware path** — expo-audio `HIGH_QUALITY` preset output format, metering, and the byte stream the bridge receives.
9. **Live Convex deployment** — the 3-request upload flow against a real backend (here: client flow + reference module tested against deterministic fakes only; upload URL expiry (1h) and the 2-minute POST timeout are doc numbers, not observed).
10. **Live streaming transcription** — out of scope for this spike (batch only, per the findings' record-then-transcribe MVP); requires native extension work on top of this port.

## Local gates

```sh
npm ci            # install the pinned set
npm run typecheck # tsc --noEmit (strict)
npm test          # vitest run — 38 tests, node env, no device
```

## Attribution

Adapted shapes carry MIT obligations — see [NOTICE.md](./NOTICE.md).
