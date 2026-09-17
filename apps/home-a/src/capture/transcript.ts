/**
 * Transcription segment — shaped after the PR #8 voice-dictation spike's
 * VoiceTranscriber output (timestamped segments with confidence). The
 * simulated transcriber produces the same shape; the capture pipeline only
 * ever consumes the joined transcript text.
 */
export interface TranscriptSegment {
  readonly text: string
  /** 0..1 transcription confidence from the (simulated) recognizer. */
  readonly confidence: number
}
