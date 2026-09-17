/**
 * End-to-end proof against a REAL local Convex dev backend (no cloud).
 *
 * PROVIDER LABELS:
 *   - persistence:  LIVE local Convex backend (real HTTP transport, real
 *     storage). Cloud deployment is NOT exercised (labeled absence).
 *   - extraction:   DETERMINISTIC double in all scenarios (no LLM, no network).
 *   - what this proves: raw-input fidelity across the wire, schema-gated
 *     persistence, captureId idempotency, validation-failure retry without
 *     input loss, and reload persistence via a fresh client.
 */
import { ConvexHttpClient } from "convex/browser"
import { Effect, Schema } from "effect"
import { api } from "../convex/_generated/api.js"
import { CaptureId, Entry, TimelineRow, type EntryWire, type TimelineRow as TimelineRowType } from "../src/domain/schema.js"
import { idleCaptureState } from "../src/domain/captureState.js"
import { CaptureRepositoryService, ExtractionService } from "../src/domain/services.js"
import { runCaptureFlow } from "../src/engine/interpreter.js"
import { makeDeterministicExtraction } from "../src/services/extraction.js"
import { makeConvexRepository } from "../src/services/repository.js"
import { fixtureCaregivers, fixtureChild } from "../src/services/fixtures.js"

const main = async (): Promise<void> => {

const url = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"
let passed = 0
let failed = 0

const check = (name: string, condition: boolean, detail?: string) => {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

const runFlow = (initial: Parameters<typeof runCaptureFlow>[0], messages: Parameters<typeof runCaptureFlow>[1], extraction = makeDeterministicExtraction()) =>
  Effect.runPromise(
    runCaptureFlow(initial, messages, { onStateChange: () => {} }).pipe(
      Effect.provideService(ExtractionService, extraction),
      Effect.provideService(CaptureRepositoryService, makeConvexRepository(url)),
    ),
  )

const timelineFor = async (client: ConvexHttpClient, childId: string): Promise<TimelineRowType[]> => {
  const rows = await client.query(api.events.timelineForChild, { childId })
  return rows.map((row) => Schema.decodeUnknownSync(TimelineRow)(row))
}

// ---------------------------------------------------------------------------
console.log(`e2e: local Convex backend at ${url}`)
console.log("(persistence: LIVE local backend — extraction: DETERMINISTIC double — cloud/LLM: NOT exercised)")

const setupClient = new ConvexHttpClient(url)
const ids = await setupClient.mutation(api.captures.ensureFixtures, {
  childKey: fixtureChild.childId,
  childName: fixtureChild.name,
  caregivers: fixtureCaregivers.map((c) => ({ caregiverKey: c.caregiverId, name: c.name })),
})
check("fixtures ensured (child + caregivers upserted, ids are stable keys)", ids.childId === fixtureChild.childId && ids.caregiverIds.length === 2)

// --- Scenario A: happy path -------------------------------------------------
const rawA = "milestone:  Ada said her first word — mama!   "
const captureA = Schema.decodeSync(CaptureId)(`cap-e2e-a-${Date.now()}`)
console.log(`\nScenario A — publish ${captureA}`)
const reviewA = await runFlow(idleCaptureState, [
  { type: "captureStarted", captureId: captureA, authorId: fixtureCaregivers[0]!.caregiverId, childId: fixtureChild.childId },
  { type: "textEntered", transcript: rawA },
  // Extraction completes and the machine parks at the review gate; the
  // caregiver's publish confirmation is a SEPARATE interaction (a second run),
  // mirroring the app: the interpreter never auto-publishes.
])
check("capture parks at review before publishing", reviewA.status === "review", `status=${reviewA.status}`)
const finalA = await runFlow(reviewA, [{ type: "publishRequested" }])
check("flow reached published", finalA.status === "published", `status=${finalA.status}`)

// Fresh client == simulated app reload; reads back from the local backend.
const freshA = new ConvexHttpClient(url)
const rowsA = (await timelineFor(freshA, fixtureChild.childId)).filter((row) => row.captureId === captureA)
check("row appears after a fresh-client reload", rowsA.length === 1)
check("raw transcript survived the wire BYTE-IDENTICAL", rowsA[0]?.transcript === rawA, JSON.stringify(rowsA[0]?.transcript))
check("event decoded with category + caregiver name", rowsA[0]?.events[0]?.category === "milestone" && rowsA[0]?.authorName === fixtureCaregivers[0]!.name)
check("timestamp decoded as Date", rowsA[0]?.events[0]?.occurredAt instanceof Date)

// --- Scenario B: validation failure + retry, no input loss, no duplicate ----
const rawB = "sleep:  bedtime resistance at 19:45, down by 20:10   "
const captureB = Schema.decodeSync(CaptureId)(`cap-e2e-b-${Date.now()}`)
console.log(`\nScenario B — validation failure then retry ${captureB}`)
const failedB = await runFlow(idleCaptureState, [
  { type: "captureStarted", captureId: captureB, authorId: fixtureCaregivers[1]!.caregiverId, childId: fixtureChild.childId },
  { type: "textEntered", transcript: rawB },
], makeDeterministicExtraction(["invalid", "classify"]))
check("first attempt lands in validationFailed", failedB.status === "validationFailed", `status=${failedB.status}`)
check("raw transcript PRESERVED in the failure state", failedB.status === "validationFailed" && failedB.transcript === rawB)

// Retry WITHOUT re-entering text, then confirm at the review gate — two
// separate interactions, exactly as the app sequences them.
const reviewedB = await runFlow(failedB, [{ type: "retryRequested" }])
check("retry lands at review with the preserved transcript", reviewedB.status === "review", `status=${reviewedB.status}`)
const publishedB = await runFlow(reviewedB, [{ type: "publishRequested" }])
check("publish after retry reaches published", publishedB.status === "published", `status=${publishedB.status}`)

const freshB = new ConvexHttpClient(url)
const rowsB = (await timelineFor(freshB, fixtureChild.childId)).filter((row) => row.captureId === captureB)
check("exactly ONE row after the retried publish (idempotent, no duplicate entry)", rowsB.length === 1)
check("retried row keeps the raw transcript byte-identical", rowsB[0]?.transcript === rawB)
check("retried row decoded with category sleep + second caregiver", rowsB[0]?.events[0]?.category === "sleep" && rowsB[0]?.authorName === fixtureCaregivers[1]!.name)

// --- Scenario C: server-side idempotency + domain-gated rejection -----------
console.log("\nScenario C — server-side idempotency and domain-authority rejection")
const wireA: EntryWire = Schema.encodeSync(Entry)({
  _tag: "Entry",
  captureId: captureA,
  childId: fixtureChild.childId,
  transcript: rawA,
  authorId: fixtureCaregivers[0]!.caregiverId,
  createdAt: new Date(),
  status: "published",
  events: [
    { _tag: "Event", category: "milestone", occurredAt: new Date(), confidence: 1, authorId: fixtureCaregivers[0]!.caregiverId, note: "Ada said her first word — mama!" },
  ],
})
const replay = await freshA.mutation(api.captures.publishCapture, { ...wireA, events: [...wireA.events] })
check("re-publishing the same captureId returns duplicate:true", replay.duplicate === true)
check("re-publish returns the SAME record id (no second row)", replay.recordId === (finalA.status === "published" ? finalA.recordId : ""))
const rowsAfterReplay = (await timelineFor(freshA, fixtureChild.childId)).filter((row) => row.captureId === captureA)
check("timeline still holds exactly one row for that captureId", rowsAfterReplay.length === 1)

const badWire = { ...wireA, captureId: Schema.decodeSync(CaptureId)(`cap-e2e-bad-${Date.now()}`), events: [{ ...wireA.events[0], confidence: 1.5 }] }
let rejected = "not rejected"
try {
  await freshA.mutation(api.captures.publishCapture, badWire)
} catch (error) {
  rejected = error instanceof Error ? error.message : String(error)
}
check("server rejects confidence outside [0,1] via the Effect Schema (domain authority)", rejected.toLowerCase().includes("confidence"), rejected.slice(0, 140))
const rowsAfterBad = (await timelineFor(freshA, fixtureChild.childId)).filter((row) => row.captureId === badWire.captureId)
check("rejected payload stored NOTHING", rowsAfterBad.length === 0)

console.log(`\nRESULT: ${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1

};

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})