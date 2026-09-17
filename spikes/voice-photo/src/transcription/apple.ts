import { TranscriptionError, withAbort, type AudioPayload, type TranscribeOptions, type TranscriptionResult, type VoiceTranscriber } from './types'

/**
 * Structural mirror of the `@react-native-ai/apple@0.12.0` AppleTranscription
 * surface, verified against the package's own `lib/typescript/NativeAppleTranscription.d.ts`
 * this session:
 *
 *   isAvailable(language: string): boolean
 *   prepare(language: string): Promise<void>
 *   transcribe(data: ArrayBufferLike, language: string): Promise<TranscriptionResult>
 *   TranscriptionResult = { segments: { text, startSecond, endSecond }[], duration: number }
 *
 * Kept structural so unit tests can supply deterministic doubles without the
 * native module (or a device). The live module is bound in `native.ios.ts`.
 */
export interface NativeAppleTranscriptionResult {
  readonly segments: ReadonlyArray<{ readonly text: string; readonly startSecond: number; readonly endSecond: number }>
  readonly duration: number
}

export interface NativeAppleTranscription {
  isAvailable(language: string): boolean
  prepare(language: string): Promise<void>
  transcribe(data: ArrayBufferLike, language: string): Promise<NativeAppleTranscriptionResult>
}

/**
 * Live VoiceTranscriber over the @react-native-ai/apple TurboModule
 * (iOS 26+ SpeechAnalyzer/SpeechTranscriber, RN New Architecture).
 *
 * Error mapping into the port taxonomy: the unpatched package throws opaque
 * native errors (its locale error codes arrive only with t3code's patch, which
 * we deliberately skip for now — see README), so every native rejection is
 * wrapped with `cause` preserved rather than guessed at.
 */
export class AppleVoiceTranscriber implements VoiceTranscriber {
  readonly name = 'apple-speech-analyzer'

  constructor(private readonly native: NativeAppleTranscription) {}

  isAvailable(locale: string): boolean {
    return this.native.isAvailable(locale)
  }

  async prepare(locale: string, options?: TranscribeOptions): Promise<void> {
    if (options?.signal?.aborted) throw new TranscriptionError('cancelled', 'Prepare was cancelled before it started')
    try {
      await withAbort(this.native.prepare(locale), options?.signal)
    } catch (error) {
      if (error instanceof TranscriptionError) throw error // cancelled
      throw new TranscriptionError('preparation-failed', `Preparing SpeechTranscriber for locale "${locale}" failed`, { cause: error })
    }
  }

  async transcribe(audio: AudioPayload, locale: string, options?: TranscribeOptions): Promise<TranscriptionResult> {
    if (options?.signal?.aborted) throw new TranscriptionError('cancelled', 'Transcription was cancelled before it started')
    if (audio.bytes.byteLength === 0) {
      throw new TranscriptionError('transcription-failed', 'Audio payload is empty — nothing to transcribe')
    }
    if (!this.native.isAvailable(locale)) {
      throw new TranscriptionError('unsupported-locale', `SpeechTranscriber is not available for locale "${locale}" on this device`)
    }
    try {
      // Native surface takes a raw ArrayBufferLike; copy views into a
      // standalone buffer so byteOffset windows cannot leak into the bridge.
      const buffer = audio.bytes.slice().buffer
      const nativeResult = await withAbort(this.native.transcribe(buffer, locale), options?.signal)
      return {
        segments: nativeResult.segments.map((segment) => ({
          text: segment.text,
          startSecond: segment.startSecond,
          endSecond: segment.endSecond,
        })),
        durationSeconds: nativeResult.duration,
      }
    } catch (error) {
      if (error instanceof TranscriptionError) throw error // cancelled
      throw new TranscriptionError('transcription-failed', `Transcribing audio for locale "${locale}" failed`, { cause: error })
    }
  }
}
