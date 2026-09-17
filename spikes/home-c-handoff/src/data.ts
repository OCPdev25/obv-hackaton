/**
 * Typed data layer — loads the synthetic S1 fixtures and decodes EVERYTHING
 * through Effect v4 schemas: contract wire shapes (art_I2TCG08V v0.2) plus
 * presentation projections defined here. Decode-through is the contract's
 * first rule ("never hand-roll a second domain model") — the prototype holds
 * itself to it for its own view layer too.
 *
 * The merged packages/domain Event diverges from the contract document
 * (timestamp/payload vs occurredAt/quantity — see src/contract.ts); this file
 * follows the contract document, matching the evaluation corpus adapter.
 */
import { Schema } from "effect"

import { EventFields, EntryFields, EventCategory, type Event, type Entry } from "./contract"
import type { AudienceRestriction, Cue, HouseholdMember, ReadOnlyAnswer } from "./grants"
import { eventCue, canSeeEntry } from "./grants"

import dayJson from "../fixtures/s1-day.json"
import monthJson from "../fixtures/month-history.json"

const RoleLiteral = Schema.Literals(["parent", "caregiver"])
const ScopeLiteral = Schema.Literals(["household", "parents"])

/** Presentation projection of a contract Event plus prototype fields. */
export const EventView = Schema.Struct({
  eventId: Schema.NonEmptyString,
  entryId: Schema.NonEmptyString,
  audienceScope: ScopeLiteral,
  /** Sleep spans: night waking end (prototype field, derived content). */
  endAt: Schema.optional(Schema.DateFromMillis),
  corrects: Schema.optional(Schema.NonEmptyString),
  supersededBy: Schema.optional(Schema.NonEmptyString),
  /** Character offsets into the source transcript (S1-C source links). */
  sourceExcerpt: Schema.Struct({ start: Schema.Int, end: Schema.Int }),
  photoId: Schema.optional(Schema.String),
  /** Contract v0.2 Event — decodes through the canonical schema. */
  wire: Schema.Struct(EventFields),
})
export type EventView = typeof EventView["Type"]

const Attempt = Schema.Struct({
  attempt: Schema.Int,
  startedAt: Schema.DateFromMillis,
  finishedAt: Schema.optional(Schema.DateFromMillis),
  outcome: Schema.Literals(["succeeded", "failed"]),
  failureReason: Schema.optionalKey(Schema.NonEmptyString),
  note: Schema.optionalKey(Schema.NonEmptyString),
  suppressedConflicts: Schema.optional(
    Schema.Array(Schema.Struct({ category: EventCategory, reason: Schema.NonEmptyString })),
  ),
})

const CaptureSession = Schema.Struct({
  mode: Schema.Literals(["voice", "text", "mixed"]),
  voiceTopics: Schema.Array(Schema.Int),
  typedTopics: Schema.Array(Schema.Int),
  interruptedAt: Schema.optional(Schema.DateFromMillis),
  resumedAt: Schema.optional(Schema.DateFromMillis),
  interruptionNote: Schema.optionalKey(Schema.NonEmptyString),
  attempts: Schema.Array(Attempt),
  clarification: Schema.optional(
    Schema.Struct({
      question: Schema.NonEmptyString,
      answer: Schema.NonEmptyString,
      askedAt: Schema.DateFromMillis,
      answeredAt: Schema.DateFromMillis,
    }),
  ),
  visibilityTimeline: Schema.Array(
    Schema.Struct({ at: Schema.DateFromMillis, state: Schema.Literals(["draft", "published"]) }),
  ),
})

export const EntryView = Schema.Struct({
  captureId: Schema.NonEmptyString,
  entryId: Schema.NonEmptyString,
  /** Contract v0.2 Entry — decodes through the canonical schema. */
  wire: Schema.Struct(EntryFields),
  capture: CaptureSession,
})
export type EntryView = typeof EntryView["Type"]

const Ref = Schema.Struct({
  kind: Schema.Literals(["transcript-excerpt", "event", "correction", "fixture"]),
  ref: Schema.NonEmptyString,
  excerpt: Schema.optional(Schema.NonEmptyString),
})

const Takeover = Schema.Struct({
  confirmedBy: Schema.NonEmptyString,
  confirmedAt: Schema.DateFromMillis,
  plan: Schema.Struct({ note: Schema.NonEmptyString, basis: Schema.Array(Schema.NonEmptyString) }),
  fiveFacts: Schema.Array(
    Schema.Struct({
      headline: Schema.NonEmptyString,
      detail: Schema.optionalKey(Schema.NonEmptyString),
      refs: Schema.Array(Ref),
    }),
  ),
  pendingItems: Schema.Array(
    Schema.Struct({
      label: Schema.NonEmptyString,
      detail: Schema.NonEmptyString,
      state: Schema.Literals(["open", "resolved"]),
      at: Schema.DateFromMillis,
    }),
  ),
})

export const Day = Schema.Struct({
  fixtureId: Schema.NonEmptyString,
  scenario: Schema.NonEmptyString,
  candidate: Schema.NonEmptyString,
  timezone: Schema.NonEmptyString,
  dayLabel: Schema.NonEmptyString,
  day: Schema.NonEmptyString,
  renderedMoment: Schema.NonEmptyString,
  household: Schema.Struct({
    householdId: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    members: Schema.Array(
      Schema.Struct({ userId: Schema.NonEmptyString, displayName: Schema.NonEmptyString, role: RoleLiteral }),
    ),
    child: Schema.Struct({ childId: Schema.NonEmptyString, name: Schema.NonEmptyString, ageYears: Schema.Int }),
  }),
  entries: Schema.Array(EntryView),
  events: Schema.Array(EventView),
  audienceRestrictions: Schema.Array(
    Schema.Struct({
      eventId: Schema.NonEmptyString,
      scope: ScopeLiteral,
      grantedBy: Schema.NonEmptyString,
      grantedAt: Schema.DateFromMillis,
      note: Schema.optionalKey(Schema.NonEmptyString),
    }),
  ),
  reviewSessions: Schema.Array(
    Schema.Struct({
      at: Schema.DateFromMillis,
      entryId: Schema.NonEmptyString,
      seenState: Schema.Literals(["draft", "published"]),
      caption: Schema.NonEmptyString,
      actions: Schema.Array(
        Schema.Struct({ kind: Schema.NonEmptyString, at: Schema.DateFromMillis, detail: Schema.NonEmptyString }),
      ),
    }),
  ),
  readOnlyQuestions: Schema.Array(
    Schema.Struct({
      question: Schema.NonEmptyString,
      askedBy: Schema.NonEmptyString,
      askedAt: Schema.DateFromMillis,
      answer: Schema.NonEmptyString,
      sources: Schema.Array(Ref),
    }),
  ),
  takeover: Takeover,
})
export type Day = typeof Day["Type"]

export const MonthDay = Schema.Struct({
  date: Schema.NonEmptyString,
  dayLabel: Schema.NonEmptyString,
  captures: Schema.Int,
  eventsByCategory: Schema.Record(Schema.String, Schema.Int),
  nightWakings: Schema.Int,
  napMinutes: Schema.Int,
  pottySuccesses: Schema.Int,
  pottyAccidents: Schema.Int,
  milestones: Schema.Array(Schema.NonEmptyString),
  coverage: Schema.Literals(["full", "partial", "none"]),
  gapNotes: Schema.Array(Schema.NonEmptyString),
  source: Schema.NonEmptyString,
})
export type MonthDay = typeof MonthDay["Type"]

export const Month = Schema.Struct({
  fixtureId: Schema.NonEmptyString,
  window: Schema.Struct({ start: Schema.NonEmptyString, end: Schema.NonEmptyString, days: Schema.Int }),
  deterministic: Schema.Struct({
    seed: Schema.Int,
    generator: Schema.NonEmptyString,
    prng: Schema.NonEmptyString,
  }),
  note: Schema.NonEmptyString,
  days: Schema.Array(MonthDay),
})
export type Month = typeof Month["Type"]

/** Decode at module load — a fixture that fails the contract fails loud. */
export const day: Day = Schema.decodeUnknownSync(Day)(dayJson)
export const month: Month = Schema.decodeUnknownSync(Month)(monthJson)

// ---------------------------------------------------------------------------
// Lookups and viewer filtering.
// ---------------------------------------------------------------------------
export const memberByUserId = (userId: string): HouseholdMember | undefined =>
  day.household.members.find((m) => m.userId === userId)

export const entryById = (entryId: string): EntryView | undefined =>
  day.entries.find((e) => e.entryId === entryId)

export const eventById = (eventId: string): EventView | undefined =>
  day.events.find((e) => e.eventId === eventId)

/** Current = not superseded by a correction (append-only lineage). */
export const currentEvents = (): Array<EventView> => day.events.filter((e) => e.supersededBy === undefined)

export const supersededEvents = (): Array<EventView> => day.events.filter((e) => e.supersededBy !== undefined)

/** Decoded wire → grants-layer shape (grantedAt as unix ms; note carried). */
const restrictions: Array<AudienceRestriction> = day.audienceRestrictions.map((r) => ({
  eventId: r.eventId,
  scope: r.scope,
  grantedBy: r.grantedBy,
  grantedAt: r.grantedAt.getTime(),
  note: r.note,
}))

export const restrictionFor = (eventId: string): AudienceRestriction | undefined =>
  restrictions.find((r) => r.eventId === eventId)

export const cueFor = (member: HouseholdMember | undefined, event: EventView): Cue => {
  if (member === undefined) return "locked" // fail-closed for unknown viewers
  const entry = entryById(event.entryId)
  if (entry === undefined) return "locked"
  return eventCue(member, entry.wire, restrictionFor(event.eventId))
}

export const feedForMember = (userId: string): Array<{ event: EventView; cue: Cue }> => {
  const member = memberByUserId(userId)
  if (member === undefined) return []
  return day.events
    .map((event) => ({ event, cue: cueFor(member, event) }))
    .filter((x) => x.cue === "visible" || (x.cue === "locked" && member.role === "caregiver"))
    .sort((a, b) => (a.event.wire.occurredAt as unknown as number) - (b.event.wire.occurredAt as unknown as number))
}

/** Draft-visibility rule chosen for this prototype (see grants.ts). */
export const draftVisibleTo = (member: HouseholdMember, entry: EntryView): boolean =>
  canSeeEntry(member, entry.wire)

/** Fixed-offset ET clock label for prototype determinism (EDT = UTC−4). */
export const etTime = (date: Date): string => {
  const hh = date.getUTCHours() - 4
  const label = hh < 0 ? hh + 24 : hh
  return `${String(label).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`
}

export const eventTime = (event: EventView): string => etTime(event.wire.occurredAt)

export const CATEGORY_GLYPH: Record<string, string> = {
  potty: "🚽",
  meal: "🍽",
  sleep: "😴",
  mood: "💛",
  milestone: "🌟",
  school: "🎒",
}

export const confidenceLabel = (event: Event): string =>
  event.confidence === 1 ? "Confirmed" : `AI guess ${event.confidence.toFixed(2)}`

/** Transcript excerpt for a source link (S1-C): verbatim slice, no reflow. */
export const excerptFor = (event: EventView): string => {
  const entry = entryById(event.entryId)
  if (entry === undefined) return ""
  return entry.wire.transcript.slice(event.sourceExcerpt.start, event.sourceExcerpt.end)
}
