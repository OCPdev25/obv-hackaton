import type { PhotoStorageTransport } from '@journal/spike-voice-photo/src/photo/photoStorage'

/**
 * Real Convex transport for the 3-request photo upload flow, speaking the
 * documented Convex HTTP API (docs.convex.dev/http-api) over plain `fetch`:
 *
 *   step 1  POST {deploymentUrl}/api/mutation  path=photoStorage:generatePhotoUploadUrl
 *   step 2  POST the bytes to the returned upload URL
 *   step 3  POST {deploymentUrl}/api/mutation  path=photoStorage:commitPhotoCapture
 *
 * The photoStorage functions live in the spike's reference module
 * (spikes/voice-photo/convex/photoStorage.ts); they are NOT deployed to the
 * dev deployment yet, so step 1/3 failures are an expected, honestly-reported
 * evidence outcome until that module is ported into backend/convex.
 *
 * Plain fetch instead of ConvexHttpClient because the module is not codegenned
 * (no typed api object exists) and RN ships fetch natively; responses are
 * narrowed with explicit guards, never `any`.
 */

export interface ConvexMutationSuccess<T> {
  readonly status: 'success'
  readonly value: T
}

export interface ConvexMutationFailure {
  readonly status: 'error'
  readonly errorMessage: string
}

export type ConvexMutationResponse<T> = ConvexMutationSuccess<T> | ConvexMutationFailure

export function isConvexMutationFailure<T>(response: ConvexMutationResponse<T>): response is ConvexMutationFailure {
  return response.status !== 'success'
}

/** The subset of the reference module's commit result the harness consumes. */
export interface CommitPhotoCaptureResult {
  readonly photoId: string
  readonly entryId: string | null
}

export function createConvexPhotoTransport(deploymentUrl: string): PhotoStorageTransport {
  const mutationUrl = `${deploymentUrl.replace(/\/+$/, '')}/api/mutation`

  const runMutation = async <T>(path: string, args: Record<string, unknown>): Promise<T> => {
    const response = await fetch(mutationUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, args, format: 'json' }),
    })
    if (!response.ok) {
      throw new Error(`Convex HTTP mutation ${path} failed with HTTP ${response.status}`)
    }
    const payload = (await response.json()) as ConvexMutationResponse<T>
    if (isConvexMutationFailure(payload)) {
      throw new Error(`Convex HTTP mutation ${path} returned error: ${payload.errorMessage}`)
    }
    return payload.value
  }

  return {
    async requestUploadUrl() {
      // Reference module: generatePhotoUploadUrl(mutation, args: {}) -> string
      const uploadUrl = await runMutation<string>('photoStorage:generatePhotoUploadUrl', {})
      if (typeof uploadUrl !== 'string' || uploadUrl.length === 0) {
        throw new Error('Convex HTTP mutation photoStorage:generatePhotoUploadUrl returned a non-string upload URL')
      }
      return uploadUrl
    },

    async uploadPhoto(uploadUrl, photo) {
      // Step 2 is a raw POST of the bytes with their Content-Type; the response
      // body is JSON `{ storageId }` (docs.convex.dev/file-storage/upload-files).
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': photo.mimeType },
        // ArrayBuffer body: accepted by RN networking, Expo's winter fetch,
        // and the Convex upload endpoint alike. `slice()` guarantees the
        // buffer is exactly the payload (bytes may be a view).
        body: photo.bytes.slice().buffer,
      })
      if (!response.ok) {
        throw new Error(`photo upload POST failed with HTTP ${response.status}`)
      }
      const payload = (await response.json()) as { storageId?: unknown }
      if (typeof payload.storageId !== 'string' || payload.storageId.length === 0) {
        throw new Error('photo upload POST returned a response without a storageId string')
      }
      return { storageId: payload.storageId }
    },

    async commitPhoto(commit) {
      // Reference module: commitPhotoCapture(mutation, { storageId, mimeType,
      // sizeBytes, entry? }) -> { photoId, entryId }
      const result = await runMutation<CommitPhotoCaptureResult>('photoStorage:commitPhotoCapture', {
        storageId: commit.storageId,
        mimeType: commit.mimeType,
        sizeBytes: commit.sizeBytes,
        ...(commit.entry === undefined ? {} : { entry: commit.entry }),
      })
      // The harness always commits a captioned capture, so a null entryId
      // would mean the server behaved unexpectedly — fail loudly rather than
      // widening the port's `entryId: string` contract.
      if (typeof result.entryId !== 'string') {
        throw new Error('photoStorage:commitPhotoCapture returned no entryId for a captioned capture')
      }
      return { entryId: result.entryId }
    },
  }
}
