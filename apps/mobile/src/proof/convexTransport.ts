import { storePhotoCapture, type PhotoCaptureResult, type PhotoStorageTransport } from "../../../../spikes/voice-photo/src/photo/photoStorage"
import type { PickedPhoto } from "../../../../spikes/voice-photo/src/photo/types"

/**
 * Real Convex HTTP transport for the 3-request photo capture flow, used by the
 * QA proof surface against a real Convex deployment (local-real dev backend or
 * a dev deployment). Wire shapes are the raw /api/mutation protocol, not the
 * convex/react client, so each request is individually observable in evidence.
 *
 * Function paths assume the QA module set in `spikes/voice-photo/qa-convex/`
 * is deployed on the target backend.
 */

/** Raw Convex /api/mutation call; throws on transport, wire, or execution errors. */
async function callMutation(deploymentUrl: string, path: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${deploymentUrl}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  })
  if (!response.ok) {
    throw new Error(`POST /api/mutation ${path} -> HTTP ${response.status}: ${await response.text()}`)
  }
  const body = (await response.json()) as { status?: string; errorMessage?: string; value?: unknown }
  if (body.errorMessage !== undefined) {
    throw new Error(`mutation ${path} failed on the backend: ${body.errorMessage}`)
  }
  return body.value
}

/**
 * The picked asset beyond the port's bytes: RN's fetch uploads files by URI
 * (FormData file descriptor), not raw bytes, so the transport needs the asset
 * identity alongside the PickedPhoto the port carries.
 */
export type PickedPhotoWithAsset = PickedPhoto & {
  readonly assetUri: string
  readonly assetName?: string
}

export function storePhotoCaptureViaConvex(deploymentUrl: string, photo: PickedPhotoWithAsset): Promise<PhotoCaptureResult> {
  const transport: PhotoStorageTransport = {
    async requestUploadUrl() {
      const value = await callMutation(deploymentUrl, "photoStorage:generatePhotoUploadUrl", {})
      if (typeof value !== "string") {
        throw new Error(`generatePhotoUploadUrl returned ${JSON.stringify(value)}, expected an upload URL string`)
      }
      return value
    },
    async uploadPhoto(uploadUrl: string) {
      // RN fetch cannot take a raw Uint8Array body; the documented multipart
      // shape (docs.convex.dev/file-storage/upload-files) works on RN.
      const form = new FormData()
      form.append("file", {
        uri: photo.assetUri,
        name: photo.assetName ?? "photo.jpg",
        type: photo.mimeType,
      } as unknown as Blob)
      const response = await fetch(uploadUrl, { method: "POST", body: form })
      if (!response.ok) {
        throw new Error(`photo POST -> HTTP ${response.status}: ${await response.text()}`)
      }
      const body = (await response.json()) as { storageId?: unknown }
      if (typeof body.storageId !== "string") {
        throw new Error(`photo POST returned ${JSON.stringify(body)}, expected { storageId }`)
      }
      return { storageId: body.storageId }
    },
    async commitPhoto(commit) {
      const value = await callMutation(deploymentUrl, "photoStorage:commitPhotoCapture", {
        storageId: commit.storageId,
        mimeType: commit.mimeType,
        sizeBytes: commit.sizeBytes,
        ...(commit.entry === undefined ? {} : { entry: commit.entry }),
      })
      const entryId = (value as { entryId?: unknown } | null)?.entryId
      return { entryId: typeof entryId === "string" ? entryId : "" }
    },
  }
  return storePhotoCapture(transport, {
    photo,
    // Synthetic QA author — synthetic family data only; no real identities.
    authorId: "qa-synthetic-author",
  })
}
