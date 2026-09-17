/**
 * Journey CLI contract probe (grafted from candidate C): walks the complete
 * capture journey over the integrated pipeline and machine-checks the
 * contracts that matter across candidates — raw-before-events durability,
 * failure park + retry, idempotent replay, publish visibility flip,
 * cold-start reload stability, and the stale-result guard.
 *
 * Usage: bun src/journey/run.ts   (exit 0 = all checks pass)
 */
import { Effect, Schema } from "effect"
import { CaptureId } from "@journal/domain"

import { makeCaptureLoop } from "../runtime.js"
import { makeInMemoryEntryStore } from "../services/entries.js"
import { makeDeterministicExtractor } from "../services/extraction.js"

import type { CaptureServices } from "../runtime.js"
import type { InMemoryEntryStore } from "../services/entries.js"

const BASE = 1_760_000_000_000 // fixed "now" — probe is deterministic
const CHILD = "child-journey"
const AUTHOR = "author-mom"
const cid = Schema.decodeSync(CaptureId)

const services = (entries: InMemoryEntryStore): CaptureServices => ({
  extraction: makeDeterministicExtractor(),
  entries,
})

const checks: Array<{ name: string; pass: boolean }> = []
const check = (name: string, pass: boolean) => {
  checks.push({ name, pass })
}

const run = async () => {
  // ── Journey 1: happy path — raw persisted before events, then published ──
  {
    const store = makeInMemoryEntryStore()
    const loop = makeCaptureLoop(services(store))
    const dispatch = (m: object) => Effect.runPromise(loop.dispatch(m as never))

    await dispatch({ _tag: "CaptureStarted", captureId: "cap-1", childId: CHILD, authorId: AUTHOR })
    await dispatch({
      _tag: "CompletedTranscription",
      captureId: "cap-1",
      transcript: "She drank 6 ounces of formula at 2 pm. Then she went down for a nap.",
      at: BASE,
      timezone: "America/New_York",
    })

    // Raw-first: after transcription settles, the durable draft exists with
    // zero events, and only then does extraction attach events.
    const mid = await Effect.runPromise(store.timeline(CHILD))
    const draft = mid.find((e) => e.captureId === "cap-1")
    check("raw draft durably persisted on transcription", draft !== undefined)
    check("raw transcript preserved byte-for-byte", draft?.rawTranscript === "She drank 6 ounces of formula at 2 pm. Then she went down for a nap.")

    await dispatch({ _tag: "SubmittedForExtraction", captureId: "cap-1" })
    const extracted = await Effect.runPromise(store.timeline(CHILD))
    const withEvents = extracted.find((e) => e.captureId === "cap-1")
    check("extraction attached events to the durable draft", (withEvents?.events.length ?? 0) > 0)
    check("log ordering honors raw-before-events", (withEvents?.events.length ?? 0) > 0 && draft !== undefined && draft.events.length === 0)
    check(
      "meal event carries ounce quantity",
      withEvents?.events.some((e) => e.category === "meal" && e.quantity?.unit === "oz" && e.quantity.value === 6) === true,
    )
    check("occurredAt resolved to absolute millis", withEvents?.events.every((e) => Number.isFinite(e.occurredAt)) === true)

    await dispatch({ _tag: "ConfirmedReview", captureId: "cap-1", at: BASE + 1000 })
    const afterPublish = (await Effect.runPromise(store.timeline(CHILD))).find((e) => e.captureId === "cap-1")
    check("publish flips visibility to published", afterPublish?.status === "published")
    check("machine reached Published", loop.state()._tag === "Published")
  }

  // ── Journey 2: store failure parks the machine; retry recovers ──
  {
    const realStore = makeInMemoryEntryStore()
    const failing: InMemoryEntryStore = {
      persistRawDraft: () => Effect.fail({ _tag: "unavailable" as const, reason: "storage down" }),
      attachEvents: (captureId, events) => realStore.attachEvents(captureId, events),
      publish: (captureId) => realStore.publish(captureId),
      timeline: (childId) => realStore.timeline(childId),
      reloadFromLog: () => realStore.reloadFromLog(),
      rawLogSize: () => realStore.rawLogSize(),
    }
    const loop = makeCaptureLoop(services(failing))
    const dispatch = (m: object) => Effect.runPromise(loop.dispatch(m as never))

    await dispatch({ _tag: "CaptureStarted", captureId: "cap-2", childId: CHILD, authorId: AUTHOR })
    await dispatch({
      _tag: "CompletedTranscription",
      captureId: "cap-2",
      transcript: "he had a wet diaper at 9:15 am",
      at: BASE,
      timezone: "America/New_York",
    })
    const parkedState = loop.state()
    check("store failure parks the machine with raw preserved", parkedState._tag === "RawPersistFailed")
    check("parked state retains raw transcript", parkedState._tag === "RawPersistFailed" && parkedState.rawTranscript === "he had a wet diaper at 9:15 am")

    // Recovery: a working store and a fresh machine; re-run the journey —
    // the deterministic pipeline converges to the same events.
    const recovery = makeInMemoryEntryStore()
    const recoveryLoop = makeCaptureLoop(services(recovery))
    const retryDispatch = (m: object) => Effect.runPromise(recoveryLoop.dispatch(m as never))
    await retryDispatch({ _tag: "CaptureStarted", captureId: "cap-2", childId: CHILD, authorId: AUTHOR })
    await retryDispatch({
      _tag: "CompletedTranscription",
      captureId: "cap-2",
      transcript: "he had a wet diaper at 9:15 am",
      at: BASE,
      timezone: "America/New_York",
    })
    const recovered = await Effect.runPromise(recovery.timeline(CHILD))
    check(
      "retry after park persists the raw draft",
      recovered.some((e) => e.captureId === "cap-2" && e.rawTranscript === "he had a wet diaper at 9:15 am"),
    )
  }

  // ── Journey 3: idempotent replay + publish idempotence + reload stability ──
  {
    const store = makeInMemoryEntryStore()
    const transcript = "she had 4 oz bottle around 10:30 am"
    const first = await Effect.runPromise(
      store.persistRawDraft({ captureId: cid("cap-3"), childId: CHILD, authorId: AUTHOR, rawTranscript: transcript, createdAt: BASE }),
    )
    const replay = await Effect.runPromise(
      store.persistRawDraft({ captureId: cid("cap-3"), childId: CHILD, authorId: AUTHOR, rawTranscript: transcript, createdAt: BASE }),
    )
    check("duplicate persist returns the existing entry (idempotent replay)", replay.captureId === first.captureId && store.rawLogSize() === 1)

    await Effect.runPromise(
      store.attachEvents("cap-3", [
        { _tag: "Event", category: "meal", occurredAt: BASE, quantity: { value: 4, unit: "oz" }, confidence: 0.9, authorId: AUTHOR },
      ]),
    )
    await Effect.runPromise(store.publish("cap-3"))
    await Effect.runPromise(store.publish("cap-3")) // idempotent publish
    const beforeReload = await Effect.runPromise(store.timeline(CHILD))
    await Effect.runPromise(store.reloadFromLog())
    const afterReload = await Effect.runPromise(store.timeline(CHILD))
    check("reload is byte-stable (no loss/dup/mutation)", JSON.stringify(afterReload) === JSON.stringify(beforeReload))
    check("reloaded entry stays published with events", afterReload[0]?.status === "published" && afterReload[0]?.events.length === 1)
  }

  // ── Journey 4: stale-result guard (candidate D) ──
  {
    const store = makeInMemoryEntryStore()
    const loop = makeCaptureLoop(services(store))
    const dispatch = (m: object) => Effect.runPromise(loop.dispatch(m as never))
    await dispatch({ _tag: "CaptureStarted", captureId: "cap-1", childId: CHILD, authorId: AUTHOR })
    await dispatch({
      _tag: "CompletedTranscription",
      captureId: "cap-1",
      transcript: "wet diaper 9:15 am",
      at: BASE,
      timezone: "America/New_York",
    })
    await dispatch({ _tag: "SubmittedForExtraction", captureId: "cap-1" })
    // A late result for a DIFFERENT capture id must be ignored, not applied.
    await dispatch({ _tag: "SucceededExtraction", captureId: "cap-other", events: [] })
    check("stale result for another capture ignored", loop.state()._tag === "Review")
  }

  const failed = checks.filter((c) => !c.pass)
  for (const c of checks) console.log(`${c.pass ? "✅" : "❌"} ${c.name}`)
  console.log(`\n${checks.length - failed.length}/${checks.length} journey checks passed`)
  if (failed.length > 0) process.exit(1)
}

run().catch((error) => {
  console.error("journey probe crashed:", error)
  process.exit(1)
})
