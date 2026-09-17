import type { PhotoStorageTransport } from '@journal/spike-voice-photo/src/photo/photoStorage'

/**
 * Deterministic in-memory stand-in for the Convex backend: same
 * `PhotoStorageTransport` port as the real transport, zero network, zero
 * randomness. Sequence numbers (padded, monotonic) make every run identical,
 * so evidence rows are reproducible across reviewers.
 */
export function createFakePhotoTransport(): PhotoStorageTransport {
  let uploadUrlCount = 0
  let uploadCount = 0
  let commitCount = 0

  return {
    async requestUploadUrl() {
      uploadUrlCount += 1
      return `fake://upload-url/${String(uploadUrlCount).padStart(3, '0')}`
    },

    async uploadPhoto(uploadUrl, photo) {
      if (!uploadUrl.startsWith('fake://upload-url/')) {
        throw new Error(`fake transport: upload URL from step 1 was not issued by this fake (${uploadUrl})`)
      }
      if (photo.bytes.byteLength === 0) {
        throw new Error('fake transport: refusing to upload an empty payload')
      }
      uploadCount += 1
      return { storageId: `fake-storage-${String(uploadCount).padStart(3, '0')}` }
    },

    async commitPhoto(_commit) {
      commitCount += 1
      return { entryId: `fake-entry-${String(commitCount).padStart(3, '0')}` }
    },
  }
}
