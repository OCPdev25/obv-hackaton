import type { VoiceTranscriber } from './types'

/**
 * Android/web implementation: voice input is simply absent (t3code's graceful
 * degradation pattern). Metro resolves this file for non-iOS builds; the iOS
 * twin lives in `native.ios.ts`.
 *
 * This is also the file unit tests import — it documents the deterministic
 * behavior every non-iOS runtime must have, with no native module involved.
 */
export function getLocalVoiceTranscriber(): VoiceTranscriber | null {
  return null
}
