import { TranscriptionError, type AudioPayload, type TranscribeOptions, type TranscriptionErrorCode, type TranscriptionResult, type VoiceTranscriber } from './types'

/**
 * Deterministic, device-free VoiceTranscriber for unit tests and demos.
 * No randomness, no timers: every behavior is configured up front and every
 * call is recorded for assertions.
 */
export interface FakeVoiceTranscriberConfig {
  /** Default true. `false` makes `isAvailable` false for every locale. */
  readonly available?: boolean
  /** Locales the fake reports as supported. Default: ['en-US']. */
  readonly supportedLocales?: readonly string[]
  /** Segment texts returned by `transcribe`, in order. */
  readonly segmentTexts?: readonly string[]
  /** Report `durationSeconds` as this value (default: number of segments). */
  readonly durationSeconds?: number
}

export class FakeVoiceTranscriber implements VoiceTranscriber {
  readonly name = 'fake'

  readonly prepareCalls: readonly string[]
  readonly transcribeCalls: readonly Readonly<{ audio: AudioPayload; locale: string }>[]

  private readonly config: {
    available: boolean
    supportedLocales: readonly string[]
    segmentTexts: readonly string[]
    durationSeconds: number | null
  }
  private readonly prepareCalls_: string[] = []
  private readonly transcribeCalls_: { audio: AudioPayload; locale: string }[] = []
  private nextFailure: TranscriptionErrorCode | null = null
  private nextFailureLocation: 'prepare' | 'transcribe' = 'transcribe'

  constructor(config: FakeVoiceTranscriberConfig = {}) {
    this.config = {
      available: config.available ?? true,
      supportedLocales: config.supportedLocales ?? ['en-US'],
      segmentTexts: config.segmentTexts ?? ['Hello from the fake transcriber.'],
      durationSeconds: config.durationSeconds ?? null,
    }
    this.prepareCalls = this.prepareCalls_
    this.transcribeCalls = this.transcribeCalls_
  }

  /** Script the next failure; cleared after it fires once. */
  failNextWith(code: TranscriptionErrorCode, location: 'prepare' | 'transcribe' = 'transcribe'): this {
    this.nextFailure = code
    this.nextFailureLocation = location
    return this
  }

  isAvailable(locale: string): boolean {
    return this.config.available && this.config.supportedLocales.includes(locale)
  }

  async prepare(locale: string, options?: TranscribeOptions): Promise<void> {
    if (options?.signal?.aborted) throw cancelled(options.signal)
    this.prepareCalls_.push(locale)
    if (this.nextFailure !== null && this.nextFailureLocation === 'prepare') {
      throw new TranscriptionError(this.takeNextFailure(), `Fake prepare failure for locale "${locale}"`)
    }
  }

  async transcribe(audio: AudioPayload, locale: string, options?: TranscribeOptions): Promise<TranscriptionResult> {
    if (options?.signal?.aborted) throw cancelled(options.signal)
    this.transcribeCalls_.push({ audio, locale })
    if (this.nextFailure !== null && this.nextFailureLocation === 'transcribe') {
      throw new TranscriptionError(this.takeNextFailure(), `Fake transcribe failure for locale "${locale}"`)
    }
    if (!this.config.available) {
      throw new TranscriptionError('unavailable', 'Fake transcriber is configured unavailable')
    }
    if (!this.config.supportedLocales.includes(locale)) {
      throw new TranscriptionError('unsupported-locale', `Fake transcriber does not support locale "${locale}"`)
    }
    const segments = this.config.segmentTexts.map((text, index) => ({
      text,
      startSecond: index,
      endSecond: index + 1,
    }))
    return {
      segments,
      durationSeconds: this.config.durationSeconds ?? segments.length,
    }
  }

  private takeNextFailure(): TranscriptionErrorCode {
    const code = this.nextFailure
    if (code === null) throw new Error('FakeVoiceTranscriber: scripted failure vanished')
    this.nextFailure = null
    return code
  }
}

function cancelled(signal: AbortSignal): TranscriptionError {
  return new TranscriptionError('cancelled', 'Transcription was cancelled', { cause: signal.reason })
}
