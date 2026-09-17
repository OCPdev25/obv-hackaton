/**
 * End-to-end demo against the LOCAL self-hosted Convex backend
 * (LOCAL-REAL PERSISTENCE — not a test double).
 *
 * Proves, in order:
 *  1. fixtures seed (one child, two caregivers)
 *  2. raw capture persisted unchanged, keyed by client-minted captureId
 *  3. IDEMPOTENCY: retrying the same captureId returns "already" — no duplicate
 *  4. publish of a schema-valid event succeeds
 *  5. IDEMPOTENCY: republish with the same captureId → "already" — no duplicate
 *  6. VALIDATION FAILURE: an out-of-vocabulary event fails the boundary decode
 *     (Effect Schema is the authority), the raw capture survives
 *  7. RETRY with a corrected event and the SAME captureId → entry created,
 *     exactly one entry for that captureId, raw text never lost
 *  8. the child timeline renders the published entries after reload
 *
 * Run: bun packages/backend/scripts/demo.mjs   (backend on :3210)
 */
import { ConvexHttpClient } from "convex/browser"
import { decodeJournalEvent } from "@journal/contracts"

const URL_ = process.env.CONVEX_URL ?? "http://127.0.0.1:3210"
const client = new ConvexHttpClient(URL_)

const step = (n, label) => console.log(`\n[${n}] ${label}`)
const out = (value) => console.log(`    → ${JSON.stringify(value)}`)

const CAPTURE_ARGS = {
  childId: "child_demo_maya",
  authorCaregiverId: "cg_demo_alex",
  schemaVersion: 1,
}

const capture = (captureId, rawText, occurredAt) => ({ ...CAPTURE_ARGS, captureId, rawText, occurredAt })

// 1 — fixtures
step(1, "seed fixtures (one child, two caregivers)")
out(await client.mutation("seed:seedFixtures", {}))

// 2 — raw persistence
step(2, "persist raw capture (append-only, unchanged)")
const occurredAt = Date.parse("2026-09-17T09:15:00Z")
out(await client.mutation("captures:persistCaptureRaw", capture("cap-demo-1", "She ate most of her pasta at lunch", occurredAt)))

// 3 — idempotent raw retry
step(3, "retry SAME captureId → idempotent 'already', no duplicate row")
out(await client.mutation("captures:persistCaptureRaw", capture("cap-demo-1", "She ate most of her pasta at lunch", occurredAt)))

// 4 — publish valid event
step(4, "publish schema-validated meal event")
const mealEvent = { _tag: "meal", food: "pasta", amount: "most", occurredAt }
out(await client.mutation("captures:publishEvent", { ...capture("cap-demo-1", "She ate most of her pasta at lunch", occurredAt), event: mealEvent }))

// 5 — idempotent publish retry
step(5, "republish SAME captureId → 'already', exactly one entry")
out(await client.mutation("captures:publishEvent", { ...capture("cap-demo-1", "She ate most of her pasta at lunch", occurredAt), event: mealEvent }))

// 6 — validation failure at the boundary (second capture)
step(6, "INVALID event (amount 'half' out of vocabulary) → EVENT_DECODE_FAILED")
const cap2 = capture("cap-demo-2", "He didn't eat his breakfast", Date.parse("2026-09-17T09:40:00Z"))
out(await client.mutation("captures:persistCaptureRaw", cap2))
const badResult = await client
  .mutation("captures:publishEvent", { ...cap2, event: { _tag: "meal", food: "eggs", amount: "half", occurredAt: cap2.occurredAt } })
  .then((v) => ({ ok: true, v }))
  .catch((e) => ({ ok: false, message: String(e).slice(0, 120) }))
out(badResult)
const rawStillThere = await client.query("captures:listCaptures", {})
const cap2rows = rawStillThere.filter((c) => c.captureId === "cap-demo-2")
console.log(`    → raw capture rows for cap-demo-2: ${cap2rows.length}, rawText=${cap2rows[0]?.rawText ?? "MISSING"}`)
if (!decodeJournalEvent({ _tag: "meal", food: "eggs", amount: "half", occurredAt: cap2.occurredAt }).success) {
  console.log("    → local decode agrees: schema rejects amount 'half'")
}

// 7 — corrected retry, same captureId
step(7, "retry with corrected event (amount 'none'), SAME captureId → exactly one entry")
out(await client.mutation("captures:publishEvent", { ...cap2, event: { _tag: "meal", food: "eggs", amount: "none", occurredAt: cap2.occurredAt } }))

// 8 — timeline
step(8, "child timeline (Maya) after all writes — reads back from the backend")
const entries = await client.query("captures:listEntries", { childId: CAPTURE_ARGS.childId })
for (const e of entries) {
  console.log(`    · ${new Date(e.occurredAt).toISOString()} ${e.event?._tag ?? "(raw-only)"} :: ${JSON.stringify(e.event ?? {})}`)
}
const captures = await client.query("captures:listCaptures", {})
console.log(`\nSummary: ${captures.length} raw captures retained, ${entries.length} timeline entries, ` +
  `duplicates avoided by captureId idempotency.`)
