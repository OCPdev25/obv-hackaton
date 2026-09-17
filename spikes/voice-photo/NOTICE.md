# NOTICE — Voice + Photo Capture Integration Spike

Third-party material adapted or depended on by this spike, with license attribution.

## 1. t3code (pingdotgg/t3code) — adapted shapes (MIT)

- **Upstream:** https://github.com/pingdotgg/t3code
- **License:** MIT — repo `LICENSE` ("Copyright (c) 2026 T3 Tools Inc."), verified via GitHub API in the T3 findings research session (`art_tXjksHOh`).
- **What was adapted:** the `VoiceTranscriber` port shape — error taxonomy codes (`unavailable`, `unsupported-locale`, `preparation-failed`, `transcription-failed`, `cancelled`), the `getLocalVoiceTranscriber(): VoiceTranscriber | null` graceful-degradation pattern, and the `.ios.ts` / `.ts` platform-file split (t3code's `apps/mobile/src/native/voiceTranscription.ios.ts` / `voiceTranscription.ts` and `packages/client-runtime/src/voice-input/transcription.ts`).
- **What was NOT copied:** t3code's pnpm patch of the Apple package, its controller/UI code, and its codebase wholesale.

## 2. @react-native-ai/apple (npm) — runtime dependency (MIT)

- **Upstream:** https://github.com/callstackincubator/ai (published to npm as `@react-native-ai/apple`)
- **Pin:** `0.12.0`
- **License:** MIT (npm registry metadata, verified this session)
- **What is used:** the `AppleTranscription` TurboModule (iOS 26 SpeechAnalyzer/SpeechTranscriber) as a dependency — not modified or vendored by this spike.

Permission is granted by both licenses to copy, modify, and use the material, including commercially, with the sole obligation of retaining the copyright and permission notices in copies or substantial portions — discharged here by this notice. No other third-party code is included in this spike.
