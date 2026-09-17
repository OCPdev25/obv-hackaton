import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { Schema } from "effect"

import { Entry, Event } from "../src/contract"
import { currentEvents, day, month, supersededEvents } from "../src/data"
import manifest from "../fixtures/manifest.json"
import dayJson from "../fixtures/s1-day.json"
import monthJson from "../fixtures/month-history.json"

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex")

describe("fixture → contract decode (art_I2TCG08V v0.2)", () => {
  test("every Entry wire payload decodes through the canonical Entry schema", () => {
    const fixture = dayJson as unknown as { entries: Array<{ entryId: string; wire: unknown }> }
    for (const entry of fixture.entries) {
      const decoded = Schema.decodeUnknownSync(Entry)(entry.wire)
      expect(decoded._tag).toBe("Entry")
      expect(decoded.transcript.length).toBeGreaterThan(0)
    }
  })

  test("every Event wire payload decodes through the canonical Event schema", () => {
    const fixture = dayJson as unknown as { events: Array<{ eventId: string; wire: { category: "potty" | "meal" | "sleep" | "mood" | "milestone" | "school" } }> }
    for (const event of fixture.events) {
      const decoded = Schema.decodeUnknownSync(Event)(event.wire)
      expect(decoded.category).toBe(event.wire.category)
    }
  })

  test("transcripts round-trip byte-identical (sha256 in manifest)", () => {
    const hashes = manifest.transcripts.sha256 as Record<string, string>
    for (const entry of day.entries) {
      expect(sha256(entry.wire.transcript)).toBe(hashes[entry.entryId] as string)
    }
  })

  test("wire format: no explicit nulls anywhere; timestamps are integer unix-ms", () => {
    const walk = (node: unknown): void => {
      if (node === null) throw new Error("explicit null in fixture — not in contract")
      if (Array.isArray(node)) return node.forEach(walk)
      if (typeof node === "object" && node !== undefined) {
        for (const value of Object.values(node as Record<string, unknown>)) walk(value)
      }
    }
    walk(dayJson)
    walk(monthJson)
    for (const event of day.events) {
      expect(Number.isInteger(event.wire.occurredAt.getTime())).toBe(true)
    }
  })

  test("regenerating fixtures is a byte-level no-op (determinism proof)", () => {
    const spikeDir = join(import.meta.dir, "..")
    const files = ["s1-day.json", "month-history.json", "manifest.json"] as const
    const before = files.map((f) => createHash("sha256").update(readFileSync(join(spikeDir, "fixtures", f))).digest("hex"))
    const run = Bun.spawnSync(["bun", "scripts/generate-fixtures.ts"], { cwd: spikeDir })
    expect(run.exitCode).toBe(0)
    const after = files.map((f) => createHash("sha256").update(readFileSync(join(spikeDir, "fixtures", f))).digest("hex"))
    expect(after).toEqual(before)
  })
})

describe("scenario integrity (rubric ground rule 1 — identical S1, binding)", () => {
  test("exactly one clarification round-trip, answered", () => {
    const entry = day.entries[0]
    expect(entry?.capture.clarification).toBeDefined()
    expect(entry?.capture.attempts.length).toBe(2)
    const clarify = entry?.capture.clarification
    expect(clarify !== undefined && clarify.answeredAt > clarify.askedAt).toBe(true)
    // ...and the other capture has none:
    expect(day.entries[1]?.capture.clarification).toBeUndefined()
  })

  test("interruption is a session fact, never transcript bytes", () => {
    const entry = day.entries[0]
    expect(entry?.capture.interruptedAt).toBeDefined()
    expect(entry?.wire.transcript.includes("call")).toBe(false)
    expect(entry?.wire.transcript.includes("interrupt")).toBe(false)
  })

  test("takeover brief: five facts, each with at least one source; pending items resolved", () => {
    expect(day.takeover.fiveFacts.length).toBe(5)
    for (const fact of day.takeover.fiveFacts) {
      expect(fact.refs.length).toBeGreaterThan(0)
    }
    expect(day.takeover.pendingItems.every((p) => p.state === "resolved")).toBe(true)
    expect(day.takeover.pendingItems.length).toBe(2)
  })

  test("failed extraction (S1-D): failed attempt visible, transcript preserved, no data loss", () => {
    const e2 = day.entries[1]
    expect(e2?.capture.attempts[0]?.outcome).toBe("failed")
    expect(e2?.capture.attempts[0]?.failureReason?.toLowerCase()).toContain("timeout")
    expect(e2?.wire.transcript.length).toBeGreaterThan(0)
    // The manual event coexists with the failed attempt:
    const manual = e2?.wire.events.find((e) => e.category === "potty" && e.note?.includes("typed manually"))
    expect(manual?.confidence).toBe(1)
  })

  test("entry.wire.events equals the entry's current (non-superseded) event set", () => {
    for (const entry of day.entries) {
      const current = currentEvents().filter((e) => e.entryId === entry.entryId)
      expect(entry.wire.events.length).toBe(current.length)
    }
    expect(supersededEvents().length).toBe(1) // ev-sleep-1
  })
})

describe("month history consistency", () => {
  test("30 days, deterministic metadata", () => {
    expect(month.days.length).toBe(30)
    expect(month.deterministic.seed).toBe(20260915)
    expect(month.window.end).toBe("2026-09-15")
  })

  test("final row is set from the S1 day, never generated (no divergence by construction)", () => {
    const last = month.days.at(-1)
    expect(last?.source).toContain("HOME-C-S1-DAY")
    expect(last?.nightWakings).toBe(1)
    expect(last?.napMinutes).toBe(0) // fact 4: no nap today
    expect(last?.pottySuccesses).toBe(2)
    expect(last?.pottyAccidents).toBe(1)
    expect(last?.captures).toBe(2)
    expect(last?.milestones[0]).toContain("balance bike")
    expect(last?.eventsByCategory).toEqual({ meal: 1, sleep: 1, school: 1, potty: 2, milestone: 1, mood: 1 })
  })
})
