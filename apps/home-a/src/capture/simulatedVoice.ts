/**
 * Simulated voice demo — the scripted replacement for a device transcriber.
 *
 * Real on-device voice (expo-audio + SpeechTranscriber, per the PR #8 spike
 * patterns) needs a device build; in this environment the voice PATH is
 * demonstrated with a scripted transcriber that is shaped exactly like the
 * spike's VoiceTranscriber (available/prepare/transcribe + error codes), so
 * the capture pipeline receives byte-identical transcripts from either path.
 * The evidence doc discloses this fidelity openly.
 */
import type { TranscriptSegment } from "./transcript.js"

export type SimulatedVoiceErrorCode =
  | "unavailable"
  | "unsupported-locale"
  | "preparation-failed"
  | "transcription-failed"
  | "cancelled"

export class SimulatedVoiceError extends Error {
  readonly code: SimulatedVoiceErrorCode
  constructor(code: SimulatedVoiceErrorCode, message: string) {
    super(message)
    this.name = "SimulatedVoiceError"
    this.code = code
  }
}

export interface TranscriptionResult {
  readonly locale: string
  readonly segments: readonly TranscriptSegment[]
}

/** Same contract surface the device transcriber will implement. */
export interface VoiceTranscriberContract {
  readonly name: string
  isAvailable(locale?: string): boolean
  prepare(locale?: string): Promise<void>
  /** Transcribes a scripted utterance into streamable segments. */
  transcribeScripted(text: string, locale?: string): TranscriptionResult
}

const SUPPORTED_LOCALES = ["en-US"]

/**
 * Deterministic scripted transcriber. The full utterance is returned as ONE
 * segment whose text is the exact scripted string — `joinedTranscriptText`
 * then reproduces the utterance byte-for-byte (no lost spaces between
 * clauses). Word-level "streaming" is a display effect the UI layers on top;
 * the pipeline only ever sees the joined transcript.
 */
export function scriptedVoiceTranscriber(): VoiceTranscriberContract {
  return {
    name: "simulated-scripted",
    isAvailable(locale = "en-US"): boolean {
      return SUPPORTED_LOCALES.includes(locale)
    },
    async prepare(locale = "en-US"): Promise<void> {
      if (!SUPPORTED_LOCALES.includes(locale)) {
        throw new SimulatedVoiceError("unsupported-locale", `Locale ${locale} is not scripted`)
      }
    },
    transcribeScripted(text: string, locale = "en-US"): TranscriptionResult {
      const trimmed = text.trim()
      if (!SUPPORTED_LOCALES.includes(locale)) {
        throw new SimulatedVoiceError("unsupported-locale", `Locale ${locale} is not scripted`)
      }
      if (trimmed.length === 0) {
        throw new SimulatedVoiceError("transcription-failed", "Nothing spoken to transcribe")
      }
      // Byte fidelity: one segment holding the exact utterance.
      const segments: TranscriptSegment[] = [{ text: trimmed, confidence: 0.98 }]
      return { locale, segments }
    },
  }
}

/** Spike-shaped helper: join segments back to the transcript the pipeline sees. */
export function joinedTranscriptText(result: TranscriptionResult): string {
  return result.segments.map((segment) => segment.text).join("").trim()
}
