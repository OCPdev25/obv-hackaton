/**
 * Candidate A conversation flows over the synthetic September household:
 * mixed-topic capture (text + simulated voice), in-thread review/edit,
 * publish with raw preservation and provenance, append-only corrections,
 * strictly read-only questions/catch-up, and fail-closed authorization.
 */
import { describe, expect, it } from "vitest"

import { ConversationController, isReadOnlyQuestion, type Turn } from "../src/conversation/controller.js"
import { anonymousPrincipal, at, memberPrincipal } from "../src/fixtures/household.js"
import { createSeptemberStore } from "../src/fixtures/september.js"
import { DEMO_UTTERANCES } from "../src/fixtures/demoUtterances.js"

const MIXED =
  "Milo ate scrambled eggs and toast at 8, then had a total meltdown when the block tower fell, and Iris napped 45 minutes."

function newController(memberId = "mem_dana") {
  const { store } = createSeptemberStore()
  return { store, controller: new ConversationController(store, memberPrincipal(memberId), memberId, at(16, 20, 0)) }
}

function lastTurn(controller: ConversationController): Turn {
  const turns = controller.getTurns()
  const last = turns[turns.length - 1]
  if (last === undefined) throw new Error("expected a turn")
  return last
}

function captureTurns(controller: ConversationController) {
  return controller.getTurns().filter((turn): turn is Extract<Turn, { kind: "capture" }> => turn.kind === "capture")
}

describe("mixed-topic capture (both input paths, same pipeline)", () => {
  it("text path: one sitting captures meal + mood + sleep as reviewable proposals", () => {
    const { store, controller } = newController()
    controller.sendText(MIXED)

    const turn = lastTurn(controller)
    expect(turn.kind).toBe("capture")
    if (turn.kind !== "capture") return

    expect(turn.rawTranscript).toBe(MIXED) // raw preserved before any extraction
    expect(turn.proposals.map((proposal) => proposal.category).sort()).toEqual(["meal", "mood", "sleep"])
    expect(store.entry(turn.entryId)?.rawTranscript).toBe(MIXED)
  })

  it("simulated-voice path lands on the same pipeline with byte-identical transcript", () => {
    const { controller } = newController()
    controller.sendVoiceDemo(MIXED)

    const turns = captureTurns(controller)
    expect(turns.length).toBe(1)
    const turn = turns[0]!
    expect(turn.rawTranscript).toBe(MIXED)
    expect(turn.proposals.map((proposal) => proposal.category).sort()).toEqual(["meal", "mood", "sleep"])
  })

  it("user turn records the channel (voice-simulated vs text)", () => {
    const { controller } = newController()
    controller.sendVoiceDemo("Iris napped 50 minutes this afternoon.")
    const turns = controller.getTurns()
    expect(turns[0]?.kind).toBe("user")
    expect((turns[0] as Extract<Turn, { kind: "user" }>).channel).toBe("voice-simulated")

    controller.sendText("typed note")
    const all = controller.getTurns()
    expect((all[all.length - 2] as Extract<Turn, { kind: "user" }>).channel).toBe("text")
  })

  it("all five scripted utterances capture with raw preserved (no throw, no invented events)", () => {
    const { controller } = newController()
    for (const utterance of DEMO_UTTERANCES) {
      controller.sendText(utterance)
      const turn = lastTurn(controller)
      expect(turn.kind).toBe("capture")
      if (turn.kind === "capture") expect(turn.rawTranscript).toBe(utterance)
    }
  })

  it("captureId idempotency: duplicate submission replays, never duplicates", () => {
    const { store } = createSeptemberStore()
    const principal = memberPrincipal("mem_dana")
    const input = {
      captureId: "cap_test_idempotent",
      transcript: "Iris napped 40 minutes.",
      authorId: "mem_dana",
      capturedAt: at(16, 18, 0),
      channel: "text" as const,
    }
    const first = store.capture(principal, input)
    const second = store.capture(principal, input)
    expect(first.kind).toBe("captured")
    expect(second.kind).toBe("replayed")
    if (first.kind === "captured" && second.kind === "replayed") {
      expect(second.entryId).toBe(first.entryId)
    }
  })
})

describe("inspect and correct proposals before publish", () => {
  it("edits child, time, amount, and audience on the proposal card before publish", () => {
    const { store, controller } = newController()
    controller.sendText("Iris napped 45 minutes.")
    const turn = lastTurn(controller)
    expect(turn.kind).toBe("capture")
    if (turn.kind !== "capture") return

    const proposal = turn.proposals[0]!
    const milo = controller.childrenRoster.find((child) => child.name === "Milo")
    expect(milo).toBeDefined()

    controller.publish(turn.entryId, new Map([
      [proposal.proposalId, {
        childId: milo!.childId,
        timestamp: at(16, 15, 30),
        payload: { minutes: 60 },
        audience: "parents-only",
      }],
    ]))

    const receipt = lastTurn(controller)
    expect(receipt.kind).toBe("publish-receipt")
    const visible = store.visibleEvents(memberPrincipal("mem_dana"), turn.entryId)
    expect(visible.length).toBe(1)
    const { event, audience } = visible[0]!
    expect(event.childId).toBe(milo!.childId)
    expect(event.timestamp).toBe(at(16, 15, 30))
    expect(event.payload?.["minutes"]).toBe(60)
    expect(audience).toBe("parents-only")
  })

  it("edits the interpreted type before publish", () => {
    const { store, controller } = newController()
    controller.sendText("Milo pooped on the potty at 3, big win!")
    const turn = lastTurn(controller)
    expect(turn.kind).toBe("capture")
    if (turn.kind !== "capture") return

    const proposal = turn.proposals[0]!
    controller.publish(turn.entryId, new Map([[proposal.proposalId, { category: "mood" }]]))
    const visible = store.visibleEvents(memberPrincipal("mem_dana"), turn.entryId)
    expect(visible[0]?.event.category).toBe("mood")
  })
})

describe("publish → raw-preserved entry + events with provenance", () => {
  it("published events carry canonical producedBy lineage and caregiver confidence", () => {
    const { store, controller } = newController()
    controller.sendText(MIXED)
    const turn = lastTurn(controller)
    if (turn.kind !== "capture") return
    const entryId = turn.entryId

    controller.publish(entryId, new Map())
    expect(lastTurn(controller).kind).toBe("publish-receipt")

    const visible = store.visibleEvents(memberPrincipal("mem_dana"), entryId)
    expect(visible.length).toBe(3)
    for (const { event } of visible) {
      expect(event.producedBy?.extractorVersion).toBe("home-a-extraction-double/0.1.0")
      expect(event.confidence).toBe(1) // caregiver-confirmed at publish
    }
    // raw transcript still intact after publish
    expect(store.entry(entryId)?.rawTranscript).toBe(MIXED)
    expect(store.entry(entryId)?.visibility).toBe("published")
  })
})

describe("post-publish correction appends lineage (original intact)", () => {
  it("correction happens conversationally; the original event is never mutated", () => {
    const { store, controller } = newController()
    controller.sendText("Iris napped 50 minutes this afternoon.")
    const turn = lastTurn(controller)
    if (turn.kind !== "capture") return
    controller.publish(turn.entryId, new Map())
    const receipt = lastTurn(controller)
    if (receipt.kind !== "publish-receipt") return
    const eventId = receipt.eventIds[0]!

    controller.correct(eventId, { payload: { minutes: 55 } }, "miscounted the timer")

    expect(lastTurn(controller).kind).toBe("correction")
    // the live event shows the corrected value (the read model);
    // the ORIGINAL is preserved inside the append-only lineage record
    expect(store.event(eventId)?.payload?.["minutes"]).toBe(55)
    const history = store.correctionHistory(eventId)
    expect(history.length).toBe(1)
    expect(history[0]?.before.payload?.["minutes"]).toBe(50)
    expect(history[0]?.after.payload?.["minutes"]).toBe(55)
    expect(history[0]?.reason).toBe("miscounted the timer")
  })

  it("the Sep 16 bedtime capture attributes each sleep fact to the right child", () => {
    const { store, facts } = createSeptemberStore()
    const entryId = facts.entryIdByCaptureId.get("seed_sep16_bedtime")
    expect(entryId).toBeDefined()
    if (entryId === undefined) return
    const events = store.visibleEvents(memberPrincipal("mem_dana"), entryId).map((row) => row.event)
    const irisNap = events.find((event) => event.childId === "ch_iris" && event.category === "sleep")
    const miloBedtime = events.find((event) => event.childId === "ch_milo" && event.category === "sleep")
    expect(irisNap?.payload?.["minutes"]).toBe(65)
    expect(miloBedtime).toBeDefined()
  })

  it("the seeded Sep 12 nap carries the 30 → 60 lineage example", () => {
    const { store, facts } = createSeptemberStore()
    expect(store.event(facts.sep12Nap.eventId)?.payload?.["minutes"]).toBe(60)
    const lineage = store.correctionHistory(facts.sep12Nap.eventId)
    expect(lineage.length).toBe(1)
    expect(lineage[0]?.before.payload?.["minutes"]).toBe(30)
  })
})

describe("read-only catch-up and questions never write", () => {
  it("answers cite sources and the write counter never moves", () => {
    const { store, controller } = newController()
    const before = store.writeCount

    controller.ask("How did naps go this week?")
    controller.catchUp()
    controller.monthView()
    controller.ask("Did Iris nap today?")

    expect(store.writeCount).toBe(before) // strictly read-only

    const answerTurns = controller.getTurns().filter((turn) => turn.kind === "answer")
    expect(answerTurns.length).toBe(2)
    for (const turn of answerTurns) {
      if (turn.kind !== "answer") continue
      expect(turn.answer.kind).toBe("summary")
      if (turn.answer.kind === "summary") expect(turn.answer.citations.length).toBeGreaterThan(0)
    }
    expect(controller.getTurns().some((turn) => turn.kind === "catchup")).toBe(true)
    expect(controller.getTurns().some((turn) => turn.kind === "month-view")).toBe(true)
  })

  it("question routing: read-only questions never enter the capture pipeline", () => {
    expect(isReadOnlyQuestion("How did naps go this week?")).toBe(true)
    expect(isReadOnlyQuestion("Did Iris nap today?")).toBe(true)
    expect(isReadOnlyQuestion("Milo ate eggs at 8")).toBe(false)
  })
})

describe("fail-closed authorization", () => {
  it("a non-member sees nothing, captures nothing, and is denied in-thread", () => {
    const { store } = createSeptemberStore()
    expect(store.visibleEntries(anonymousPrincipal).length).toBe(0)
    expect(store.visibleEntries(memberPrincipal("mem_stranger")).length).toBe(0)

    const controller = new ConversationController(store, anonymousPrincipal, "mem_stranger", at(16, 20, 0))
    controller.sendText(MIXED)
    expect(lastTurn(controller).kind).toBe("denied")
    controller.ask("How did naps go this week?")
    expect(lastTurn(controller).kind).toBe("denied")
    controller.catchUp()
    expect(lastTurn(controller).kind).toBe("denied")
    // no capture turn ever appeared
    expect(captureTurns(controller).length).toBe(0)
  })

  it("parents-only entries are invisible to the invited caregiver but visible to a parent", () => {
    const { store, facts } = createSeptemberStore()
    const danaIds = store.visibleEntries(memberPrincipal("mem_dana")).map((row) => row.entryId)
    const rosaIds = store.visibleEntries(memberPrincipal("mem_rosa")).map((row) => row.entryId)
    expect(danaIds).toContain(facts.parentsOnlyEntryId)
    expect(rosaIds).not.toContain(facts.parentsOnlyEntryId)
  })

  it("the caregiver's month view cites only entries she is allowed to see", () => {
    const { store } = createSeptemberStore()
    const rosa = new ConversationController(store, memberPrincipal("mem_rosa"), "mem_rosa", at(16, 20, 0))
    rosa.monthView()
    const turn = lastTurn(rosa)
    expect(turn.kind).toBe("month-view")
    if (turn.kind !== "month-view" || turn.view.kind !== "summary") return
    const visibleIds = store.visibleEntries(memberPrincipal("mem_rosa")).map((row) => row.entryId)
    for (const citation of turn.view.citations) {
      expect(visibleIds).toContain(citation.entryId)
    }
  })

  it("Nana Rosa's seeded afternoon-care notes exist (Sep 3, 10, 15)", () => {
    const { store } = createSeptemberStore()
    const rosaAuthored = store
      .visibleEntries(memberPrincipal("mem_rosa"))
      .filter((row) => row.entry.authorId === "mem_rosa")
    expect(rosaAuthored.length).toBeGreaterThanOrEqual(3)
  })
})

describe("synthetic dataset shape", () => {
  it("seeds a month of history (>= 20 entries) through the real pipeline", () => {
    const { store, facts } = createSeptemberStore()
    expect(facts.entryCount).toBeGreaterThanOrEqual(20)
    expect(store.visibleEntries(memberPrincipal("mem_dana")).length).toBe(facts.entryCount)
  })
})
