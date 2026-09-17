import { setAudioModeAsync, type AudioRecorder } from 'expo-audio'
import { File } from 'expo-file-system'
import { launchImageLibraryAsync } from 'expo-image-picker'

import { getLocalVoiceTranscriber } from '@journal/spike-voice-photo/src/transcription/native'
import {
  TranscriptionError,
  transcribeToText,
} from '@journal/spike-voice-photo/src/transcription/types'
import {
  storePhotoCapture,
  type PhotoStorageTransport,
} from '@journal/spike-voice-photo/src/photo/photoStorage'
import {
  PhotoCaptureError,
  type PickedPhoto,
} from '@journal/spike-voice-photo/src/photo/types'

import { CONVEX_URL_ENV_KEY } from '../lib/convex'
import type { EvidenceClass, EvidenceLog } from './evidence'
import { describeError } from './evidence'
import { createFakePhotoTransport } from './fakeTransport'
import { createConvexPhotoTransport } from './convexTransport'

/**
 * The six DeviceProof checks (a)-(f) from the PR #8 device-proof checklist.
 * Every check is fail-safe by construction: it catches its own errors and
 * turns them into evidence rows — a missing adapter, an unavailable locale or
 * a refused permission degrades to `hardware-only-blocked` / `fail` rows,
 * never a crash.
 */

/** Checklist item 2: the TurboModule global the @react-native-ai/apple pod registers. */
export const TURBO_MODULE_GLOBAL = '__apple__llm__transcribe__'

/** Checklist item 7: the locale matrix plus one deliberately bogus locale. */
export const PROOF_LOCALES: readonly string[] = ['en-US', 'en-GB', 'es-MX', 'es-US', 'fr-FR', 'de-DE']
export const BOGUS_LOCALE = 'zz-QQ'

/** Checklist item 8: recording length and payload mime for HIGH_QUALITY (m4a container). */
export const RECORDING_MS = 5000
export const RECORDING_MIME_TYPE = 'audio/mp4'

/** Synthetic capture data — invented child, invented note; nothing real. */
export const SYNTHETIC_AUTHOR_ID = 'qa-device-proof-user'
export const SYNTHETIC_TRANSCRIPT = 'Milo ate oatmeal at 8am'

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * (a) Probe the `__apple__llm__transcribe__` TurboModule global. Checklist
 * item 2. Absence outside an iOS dev-client build is the expected, honest
 * result — the registration proof itself stays hardware-only.
 */
export function checkTurboModuleProbe(log: EvidenceLog): void {
  const present = TURBO_MODULE_GLOBAL in globalThis
  log({
    label: 'a) TurboModule probe — global __apple__llm__transcribe__',
    status: present ? 'pass' : 'info',
    evidenceClass: 'simulator',
    detail: present
      ? 'TurboModule global IS present — a dev-client build with the AppleLLM pod registered it.'
      : 'TurboModule global is absent — expected outside an iOS dev-client build (Expo Go, Android/web, or a container). Registration proof stays hardware-only until that build (checklist item 2).',
  })
}

/**
 * (b) `isAvailable(locale)` matrix over six real locales plus one deliberately
 * bogus locale to capture the failure path. Checklist item 7.
 */
export function checkLocaleMatrix(log: EvidenceLog): void {
  const transcriber = getLocalVoiceTranscriber()
  if (transcriber === null) {
    log({
      label: `b) isAvailable(locale) matrix over ${PROOF_LOCALES.length}+1 locales`,
      status: 'skipped',
      evidenceClass: 'hardware-only-blocked',
      detail:
        'getLocalVoiceTranscriber() returned null in this build — the graceful-degradation path works (no crash); the matrix itself needs the iOS dev-client build.',
    })
    return
  }
  for (const locale of [...PROOF_LOCALES, BOGUS_LOCALE]) {
    const suffix = locale === BOGUS_LOCALE ? ' (deliberately bogus — failure path)' : ''
    try {
      const available = transcriber.isAvailable(locale)
      log({
        label: `b) isAvailable(${locale})${suffix}`,
        status: locale === BOGUS_LOCALE ? (available ? 'fail' : 'pass') : available ? 'pass' : 'info',
        evidenceClass: 'simulator',
        detail: available
          ? `transcriber "${transcriber.name}" reports ${locale} available`
          : `transcriber "${transcriber.name}" reports ${locale} NOT available on this device/build`,
      })
    } catch (error) {
      log({
        label: `b) isAvailable(${locale})${suffix}`,
        status: 'fail',
        evidenceClass: 'simulator',
        detail: `isAvailable threw: ${describeError(error)}`,
      })
    }
  }
}

/**
 * (c) `prepare('en-US')` with every rejection mapped into the spike's error
 * taxonomy (unavailable | unsupported-locale | preparation-failed |
 * transcription-failed | cancelled). Checklist item 6.
 */
export async function checkPrepare(log: EvidenceLog): Promise<void> {
  const transcriber = getLocalVoiceTranscriber()
  if (transcriber === null) {
    log({
      label: "c) prepare('en-US')",
      status: 'skipped',
      evidenceClass: 'hardware-only-blocked',
      detail: 'No adapter bound in this build — prepare runs only where the native module exists.',
    })
    return
  }
  try {
    await transcriber.prepare('en-US')
    log({
      label: "c) prepare('en-US')",
      status: 'pass',
      evidenceClass: 'simulator',
      detail: 'On-device model assets ready — prepare resolved without error.',
    })
  } catch (error) {
    const code = error instanceof TranscriptionError ? error.code : 'unmapped-native-error'
    log({
      label: "c) prepare('en-US')",
      status: 'fail',
      evidenceClass: 'simulator',
      detail: `taxonomy code: ${code} (taxonomy: unavailable | unsupported-locale | preparation-failed | transcription-failed | cancelled) — ${describeError(error)}`,
    })
  }
}

/**
 * (d) expo-audio `HIGH_QUALITY` recording (~5s) with URI / byte size / mime
 * evidence, then record-then-transcribe through the spike adapter's
 * `transcribeToText`. Checklist item 8 (recording path) and part of 1/6.
 * Unavailable adapter and isAvailable=false degrade to honest blocked rows.
 */
export async function checkRecordAndTranscribe(recorder: AudioRecorder, log: EvidenceLog): Promise<void> {
  let bytes: Uint8Array
  try {
    await setAudioModeAsync({ allowsRecording: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
    await delay(RECORDING_MS)
    await recorder.stop()
    const uri = recorder.uri
    if (uri === null) {
      log({
        label: `d) expo-audio record (~${RECORDING_MS / 1000}s, HIGH_QUALITY)`,
        status: 'fail',
        evidenceClass: 'simulator',
        detail: 'recorder.uri was null after stop() — no file produced.',
      })
      return
    }
    bytes = new Uint8Array(await new File(uri).arrayBuffer())
    log({
      label: `d) expo-audio record (~${RECORDING_MS / 1000}s, HIGH_QUALITY)`,
      status: 'pass',
      evidenceClass: 'simulator',
      detail: `uri=${uri} · bytes=${bytes.byteLength} · mimeType=${RECORDING_MIME_TYPE} (HIGH_QUALITY writes the m4a container)`,
    })
  } catch (error) {
    log({
      label: `d) expo-audio record (~${RECORDING_MS / 1000}s, HIGH_QUALITY)`,
      status: 'fail',
      evidenceClass: 'simulator',
      detail: `Recording failed (permission, hardware, or mode error): ${describeError(error)}`,
    })
    return
  } finally {
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined)
  }

  const transcriber = getLocalVoiceTranscriber()
  if (transcriber === null) {
    log({
      label: 'd) transcribe recording via spike adapter (transcribeToText)',
      status: 'skipped',
      evidenceClass: 'hardware-only-blocked',
      detail: 'No adapter bound in this build — recording evidence above stands; transcription needs the iOS dev-client build.',
    })
    return
  }
  if (!transcriber.isAvailable('en-US')) {
    log({
      label: 'd) transcribe recording via spike adapter (transcribeToText)',
      status: 'skipped',
      evidenceClass: 'hardware-only-blocked',
      detail: "isAvailable('en-US') is false on this device — SpeechAnalyzer needs an Apple Intelligence-capable device; no transcription attempted, no crash.",
    })
    return
  }
  try {
    const text = await transcribeToText(transcriber, { bytes, mimeType: RECORDING_MIME_TYPE }, 'en-US')
    log({
      label: 'd) transcribe recording via spike adapter (transcribeToText)',
      status: 'pass',
      evidenceClass: 'simulator',
      detail: `transcribeToText -> "${text}" (${text.length} chars)`,
    })
  } catch (error) {
    const code = error instanceof TranscriptionError ? error.code : 'unmapped-native-error'
    log({
      label: 'd) transcribe recording via spike adapter (transcribeToText)',
      status: 'fail',
      evidenceClass: 'simulator',
      detail: `taxonomy code: ${code} — ${describeError(error)}`,
    })
  }
}

/**
 * (e) expo-image-picker photo pick with size and type evidence. Checklist
 * item 4 (photo permission prompt fires on this call). Returns the picked
 * photo for check (f) to reuse, or null when canceled/failed.
 */
export async function checkPhotoPick(log: EvidenceLog): Promise<PickedPhoto | null> {
  let asset: { readonly uri: string; readonly fileSize?: number; readonly mimeType?: string }
  try {
    const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 })
    if (result.canceled) {
      log({
        label: 'e) expo-image-picker photo pick',
        status: 'info',
        evidenceClass: 'simulator',
        detail: 'Picker canceled by the user — graceful path, no crash.',
      })
      return null
    }
    const picked = result.assets[0]
    if (picked === undefined || picked.uri === null || picked.uri === undefined || picked.uri === '') {
      log({
        label: 'e) expo-image-picker photo pick',
        status: 'fail',
        evidenceClass: 'simulator',
        detail: 'Picker returned no usable asset (missing uri).',
      })
      return null
    }
    asset = { uri: picked.uri, fileSize: picked.fileSize, mimeType: picked.mimeType }
  } catch (error) {
    log({
      label: 'e) expo-image-picker photo pick',
      status: 'fail',
      evidenceClass: 'simulator',
      detail: `Picker failed (permission or launcher error): ${describeError(error)}`,
    })
    return null
  }

  try {
    const bytes = new Uint8Array(await new File(asset.uri).arrayBuffer())
    log({
      label: 'e) expo-image-picker photo pick',
      status: 'pass',
      evidenceClass: 'simulator',
      detail: `size=${bytes.byteLength} bytes (asset.fileSize=${asset.fileSize === undefined ? 'n/a' : String(asset.fileSize)}) · type=${asset.mimeType ?? 'unknown'}`,
    })
    return { bytes, mimeType: asset.mimeType ?? 'application/octet-stream', sizeBytes: bytes.byteLength }
  } catch (error) {
    log({
      label: 'e) expo-image-picker photo pick',
      status: 'fail',
      evidenceClass: 'simulator',
      detail: `Reading picked bytes failed: ${describeError(error)}`,
    })
    return null
  }
}

/**
 * Deterministic synthetic photo used when check (f) runs without a pick: a
 * 1024-byte fixed pattern, labeled honestly as application/octet-stream (no
 * fake image magic bytes).
 */
export function syntheticPhoto(): PickedPhoto {
  const bytes = new Uint8Array(1024)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (index * 7 + 3) % 256
  }
  return { bytes, mimeType: 'application/octet-stream', sizeBytes: bytes.byteLength }
}

/**
 * Wraps a transport so each of the three requests logs its own evidence row,
 * all carrying the same transport label. The upload URL is truncated to avoid
 * printing a (short-lived, but still) signed token on screen.
 */
function createLoggingTransport(
  inner: PhotoStorageTransport,
  evidenceClass: EvidenceClass,
  log: EvidenceLog,
): PhotoStorageTransport {
  const run = async <T>(step: string, action: () => Promise<T>, summarize: (value: T) => string): Promise<T> => {
    try {
      const value = await action()
      log({ label: `f) ${step}`, status: 'pass', evidenceClass, detail: summarize(value) })
      return value
    } catch (error) {
      log({ label: `f) ${step}`, status: 'fail', evidenceClass, detail: describeError(error) })
      throw error
    }
  }
  return {
    requestUploadUrl: () =>
      run('step 1/3 request upload URL (photoStorage:generatePhotoUploadUrl)', () => inner.requestUploadUrl(), (url) => `upload URL issued: ${url.slice(0, 28)}…`),
    uploadPhoto: (uploadUrl, photo) =>
      run('step 2/3 POST photo bytes to upload URL', () => inner.uploadPhoto(uploadUrl, photo), (result) => `storageId: ${result.storageId}`),
    commitPhoto: (commit) =>
      run('step 3/3 commit capture record (photoStorage:commitPhotoCapture)', () => inner.commitPhoto(commit), (result) => `entryId: ${result.entryId ?? 'none (photo-only capture)'}`),
  }
}

/**
 * (f) The spike's Convex 3-request photo upload flow through
 * `storePhotoCapture`. Uses the REAL dev deployment only when
 * EXPO_PUBLIC_CONVEX_URL is set; otherwise a deterministic in-memory fake.
 * Every row is labeled with which transport produced it. Checklist item 9.
 */
export async function checkConvexUpload(picked: PickedPhoto | null, log: EvidenceLog): Promise<void> {
  const envUrl = process.env[CONVEX_URL_ENV_KEY]?.trim()
  const useRealTransport = envUrl !== undefined && envUrl !== ''
  const evidenceClass: EvidenceClass = useRealTransport ? 'simulator' : 'fake'
  const transportLabel = useRealTransport ? 'real dev deployment (EXPO_PUBLIC_CONVEX_URL set)' : 'fake in-memory transport (EXPO_PUBLIC_CONVEX_URL unset)'

  log({
    label: 'f) Convex 3-request photo upload — transport selected',
    status: 'info',
    evidenceClass,
    detail: `transport=${transportLabel} · photo=${picked === null ? 'synthetic 1024-byte deterministic pattern (application/octet-stream)' : 'picked photo from check (e)'}`,
  })

  const transport = useRealTransport ? createConvexPhotoTransport(envUrl) : createFakePhotoTransport()
  try {
    const result = await storePhotoCapture(
      createLoggingTransport(transport, evidenceClass, log),
      {
        photo: picked ?? syntheticPhoto(),
        authorId: SYNTHETIC_AUTHOR_ID,
        transcript: SYNTHETIC_TRANSCRIPT,
        status: 'draft',
        events: [],
      },
    )
    log({
      label: 'f) Convex 3-request photo upload — flow result',
      status: 'pass',
      evidenceClass,
      detail: `storePhotoCapture ok · storageId=${result.storageId} · entryId=${result.entryId ?? 'none'} · transcript="${result.transcript ?? ''}" (synthetic)`,
    })
  } catch (error) {
    const code = error instanceof PhotoCaptureError ? error.code : 'unknown'
    const hint = useRealTransport
      ? ' Note: the dev deployment has no photoStorage module deployed yet (the reference module is spike-local), so step 1/3 errors are expected until it is ported into backend/convex.'
      : ''
    log({
      label: 'f) Convex 3-request photo upload — flow result',
      status: 'fail',
      evidenceClass,
      detail: `PhotoCaptureError code=${code} — ${describeError(error)}.${hint}`,
    })
  }
}
