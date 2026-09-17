import { AppleVoiceTranscriber, type NativeAppleTranscription } from './apple'
import type { VoiceTranscriber } from './types'

/**
 * iOS implementation of the transcriber factory. Metro resolves this file for
 * `import ... from './native'` in iOS builds (platform extension `.ios.ts`),
 * mirroring t3code's `voiceTranscription.ios.ts` / `voiceTranscription.ts` split.
 *
 * The @react-native-ai/apple module calls `TurboModuleRegistry.getEnforcing`
 * at import time, which throws when the native module is absent (Expo Go, or a
 * dev client built without the pod). That failure surfaces here as `null` —
 * callers hide the dictation UI, per the graceful-degradation pattern.
 */
export function getLocalVoiceTranscriber(): VoiceTranscriber | null {
  try {
    const mod = require('@react-native-ai/apple') as { AppleTranscription: NativeAppleTranscription }
    return new AppleVoiceTranscriber(mod.AppleTranscription)
  } catch {
    return null
  }
}
