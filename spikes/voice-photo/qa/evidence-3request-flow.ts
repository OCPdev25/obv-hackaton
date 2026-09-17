/**
 * PR #8 checklist item 9 — 3-request Convex photo upload flow, REAL backend
 * evidence driver.
 *
 * Runs the spike's REAL client flow (`src/photo/photoStorage.ts`) with a real
 * fetch transport against a real Convex server (local-real dev backend started
 * with `npx convex dev --dir=.../qa-convex`, or any dev deployment URL handed
 * in as argv[2]). Verifies byte-integrity by reading the file back through
 * `getPhotoUrl` and comparing SHA-256. Probes the entry-carrying commit path
 * as a negative control (PR #5 finding F1: Convex rejects _-prefixed stored
 * fields). Synthetic data only.
 *
 * Usage: bun spikes/voice-photo/qa/evidence-3request-flow.ts <CONVEX_URL>
 */
import { createHash } from "node:crypto"

import { storePhotoCapture, type PhotoStorageTransport } from "../src/photo/photoStorage"

const deploymentUrl = process.argv[2] ?? process.env.CONVEX_URL
if (deploymentUrl === undefined || deploymentUrl === "") {
  console.error("usage: bun evidence-3request-flow.ts <CONVEX_URL>")
  process.exit(2)
}

interface Step {
  step: string
  detail: string
  ok: boolean
}

const steps: Step[] = []
function record(step: string, detail: string, ok: boolean): void {
  steps.push({ step, detail, ok })
  console.log(`[${ok ? "ok" : "FAIL"}] ${step}: ${detail}`)
}

async function callConvex(fnPath: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${deploymentUrl}/api/${fnPath.startsWith("photoStorage:") ? "mutation" : "query"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: fnPath, args, format: "json" }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  const body = (await response.json()) as { status?: string; errorMessage?: string; value?: unknown }
  if (body.errorMessage !== undefined) throw new Error(`backend error: ${body.errorMessage}`)
  return body.value
}

// A real (tiny) PNG — 1x1 transparent pixel, base64-decoded. Synthetic data.
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
const photoBytes = new Uint8Array(Buffer.from(PNG_1X1_BASE64, "base64"))
const expectedSha256 = createHash("sha256").update(photoBytes).digest("hex")
record("fixture", `synthetic 1x1 PNG, ${photoBytes.byteLength} bytes, sha256=${expectedSha256}`, true)

const transport: PhotoStorageTransport = {
  async requestUploadUrl() {
    const value = await callConvex("photoStorage:generatePhotoUploadUrl", {})
    if (typeof value !== "string") throw new Error(`expected URL string, got ${JSON.stringify(value)}`)
    record("1-requestUploadUrl", `upload URL issued: ${value.slice(0, 72)}...`, true)
    return value
  },
  async uploadPhoto(uploadUrl) {
    const blob = new Blob([photoBytes], { type: "image/png" })
    const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob })
    if (!response.ok) throw new Error(`photo POST -> HTTP ${response.status}: ${await response.text()}`)
    const body = (await response.json()) as { storageId?: unknown }
    if (typeof body.storageId !== "string") throw new Error(`expected { storageId }, got ${JSON.stringify(body)}`)
    record("2-uploadPhoto", `POST ok, storageId=${body.storageId}`, true)
    return { storageId: body.storageId }
  },
  async commitPhoto(commit) {
    const value = (await callConvex("photoStorage:commitPhotoCapture", {
      storageId: commit.storageId,
      mimeType: commit.mimeType,
      sizeBytes: commit.sizeBytes,
    })) as { photoId?: unknown; entryId?: unknown }
    record("3-commitPhoto", `committed photoId=${String(value?.photoId)} entryId=${String(value?.entryId)} (photo-only path)`, true)
    return { entryId: typeof value?.entryId === "string" ? value.entryId : "" }
  },
}

try {
  const result = await storePhotoCapture(transport, {
    photo: { bytes: photoBytes, mimeType: "image/png", sizeBytes: photoBytes.byteLength },
    authorId: "qa-synthetic-author",
  })
  record("flow", `storePhotoCapture completed: storageId=${result.storageId}`, true)

  // Byte-integrity read-back.
  const photoUrl = (await callConvex("photoStorage:getPhotoUrl", { storageId: result.storageId })) as unknown
  if (typeof photoUrl !== "string") throw new Error(`getPhotoUrl returned ${JSON.stringify(photoUrl)}`)
  const readBack = new Uint8Array(await (await fetch(photoUrl)).arrayBuffer())
  const readBackSha256 = createHash("sha256").update(readBack).digest("hex")
  record(
    "readback",
    `fetched ${readBack.byteLength} bytes back; sha256 match=${readBackSha256 === expectedSha256} (${readBackSha256})`,
    readBackSha256 === expectedSha256,
  )

  // Negative control: the entry-carrying commit path (F1 probe).
  try {
    const entryResult = (await callConvex("photoStorage:commitPhotoCapture", {
      storageId: result.storageId,
      mimeType: "image/png",
      sizeBytes: photoBytes.byteLength,
      entry: {
        _tag: "Entry",
        transcript: "qa synthetic entry",
        authorId: "qa-synthetic-author",
        createdAt: Date.now(),
        status: "draft",
        events: [],
      },
    })) as unknown
    record("f1-probe-entry-commit", `entry commit SUCCEEDED: ${JSON.stringify(entryResult)} — F1 does not reproduce here (refines PR #5 F1 scope)`, true)
  } catch (error) {
    record("f1-probe-entry-commit", `entry commit REJECTED (as F1 predicts): ${String(error)}`, true)
  }
} catch (error) {
  record("flow", String(error), false)
  process.exitCode = 1
}

const allOk = steps.every((s) => s.ok)
console.log(`\nSUMMARY: ${steps.filter((s) => s.ok).length}/${steps.length} steps ok -> ${allOk ? "EVIDENCE GREEN" : "EVIDENCE FAILED"}`)
if (!allOk) process.exitCode = 1
