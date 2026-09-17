import { describe, expect, it } from 'vitest'
import { AppleVoiceTranscriber, type NativeAppleTranscription, type NativeAppleTranscriptionResult } from '../src/transcription/apple'
import { FakeVoiceTranscriber } from '../src/transcription/fake'
import { getLocalVoiceTranscriber } from '../src/transcription/native'
import { TranscriptionError, transcribeToText, type AudioPayload, type VoiceTranscriber } from '../src/transcription/types'

function audioPayload(bytes: number[] = [1, 2, 3]): AudioPayload {
  return { bytes: new Uint8Array(bytes), mimeType: 'audio/mp4' }
}

function nativeDouble(overrides: Partial<NativeAppleTranscription> = {}): NativeAppleTranscription & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isAvailable: (language) => {
      calls.push(`isAvailable:${language}`)
      return language === 'en-US'
    },
    prepare: (language) => {
      calls.push(`prepare:${language}`)
      return Promise.resolve()
    },
    transcribe: (data, language) => {
      calls.push(`transcribe:${language}:${data.byteLength}`)
      return Promise.resolve({
        segments: [
          { text: 'She ate ', startSecond: 0, endSecond: 1 },
          { text: 'lunch.', startSecond: 1, endSecond: 2 },
        ],
        duration: 2,
      })
    },
    ...overrides,
  }
}

function expectTranscriptionError(error: unknown): TranscriptionError {
  expect(error).toBeInstanceOf(TranscriptionError)
  return error as TranscriptionError
}

describe('AppleVoiceTranscriber', () => {
  it('maps native segments and duration into the port result', async () => {
    const native = nativeDouble()
    const transcriber = new AppleVoiceTranscriber(native)
    const result = await transcriber.transcribe(audioPayload(), 'en-US')
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toEqual({ text: 'She ate ', startSecond: 0, endSecond: 1 })
    expect(result.durationSeconds).toBe(2)
  })

  it('forwards the exact byte payload and locale to the native module', async () => {
    const native = nativeDouble()
    const transcriber = new AppleVoiceTranscriber(native)
    const audio = audioPayload([9, 9, 9, 9])
    await transcriber.transcribe(audio, 'en-US')
    expect(native.calls).toEqual(['isAvailable:en-US', 'transcribe:en-US:4'])
    let received: ArrayBufferLike | null = null
    const spy: NativeAppleTranscription = {
      isAvailable: () => true,
      prepare: () => Promise.resolve(),
      transcribe: (data, language) => {
        received = data
        return native.transcribe(data, language)
      },
    }
    await new AppleVoiceTranscriber(spy).transcribe(audio, 'en-US')
    if (!received) throw new Error('bridge did not receive audio data')
    // The bridge receives a standalone ArrayBuffer carrying the same bytes
    // (the adapter copies views out of AudioPayload before the native call).
    expect(received).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(received)).toEqual(audio.bytes)
  })

  it('delegates isAvailable per locale', () => {
    const transcriber = new AppleVoiceTranscriber(nativeDouble())
    expect(transcriber.isAvailable('en-US')).toBe(true)
    expect(transcriber.isAvailable('de-DE')).toBe(false)
  })

  it('wraps native prepare failures as preparation-failed with cause preserved', async () => {
    const native = nativeDouble({ prepare: () => Promise.reject(new Error('asset install failed')) })
    const transcriber = new AppleVoiceTranscriber(native)
    const error = expectTranscriptionError(await transcriber.prepare('en-US').catch((e: unknown) => e))
    expect(error.code).toBe('preparation-failed')
    expect((error.cause as Error).message).toBe('asset install failed')
  })

  it('wraps native transcribe failures as transcription-failed with cause preserved', async () => {
    const native = nativeDouble({ transcribe: () => Promise.reject(new Error('analyzer crashed')) })
    const transcriber = new AppleVoiceTranscriber(native)
    const error = expectTranscriptionError(await transcriber.transcribe(audioPayload(), 'en-US').catch((e: unknown) => e))
    expect(error.code).toBe('transcription-failed')
    expect((error.cause as Error).message).toBe('analyzer crashed')
  })

  it('refuses unsupported locales with unsupported-locale before touching the analyzer', async () => {
    const native = nativeDouble()
    const transcriber = new AppleVoiceTranscriber(native)
    const error = expectTranscriptionError(await transcriber.transcribe(audioPayload(), 'de-DE').catch((e: unknown) => e))
    expect(error.code).toBe('unsupported-locale')
    expect(native.calls).toEqual(['isAvailable:de-DE'])
  })

  it('refuses empty audio payloads without touching the analyzer (cheap guard first)', async () => {
    const native = nativeDouble()
    const transcriber = new AppleVoiceTranscriber(native)
    const error = expectTranscriptionError(await transcriber.transcribe(audioPayload([]), 'en-US').catch((e: unknown) => e))
    expect(error.code).toBe('transcription-failed')
    expect(native.calls).toEqual([])
  })

  it('rejects with cancelled when the signal is already aborted (no native call started)', async () => {
    const native = nativeDouble()
    const transcriber = new AppleVoiceTranscriber(native)
    const controller = new AbortController()
    controller.abort()
    const error = expectTranscriptionError(
      await transcriber.transcribe(audioPayload(), 'en-US', { signal: controller.signal }).catch((e: unknown) => e),
    )
    expect(error.code).toBe('cancelled')
    expect(native.calls).toEqual([])
  })

  it('rejects with cancelled when aborted mid-flight and abandons the native result', async () => {
    let neverResolved = false
    const native = nativeDouble({
      transcribe: () =>
        new Promise<NativeAppleTranscriptionResult>(() => {
          neverResolved = true
        }),
    })
    const transcriber = new AppleVoiceTranscriber(native)
    const controller = new AbortController()
    const pending = transcriber.transcribe(audioPayload(), 'en-US', { signal: controller.signal })
    controller.abort()
    const error = expectTranscriptionError(await pending.catch((e: unknown) => e))
    expect(error.code).toBe('cancelled')
    expect(neverResolved).toBe(true)
  })

  it('joins segment texts into composer text via transcribeToText', async () => {
    const transcriber: VoiceTranscriber = new AppleVoiceTranscriber(nativeDouble())
    await expect(transcribeToText(transcriber, audioPayload(), 'en-US')).resolves.toBe('She ate lunch.')
  })
})

describe('FakeVoiceTranscriber', () => {
  it('returns the scripted segments deterministically and records calls', async () => {
    const fake = new FakeVoiceTranscriber({ segmentTexts: ['Morning ', 'nap.'], durationSeconds: 7 })
    const result = await fake.transcribe(audioPayload(), 'en-US')
    expect(result.segments.map((s) => s.text).join('')).toBe('Morning nap.')
    expect(result.durationSeconds).toBe(7)
    expect(fake.transcribeCalls).toHaveLength(1)
    expect(fake.transcribeCalls[0]?.audio.mimeType).toBe('audio/mp4')
  })

  it('reports configured locales only', () => {
    const fake = new FakeVoiceTranscriber({ supportedLocales: ['en-US', 'es-ES'] })
    expect(fake.isAvailable('es-ES')).toBe(true)
    expect(fake.isAvailable('de-DE')).toBe(false)
  })

  it('throws unavailable when configured unavailable', async () => {
    const fake = new FakeVoiceTranscriber({ available: false })
    expect(fake.isAvailable('en-US')).toBe(false)
    const error = expectTranscriptionError(await fake.transcribe(audioPayload(), 'en-US').catch((e: unknown) => e))
    expect(error.code).toBe('unavailable')
  })

  it('throws unsupported-locale for locales outside its list', async () => {
    const fake = new FakeVoiceTranscriber()
    const error = expectTranscriptionError(await fake.transcribe(audioPayload(), 'fr-FR').catch((e: unknown) => e))
    expect(error.code).toBe('unsupported-locale')
  })

  it('scripts one-shot failures for prepare and transcribe', async () => {
    const fake = new FakeVoiceTranscriber()
    const prepareError = expectTranscriptionError(
      await fake.failNextWith('preparation-failed', 'prepare').prepare('en-US').catch((e: unknown) => e),
    )
    expect(prepareError.code).toBe('preparation-failed')
    await expect(fake.prepare('en-US')).resolves.toBeUndefined()

    const transcribeError = expectTranscriptionError(
      await fake.failNextWith('transcription-failed').transcribe(audioPayload(), 'en-US').catch((e: unknown) => e),
    )
    expect(transcribeError.code).toBe('transcription-failed')
    await expect(fake.transcribe(audioPayload(), 'en-US')).resolves.toBeDefined()
  })

  it('throws cancelled when the signal is already aborted and records nothing', async () => {
    const fake = new FakeVoiceTranscriber()
    const controller = new AbortController()
    controller.abort()
    const error = expectTranscriptionError(
      await fake.transcribe(audioPayload(), 'en-US', { signal: controller.signal }).catch((e: unknown) => e),
    )
    expect(error.code).toBe('cancelled')
    expect(fake.transcribeCalls).toHaveLength(0)
  })
})

describe('getLocalVoiceTranscriber (non-iOS build of ./native)', () => {
  it('returns null so callers hide the dictation UI', () => {
    expect(getLocalVoiceTranscriber()).toBeNull()
  })
})
