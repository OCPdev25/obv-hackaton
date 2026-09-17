import { decodeEntry, encodeEntry, type Entry, type EntryWire, type Event } from '../contract/schema'
import { PhotoCaptureError, type PickedPhoto } from './types'

/**
 * Photo -> Convex file storage flow, per docs.convex.dev/file-storage/upload-files
 * (fetched this session):
 *
 *   1. a mutation calls `ctx.storage.generateUploadUrl()` -> short-lived upload URL
 *   2. the client POSTs the file to that URL -> response JSON `{ storageId }`
 *   3. a commit mutation persists the storageId (+ contract-shaped Entry)
 *
 * The transport is injected so the whole flow is unit-testable without a
 * Convex deployment or a device. The reference server module lives in
 * `convex/photoStorage.ts`.
 */
export interface PhotoStorageTransport {
  /** Step 1: ask the backend for a short-lived upload URL. */
  requestUploadUrl(): Promise<string>
  /** Step 2: POST the photo bytes to the upload URL; resolve the storageId. */
  uploadPhoto(uploadUrl: string, photo: PickedPhoto): Promise<{ storageId: string }>
  /** Step 3: persist the capture record (storageId + optional contract Entry). */
  commitPhoto(commit: PhotoCaptureCommit): Promise<{ entryId: string }>
}

export interface PhotoCaptureCommit {
  readonly storageId: string
  readonly mimeType: string
  readonly sizeBytes: number
  /**
   * Contract-shaped Entry in WIRE form (createdAt as unix-ms number), already
   * encoded through the published schema. Photo-only captures omit it — the
   * v0.1 contract has no photo field, so the photo<->Entry linkage is a
   * proposed v0.2 extension (see README), not a silent schema change.
   */
  readonly entry?: EntryWire
}

export interface CapturePhotoInput {
  readonly photo: PickedPhoto
  readonly authorId: string
  /** Caption or dictated note. Required when the capture should carry an Entry. */
  readonly transcript?: string
  readonly status?: 'draft' | 'published'
  /** Extracted events to publish with the Entry (may be empty). */
  readonly events?: readonly Event[]
}

export interface PhotoCaptureResult {
  readonly storageId: string
  readonly entryId: string | null
  readonly transcript: string | null
}

export async function storePhotoCapture(
  transport: PhotoStorageTransport,
  input: CapturePhotoInput,
): Promise<PhotoCaptureResult> {
  const entry = buildEntryPayload(input)
  const entryWire = entry === null ? undefined : encodeEntry(entry)

  let uploadUrl: string
  try {
    uploadUrl = await transport.requestUploadUrl()
  } catch (error) {
    throw new PhotoCaptureError('upload-failed', 'Requesting a Convex upload URL failed', { cause: error })
  }

  let storageId: string
  try {
    ({ storageId } = await transport.uploadPhoto(uploadUrl, input.photo))
  } catch (error) {
    throw new PhotoCaptureError('upload-failed', 'Uploading photo bytes to Convex storage failed', { cause: error })
  }

  try {
    const { entryId } = await transport.commitPhoto({
      storageId,
      mimeType: input.photo.mimeType,
      sizeBytes: input.photo.sizeBytes,
      ...(entryWire === undefined ? {} : { entry: entryWire }),
    })
    return { storageId, entryId, transcript: entry?.transcript ?? null }
  } catch (error) {
    throw new PhotoCaptureError('commit-failed', 'Committing the photo capture to Convex failed', { cause: error })
  }
}

/**
 * Build a domain Entry for a captioned photo capture. Returns null for
 * photo-only captures. Enforces the contract's NonEmptyString `transcript`
 * up front — an invalid Entry never reaches the transport.
 */
export function buildEntryPayload(
  input: Pick<CapturePhotoInput, 'transcript' | 'authorId' | 'status' | 'events'> & { readonly capturedAt?: Date },
): Entry | null {
  if (input.transcript === undefined) return null
  const transcript = input.transcript.trim()
  if (transcript.length === 0) {
    throw new PhotoCaptureError(
      'empty-transcript',
      'A captioned photo capture needs a non-empty transcript (contract: Entry.transcript is NonEmptyString)',
    )
  }
  const entry = {
    _tag: 'Entry' as const,
    transcript,
    authorId: input.authorId,
    createdAt: input.capturedAt ?? new Date(),
    status: input.status ?? ('draft' as const),
    events: input.events ?? [],
  }
  // Round-trip through the published schema: construction must satisfy the
  // contract before anything downstream trusts it.
  return decodeEntry(encodeEntry(entry))
}
