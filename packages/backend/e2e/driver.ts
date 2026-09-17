/**
 * LOCAL-REAL end-to-end proof against `convex-local-backend` (local dev mode).
 *
 * Story (the brief, in order):
 *   1. a caregiver enters synthetic text
 *   2. raw input is retained UNCHANGED
 *   3. a schema-validated event is persisted
 *   4. it renders in a child timeline AFTER RELOAD
 *   + publish retry with the SAME captureId does not duplicate the entry
 *
 * Labels: persistence below is LOCAL-REAL (a real Convex backend process with
 * SQLite storage on 127.0.0.1:3210, push+codegen via `convex dev`); extraction
 * is the DETERMINISTIC rule-based service (no LLM, no cloud); nothing here is
 * a deployed or cloud deployment.
 */
import { ConvexHttpClient } from "convex/browser"
import { Effect, Result } from "effect"

import { makeDeterministicExtractor } from "@journal/capture"
import type { CaptureId } from "@journal/domain"
import { decodeEntryResult, encodeEntry, fixtureCaregiverAna, fixtureChild } from "@journal/domain"
import { api } from "../convex/_generated/api.js"

const url = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"
const label = (tag: string, text: string) => console.log(`[${tag}] ${text}`)

// -- 1. caregiver enters synthetic text --------------------------------------
const RAW = "Mila used the potty today. She napped for 90 minutes."
label("capture", `raw input: "${RAW}" (${RAW.length} chars)`)

const captureId = "capture_e2e_001" as CaptureId
const ana = fixtureCaregiverAna.caregiverId
const childId = fixtureChild.childId

// -- 2+3. extraction through the validation boundary (deterministic service) --
const extractor = makeDeterministicExtractor()
const events = await Effect.runPromise(
  Effect.orDie(extractor.extract({ captureId, childId, authorId: ana, transcript: RAW })),
)
label("extract", `deterministic extractor produced ${events.length} schema-valid event(s)`)
for (const event of events) {
  label("extract", `  category=${event.category} note="${event.note}" quantity=${JSON.stringify(event.quantity ?? null)}`)
}

// -- publish through the REAL Convex layer (local backend) --------------------
const client = new ConvexHttpClient(url)
const wireEntry = encodeEntry({
  _tag: "Entry",
  captureId,
  childId,
  transcript: RAW,
  authorId: ana,
  createdAt: new Date(),
  status: "draft",
  events: [...events],
})
// Convex mutation args come from v.array() validators (mutable arrays), the
// wire type is readonly, and the storage shape omits the reserved `_tag` —
// the function restores the constant discriminator on read.
const { _tag: _omitted, ...storeArgs } = { ...wireEntry, events: [...wireEntry.events] }

const firstPublish = await client.mutation(api.entries.publishEntry, storeArgs)
const first = decodeEntryResult(firstPublish)
if (Result.isFailure(first)) throw new Error(`publish decode failed: ${String(first.failure)}`)
const entryId1 = first.success.entryId
if (entryId1 === undefined) throw new Error("stored entry has no id")
label("persist", `publish #1 stored entry ${entryId1} (LOCAL-REAL Convex at ${url})`)

// -- retry with the SAME captureId must not duplicate -------------------------
const retryPublish = await client.mutation(api.entries.publishEntry, storeArgs)
const retry = decodeEntryResult(retryPublish)
if (Result.isFailure(retry)) throw new Error(`retry decode failed: ${String(retry.failure)}`)
const entryId2 = retry.success.entryId
label("persist", `publish #2 (retry, same captureId) returned ${entryId2}`)

if (entryId2 !== entryId1) {
  console.error(`IDEMPOTENCY BROKEN: ${entryId1} !== ${entryId2}`)
  process.exit(1)
}

// -- 4. reload: a FRESH client reads the child timeline ------------------------
const reloaded = new ConvexHttpClient(url)
const wireRows = await reloaded.query(api.entries.timelineForChild, { childId })
label("reload", `timeline read returned ${wireRows.length} row(s) after reload`)

const rows = []
for (const row of wireRows) {
  const decoded = decodeEntryResult(row)
  if (Result.isFailure(decoded)) throw new Error(`timeline row failed schema validation: ${String(decoded.failure)}`)
  rows.push(decoded.success)
}

const found = rows.find((row) => row.captureId === captureId)
if (found === undefined) {
  console.error("TIMELINE MISSING: published entry not found after reload")
  process.exit(1)
}

const rawMatches = found.transcript === RAW
label("reload", `transcript verbatim after reload: ${rawMatches ? "YES" : "NO"} (${found.transcript.length} chars)`)
label("reload", `event categories in timeline: [${found.events.map((e) => e.category).join(", ")}]`)
label("reload", `first event occurredAt decodes to Date: ${found.events[0]?.occurredAt instanceof Date}`)

const pass = rawMatches && rows.length === 1 && entryId2 === entryId1
console.log(pass ? "E2E PASS (local-real persistence, deterministic extraction)" : "E2E FAIL")
process.exit(pass ? 0 : 1)
