/**
 * capture-flow scenario — records the six-step flow over the acceptance
 * corpus's CandidateAdapter protocol in the QA console fixture:
 * capture → inspect → correct → save (failure/recovery) → reopen → handoff.
 *
 * Every assertion reads deterministic state from window.__qa AND the visible
 * DOM, so screenshots and assertions can never disagree. Settle detection is
 * seq-based (the console bumps a monotonic counter after each async action),
 * so a step can never assert against a pre-click state. Synthetic family
 * data only (fictional child "Ava", synthetic caregiver-1).
 */
import type { Page } from "playwright"
import { createHash } from "node:crypto"
import f01 from "../../../evaluation/fixtures/01-multi-event-narrative.json"
import f03 from "../../../evaluation/fixtures/03-malformed-extraction.json"
import f04 from "../../../evaluation/fixtures/04-retry-double-submit.json"
import f06 from "../../../evaluation/fixtures/06-reload-persistence.json"
import type { QaState } from "../../console/src/console.ts"
import type { Scenario, StepHandle } from "../scenario.ts"

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex")

async function qaState(page: Page): Promise<QaState> {
  return await page.evaluate(() => {
    const qa = (window as unknown as { __qa?: { state(): unknown } }).__qa
    if (qa === undefined) throw new Error("console __qa hook missing — wrong page?")
    return qa.state() as QaState
  })
}

/** Wait until the console settles: seq has advanced past `minSeq` and no action is busy. */
async function waitForSettled(page: Page, minSeq: number): Promise<QaState> {
  await page.waitForFunction(
    (min) => {
      const qa = (window as unknown as { __qa?: { state(): { seq: number; captureState: string } } }).__qa
      if (qa === undefined) return false
      const s = qa.state()
      return s.seq >= min && s.captureState !== "busy"
    },
    minSeq,
    { timeout: 10_000 },
  )
  return await qaState(page)
}

async function fillCaptureForm(page: Page, opts: { transcript: string; captureId?: string }): Promise<void> {
  await page.fill("#transcript", opts.transcript)
  await page.fill("#captured-at", "1789563600000")
  await page.fill("#timezone", "America/New_York")
  await page.fill("#author-id", "caregiver-1")
  await page.fill("#capture-id", opts.captureId ?? "")
}

/** Click Capture and wait for THAT invocation to settle (seq must advance). */
async function clickCapture(page: Page, prev: QaState): Promise<QaState> {
  await page.click("#capture-btn")
  return await waitForSettled(page, prev.seq + 1)
}

async function selectRole(page: Page, role: string): Promise<void> {
  await page.selectOption("#role-select", role)
  await page.waitForFunction(
    (r) => {
      const qa = (window as unknown as { __qa?: { state(): { role: string } } }).__qa
      return qa !== undefined && qa.state().role === r
    },
    role,
    { timeout: 5_000 },
  )
}

export const scenario: Scenario = {
  name: "capture-flow",
  title: "Capture → inspect → correct → save (failure/recovery) → reopen → handoff",
  fixtureSeed: {
    corpus: "evaluation/fixtures",
    fixtureIds: ["multi-event-narrative", "malformed-extraction", "retry-double-submit", "raw-fidelity", "reload-persistence"],
    capturedAtMs: 1789563600000,
    timezone: "America/New_York",
    authorId: "caregiver-1",
    note: "Synthetic family data only (fictional child 'Ava', synthetic caregiver-1) — no real persons, no credentials.",
  },
  steps: [
    {
      id: "tc-1",
      name: "capture",
      title: "Capture preserves the raw transcript byte-for-byte and issues a resilient captureId",
      fixtureIds: ["multi-event-narrative"],
      async run(page, h: StepHandle) {
        await fillCaptureForm(page, { transcript: f01.input.transcript })
        await h.shot("tc-1-capture-form.png", "before")
        const prev = await qaState(page)
        const s = await clickCapture(page, prev)
        h.assert("createEntry resolved Created", s.captureState === "created", `state=${s.captureState}`)
        h.assert("captureId assigned (resilient capture identity)", typeof s.captureId === "string" && s.captureId.startsWith("cap-"), s.captureId ?? "none")
        h.assert("raw transcript preserved byte-for-byte (SHA-256, computed in page)", s.rawPreserved)
        const shaLine = (await page.locator("#raw-sha").textContent()) ?? ""
        h.assert("raw fidelity verdict visible in UI", shaLine.includes("byte-for-byte preserved"), shaLine.trim().slice(0, 100))
        await h.shot("tc-1-capture.png", "result")
      },
    },
    {
      id: "tc-2",
      name: "inspect",
      title: "Inspect shows extracted typed events with resolved instants from the corpus fixture",
      fixtureIds: ["multi-event-narrative"],
      async run(page, h) {
        const s = await qaState(page)
        const expected = f01.expected.events
        h.assert(`event count matches fixture (${expected.length})`, s.eventCount === expected.length, `${s.eventCount}`)
        const categories = s.events.map((e) => e.category)
        h.assert(
          "categories in transcript order [meal, potty, mood]",
          JSON.stringify(categories) === JSON.stringify(["meal", "potty", "mood"]),
          categories.join(","),
        )
        const expectedTimes = expected.map((e) => e.occurredAt)
        const actualTimes = s.events.map((e) => e.occurredAt)
        h.assert(
          "occurredAt resolved to fixture-expected instants (relative-time + timezone)",
          JSON.stringify(actualTimes) === JSON.stringify(expectedTimes),
          `${actualTimes.join(",")} vs ${expectedTimes.join(",")}`,
        )
        h.assert(
          "confidences finite within [0,1]",
          s.events.every((e) => Number.isFinite(e.confidence) && e.confidence >= 0 && e.confidence <= 1),
        )
        await h.shot("tc-2-inspect.png", "result")
      },
    },
    {
      id: "tc-3",
      name: "correct",
      title: "Correct: malformed capture is stored raw with zero events (captured_with_event_errors); corrected capture succeeds",
      fixtureIds: ["malformed-extraction", "retry-double-submit"],
      async run(page, h) {
        await fillCaptureForm(page, { transcript: f03.input.transcript })
        const prev = await qaState(page)
        await clickCapture(page, prev)
        let s = await waitForSettled(page, prev.seq + 1)
        h.assert("malformed capture persisted (extraction failure never blocks capture)", s.captureState === "created", `state=${s.captureState}`)
        h.assert("zero schema-valid events extracted", s.eventCount === 0, `${s.eventCount}`)
        h.assert("captured_with_event_errors badge shown", s.eventErrorsBadge)
        h.assert("raw preserved byte-for-byte through validation failure (control chars intact)", s.rawPreserved)
        await h.shot("tc-3-correct-before.png", "error")

        await fillCaptureForm(page, { transcript: f04.input.transcript }) // corrected dictation, fresh captureId
        const mid = await qaState(page)
        s = await clickCapture(page, mid)
        h.assert("corrected capture created", s.captureState === "created", `state=${s.captureState}`)
        h.assert(
          "corrected capture extracted exactly one potty event",
          s.eventCount === 1 && s.events[0]?.category === "potty",
          s.events.map((e) => e.category).join(","),
        )
        await h.shot("tc-3-correct-after.png", "result")
      },
    },
    {
      id: "tc-4",
      name: "save-failure-recovery",
      title: "Save: backend failure surfaces an error state without persisting; retry recovers; double-submit is an idempotent replay",
      fixtureIds: ["retry-double-submit"],
      async run(page, h) {
        const before = await qaState(page)
        await fillCaptureForm(page, { transcript: f04.input.transcript, captureId: "cap-retry-001" })
        await page.check("#fail-save")
        let s = await clickCapture(page, before)
        h.assert("simulated backend failure surfaced as visible error state", s.captureState === "error" && s.lastError !== null, s.lastError ?? "no error shown")
        h.assert("failed save did not persist (timeline unchanged)", s.timelineCount === before.timelineCount, `${before.timelineCount} → ${s.timelineCount}`)
        await h.shot("tc-4-save-error.png", "error")

        await page.uncheck("#fail-save")
        s = await clickCapture(page, s) // same captureId still filled
        h.assert("retry persisted the entry (recovery)", s.captureState === "created", `state=${s.captureState}`)
        const afterCreate = await qaState(page)

        s = await clickCapture(page, afterCreate) // double submit, same captureId
        h.assert("double-submit resolved IdempotentReplay (original wins)", s.captureState === "idempotent-replay", `state=${s.captureState}`)
        h.assert("no second entry persisted after replay", s.timelineCount === afterCreate.timelineCount, `${afterCreate.timelineCount} → ${s.timelineCount}`)
        const unique = new Set(s.timelineCaptures)
        h.assert("captureIds in timeline unique", unique.size === s.timelineCaptures.length, `${unique.size}/${s.timelineCaptures.length}`)
        await h.shot("tc-4-save-recovered.png", "result")
      },
    },
    {
      id: "tc-5",
      name: "reopen",
      title: "Reopen: cold-start reload re-reads the durable timeline — nothing lost, duplicated, or mutated; transcripts byte-identical",
      fixtureIds: ["reload-persistence", "raw-fidelity"],
      async run(page, h) {
        const one = f06.inputs[0]
        const two = f06.inputs[1]
        if (one === undefined || two === undefined) throw new Error("fixture 06 missing inputs")
        let cur = await qaState(page)
        for (const item of [one, two]) {
          await fillCaptureForm(page, { transcript: item.transcript })
          cur = await clickCapture(page, cur)
        }
        const preReload = cur
        await page.click("#reload-btn")
        const s = await waitForSettled(page, preReload.seq + 1)
        h.assert("timeline re-read after simulated cold start", s.captureState === "reloaded", `state=${s.captureState}`)
        h.assert("no entries lost across reload", s.timelineCount === preReload.timelineCount, `${preReload.timelineCount} → ${s.timelineCount}`)
        const shaSet = new Set(Object.values(s.timelineShas))
        const expectedShas = [f01.input.transcript, f03.input.transcript, f04.input.transcript, one.transcript, two.transcript].map(sha)
        h.assert(
          "all transcripts byte-identical after reload (SHA-256, incl. unicode/control-char raw)",
          expectedShas.every((x) => shaSet.has(x)),
          `${expectedShas.filter((x) => shaSet.has(x)).length}/${expectedShas.length} matched`,
        )
        const unique = new Set(s.timelineCaptures)
        h.assert("no duplicated captures after reload", unique.size === s.timelineCaptures.length, `${unique.size}/${s.timelineCaptures.length}`)
        await h.shot("tc-5-reopen.png", "result")
      },
    },
    {
      id: "tc-6",
      name: "handoff",
      title: "Handoff: invited caregiver reads the attributed timeline; unrelated viewer is fail-closed denied",
      fixtureIds: ["reload-persistence", "malformed-extraction"],
      async run(page, h) {
        const cur = await qaState(page)
        await selectRole(page, "caregiver-invited")
        let s = await qaState(page)
        h.assert("invited caregiver authorized — timeline visible", s.authorized && s.timelineCount === cur.timelineCount, `authorized=${s.authorized} count=${s.timelineCount} (expected ${cur.timelineCount})`)
        const firstRow = (await page.locator("#timeline li").first().textContent()) ?? ""
        h.assert("author attribution visible in timeline row", firstRow.includes("caregiver-1"), firstRow.slice(0, 90))
        await h.shot("tc-6-handoff-authorized.png", "result")

        await selectRole(page, "unauthorized-viewer")
        s = await qaState(page)
        h.assert("unrelated viewer fail-closed: nothing rendered", !s.authorized && s.timelineCount === 0, `authorized=${s.authorized} count=${s.timelineCount}`)
        h.assert("denial message visible", await page.locator("#timeline-denied").isVisible())
        await h.shot("tc-6-handoff-denied.png", "error")

        await selectRole(page, "parent") // restore authorized view for the session recording end state
      },
    },
  ],
}
