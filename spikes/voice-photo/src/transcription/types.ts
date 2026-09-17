/**
 * VoiceTranscriber port + error taxonomy.
 *
 * Shape adapted from t3code's `packages/client-runtime/src/voice-input/transcription.ts`
 * (MIT — see NOTICE.md) per the T3 findings artifact (art_tXjksHOh): error codes
 * `unavailable`, `unsupported-locale`, `preparation-failed`, `transcription-failed`,
 * `cancelled`, with AbortSignal-based cancellation and graceful degradation via
 * `getLocalVoiceTranscriber(): VoiceTranscriber | null`.
 *
 * This is record-then-transcribe: the caller hands over a finished recording's
 * bytes (expo-audio → expo-file-system `File.arrayBuffer()`); live streaming
 * transcription is out of scope for this spike (see README).
 */

export type TranscriptionErrorCode =
  | 'unavailable'
  | 'unsupported-locale'
  | 'preparation-failed'
  | 'transcription-failed'
  | 'cancelled'

export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode

  constructor(code: TranscriptionErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TranscriptionError'
    this.code = code
  }
}

export interface TranscriptionSegment {
  readonly text: string
  readonly startSecond: number
  readonly endSecond: number
}

export interface TranscriptionResult {
  readonly segments: readonly TranscriptionSegment[]
  readonly durationSeconds: number
}

/** Bytes of a finished recording, as read from the expo-audio output file. */
export interface AudioPayload {
  readonly bytes: Uint8Array
  readonly mimeType: string
}

export interface TranscribeOptions {
  readonly signal?: AbortSignal
}

export interface VoiceTranscriber {
  readonly name: string
  /** Synchronous support probe for a locale (device + locale eligibility). */
  isAvailable(locale: string): boolean
  /** Download/verify on-device model assets for the locale (iOS 26 SpeechTranscriber). */
  prepare(locale: string, options?: TranscribeOptions): Promise<void>
  /** Transcribe a finished recording. */
  transcribe(audio: AudioPayload, locale: string, options?: TranscribeOptions): Promise<TranscriptionResult>
}

/** Join segment texts into the string a composer would insert. */
export function joinedTranscriptText(result: TranscriptionResult): string {
  return result.segments
    .map((segment) => segment.text)
    .join('')
    .trim()
}

/**
 * Race a native call against an AbortSignal. The native work itself cannot be
 * cancelled (the module surface has no cancel hook); an abort rejects the
 * caller's promise with `cancelled` and abandons the native result.
 */
export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelledError(signal))
      // The abandoned promise must never surface as an unhandled rejection.
      promise.catch(() => {})
      return
    }
    const onAbort = (): void => {
      reject(cancelledError(signal))
      promise.catch(() => {})
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function cancelledError(signal: AbortSignal): TranscriptionError {
  // `reason` is ES2022 DOM lib; cast keeps the spike typecheck-clean under
  // older lib configs (the app's compile graph pulls this file in).
  return new TranscriptionError('cancelled', 'Transcription was cancelled', { cause: (signal as AbortSignal & { reason?: unknown }).reason })
}

/** Record-then-transcribe convenience: transcribe and join to composer text. */
export async function transcribeToText(
  transcriber: VoiceTranscriber,
  audio: AudioPayload,
  locale: string,
  options?: TranscribeOptions,
): Promise<string> {
  const result = await transcriber.transcribe(audio, locale, options)
  return joinedTranscriptText(result)
}
