import { Schema } from "effect"
import { CaptureId } from "@journal/domain"

import { bannerFor, RecoveryBanner } from "./banner.js"
import { CaptureEvent } from "./events.js"
import { createCapture, reduce } from "./reducer.js"
import { CapturePhase, CaptureRecoveryState, type CaptureRecovery } from "./state.js"
import { InMemoryCaptureStorage } from "./storage.js"

/**
 * Replayable fixture contract + deterministic runner.
 *
 * A fixture is a synthetic capture scenario: an initial capture, an ordered
 * step list (each step is an event or a `reload` cold start), and the
 * expected final projection. Reload steps hydrate state ONLY from what the
 * storage adapter persisted — proving that persisted state alone is
 * sufficient to resume, which is the truthful-UI guarantee.
 */

export const FixtureStep = Schema.Struct({
  event: Schema.optionalKey(CaptureEvent),
  reload: Schema.optionalKey(Schema.Literals([true])),
})
export type FixtureStep = typeof FixtureStep["Type"]

export const FixtureCapture = Schema.Struct({
  captureId: Schema.NonEmptyString,
  authorId: Schema.NonEmptyString,
  at: Schema.Number,
})
export type FixtureCapture = typeof FixtureCapture["Type"]

export const FixtureExpect = Schema.Struct({
  phase: CapturePhase,
  tone: Schema.optionalKey(Schema.Literals(["info", "warning", "success", "neutral"])),
  title: Schema.optionalKey(Schema.String),
  bannerVisible: Schema.optionalKey(Schema.Boolean),
  rawTranscript: Schema.optionalKey(Schema.String),
  attempt: Schema.optionalKey(Schema.Int),
  submissionId: Schema.optionalKey(Schema.String),
  duplicateSubmissionsSuppressed: Schema.optionalKey(Schema.Int),
  staleResultsSuppressed: Schema.optionalKey(Schema.Int),
  hasReceipt: Schema.optionalKey(Schema.Boolean),
  rawCleared: Schema.optionalKey(Schema.Boolean),
  anomalies: Schema.optionalKey(Schema.Int),
  extractionStatus: Schema.optionalKey(Schema.Literals(["pending", "structured", "failed"])),
})
export type FixtureExpect = typeof FixtureExpect["Type"]

export const Fixture = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  description: Schema.String,
  capture: FixtureCapture,
  steps: Schema.Array(FixtureStep),
  expect: FixtureExpect,
})
export type Fixture = typeof Fixture["Type"]

export const TimelineEntry = Schema.Struct({
  kind: Schema.Literals(["event", "reload", "start"]),
  tag: Schema.optionalKey(Schema.String),
  phase: CapturePhase,
  rawLength: Schema.Int,
  attempt: Schema.Int,
})
export type TimelineEntry = typeof TimelineEntry["Type"]

export const Check = Schema.Struct({
  name: Schema.String,
  expected: Schema.String,
  actual: Schema.String,
  pass: Schema.Boolean,
})
export type Check = typeof Check["Type"]

export const FixtureRunResult = Schema.Struct({
  fixtureId: Schema.String,
  passed: Schema.Boolean,
  state: CaptureRecoveryState,
  banner: RecoveryBanner,
  timeline: Schema.Array(TimelineEntry),
  checks: Schema.Array(Check),
})
export type FixtureRunResult = typeof FixtureRunResult["Type"]

const fmt = (value: unknown): string => (value === undefined ? "(absent)" : JSON.stringify(value))

const check = (name: string, expected: unknown, actual: unknown): Check => ({
  name,
  expected: fmt(expected),
  actual: fmt(actual),
  pass: expected === actual,
})

/**
 * Replay a fixture against the pure machine. Throws only on a malformed
 * fixture (a step with neither event nor reload, or a reload with nothing
 * persisted); scenario expectations are returned as checks, not thrown.
 */
export const runFixture = (fixture: Fixture): FixtureRunResult => {
  let state: CaptureRecovery = createCapture({
    ...fixture.capture,
    captureId: Schema.decodeUnknownSync(CaptureId)(fixture.capture.captureId),
  })
  const storage = new InMemoryCaptureStorage()
  storage.save(state)

  const timeline: TimelineEntry[] = [
    { kind: "start", phase: state.phase, rawLength: state.rawTranscript.length, attempt: state.attempt },
  ]

  for (const [index, step] of fixture.steps.entries()) {
    if (step.reload === true) {
      const reloaded = storage.load(state.captureId)
      if (reloaded === undefined) {
        throw new Error(`fixture ${fixture.id} step ${index}: reload with nothing persisted`)
      }
      state = reloaded
      timeline.push({
        kind: "reload",
        phase: state.phase,
        rawLength: state.rawTranscript.length,
        attempt: state.attempt,
      })
      continue
    }
    const event = step.event
    if (event === undefined) {
      throw new Error(`fixture ${fixture.id} step ${index}: step has neither event nor reload`)
    }
    state = reduce(state, event)
    storage.save(state)
    timeline.push({
      kind: "event",
      tag: event._tag,
      phase: state.phase,
      rawLength: state.rawTranscript.length,
      attempt: state.attempt,
    })
  }

  const banner = bannerFor(state)
  const checks: Check[] = [check("phase", fixture.expect.phase, state.phase)]

  if (fixture.expect.tone !== undefined) checks.push(check("tone", fixture.expect.tone, banner.tone))
  if (fixture.expect.title !== undefined) checks.push(check("title", fixture.expect.title, banner.title))
  if (fixture.expect.bannerVisible !== undefined) {
    checks.push(check("bannerVisible", fixture.expect.bannerVisible, banner.visible))
  }
  if (fixture.expect.rawTranscript !== undefined) {
    checks.push(check("rawTranscript", fixture.expect.rawTranscript, state.rawTranscript))
  }
  if (fixture.expect.attempt !== undefined) checks.push(check("attempt", fixture.expect.attempt, state.attempt))
  if (fixture.expect.submissionId !== undefined) {
    checks.push(check("submissionId", fixture.expect.submissionId, state.submissionId))
  }
  if (fixture.expect.duplicateSubmissionsSuppressed !== undefined) {
    checks.push(
      check(
        "duplicateSubmissionsSuppressed",
        fixture.expect.duplicateSubmissionsSuppressed,
        state.duplicateSubmissionsSuppressed ?? 0,
      ),
    )
  }
  if (fixture.expect.staleResultsSuppressed !== undefined) {
    checks.push(
      check("staleResultsSuppressed", fixture.expect.staleResultsSuppressed, state.staleResultsSuppressed ?? 0),
    )
  }
  if (fixture.expect.hasReceipt !== undefined) {
    checks.push(check("hasReceipt", fixture.expect.hasReceipt, state.discardedReceipt !== undefined))
  }
  if (fixture.expect.rawCleared !== undefined) {
    checks.push(check("rawCleared", fixture.expect.rawCleared, state.rawTranscript === ""))
  }
  if (fixture.expect.anomalies !== undefined) {
    checks.push(check("anomalies", fixture.expect.anomalies, state.anomalies?.length ?? 0))
  }
  if (fixture.expect.extractionStatus !== undefined) {
    checks.push(check("extractionStatus", fixture.expect.extractionStatus, state.extractionStatus))
  }

  const passed = checks.every((c) => c.pass)
  return { fixtureId: fixture.id, passed, state, banner, timeline, checks }
}
