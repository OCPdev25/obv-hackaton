/**
 * Photo capture port. The live picker is expo-image-picker
 * (`launchImageLibraryAsync` → asset.uri → bytes via expo-file-system);
 * the port is injected so the storage flow is testable without a device.
 */
export interface PickedPhoto {
  /** Raw image bytes, read from the picked asset. */
  readonly bytes: Uint8Array
  /** MIME type for the Convex upload (e.g. 'image/jpeg'). */
  readonly mimeType: string
  /** Byte length, kept alongside bytes for the capture record. */
  readonly sizeBytes: number
}

export interface PhotoPicker {
  /** Resolve the picked photo, or null when the user cancels. */
  pick(): Promise<PickedPhoto | null>
}

export class PhotoCaptureError extends Error {
  readonly code: 'empty-transcript' | 'upload-failed' | 'commit-failed'

  constructor(code: 'empty-transcript' | 'upload-failed' | 'commit-failed', message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PhotoCaptureError'
    this.code = code
  }
}
