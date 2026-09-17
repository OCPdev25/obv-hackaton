/**
 * Deterministic synthetic fixture generator — Parent Home candidate C
 * (handoff-first), rubric art_VyNYOggs v1.0, canonical scenario S1.
 *
 * Ground rule 1: identical scenario S1, identical data. Ground rule 2: the
 * contract vocabulary (art_I2TCG08V v0.2) and repo naming are the authority.
 * Ground rule 4: authored independently — all data here is synthetic; no
 * person, photo, or device data is real.
 *
 * Run: bun scripts/generate-fixtures.ts   (from spikes/home-c-handoff/)
 * Re-running must be a no-op — tests assert committed JSON equals regenerated
 * JSON (determinism proof).
 *
 * Scenario-day derivation: the rubric fixes S1 on a Tuesday. 2026-09-15 is a
 * real Tuesday (asserted below); the 30-day history ends on that day so the
 * month strip and the S1 day are consistent by construction — the last row of
 * month-history is set FROM the S1 data, never generated.
 */
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const OUT = join(import.meta.dir, "..", "fixtures")

/** America/New_York is UTC-4 (EDT) on every date this fixture uses. */
const ET = (month: 8 | 7, day: number, h: number, m = 0): number =>
  Date.UTC(2026, month, day, h + 4, m, 0)

const etLabel = (ms: number): string => {
  const d = new Date(ms)
  const hh = d.getUTCHours() - 4
  const hh2 = hh < 0 ? hh + 24 : hh
  return `${String(hh2).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex")

// ---------------------------------------------------------------------------
// Personas and household (rubric: binding). Repo evaluation fixtures use the
// role-style id `caregiver-1`; we map scenario roles onto that naming style:
// person slugs as authorIds, roles from the grants model.
// ---------------------------------------------------------------------------
const household = {
  householdId: "hh_rivera",
  name: "The Riveras",
  members: [
    { userId: "elena", displayName: "Elena (mom, primary logger)", role: "parent" },
    { userId: "marco", displayName: "Marco (dad, takes over bedtime)", role: "parent" },
    { userId: "rosa", displayName: "Rosa (invited grandmother, weekday afternoons)", role: "caregiver" },
  ],
  child: { childId: "child_sofia", name: "Sofia", ageYears: 3 },
} as const

// ---------------------------------------------------------------------------
// S1-A — capture with interruption, Tuesday 07:38, Elena, voice.
// Interruption is a CAPTURE-SESSION fact, never transcript bytes
// (byte-faithfulness, art_rBKvvzIa §2.1): the transcript is exactly what was
// dictated; the call inserted no bytes.
// ---------------------------------------------------------------------------
const E1_TOPICS = [
  { text: "Breakfast was half the oatmeal, no milk.", mode: "voice" },
  { text: "She woke at eleven last night and was up until twelve thirty.", mode: "voice" },
  { text: "Drop-off at preschool was hard — about five minutes of crying, then she settled.", mode: "voice" },
  { text: "Two potty successes and one accident at home before breakfast.", mode: "text" },
  { text: "She finally pedaled the balance bike halfway down the block.", mode: "text" },
  { text: "She was upset again after quiet time.", mode: "text" },
] as const

const E1_TRANSCRIPT = E1_TOPICS.map((t) => t.text).join(" ")
const topicExcerpt = (i: number) => {
  const text = E1_TOPICS[i]!.text
  const start = E1_TRANSCRIPT.indexOf(text)
  return { start, end: start + text.length }
}

const E2_TRANSCRIPT =
  "Follow-up from this morning — she had the one accident at home before breakfast. Wet underwear, I changed her clothes right away."

// Timestamps (ET labels are the display truth; ms is the wire truth).
const T = {
  nightWakingStart: ET(8, 14, 23, 0), // Sep 14 23:00 ET
  nightWakingEnd: ET(8, 15, 0, 30), // Sep 15 00:30 ET
  pottySuccesses: ET(8, 15, 6, 50),
  pottyAccident: ET(8, 15, 6, 55),
  breakfast: ET(8, 15, 7, 10),
  bike: ET(8, 15, 7, 25),
  dropoff: ET(8, 15, 7, 30),
  quietTimeYesterday: ET(8, 14, 15, 30),
  misreadNapStart: ET(8, 14, 13, 15), // the extractor's "afternoon nap"
  e1Created: ET(8, 15, 7, 38),
  e1Interrupted: ET(8, 15, 7, 41), // after the third topic — preschool calls
  attempt0Start: ET(8, 15, 7, 39),
  attempt0End: ET(8, 15, 7, 42), // completed server-side during the call
  s1bCorrect: ET(8, 15, 7, 44),
  s1bRestrict: ET(8, 15, 7, 45),
  s1bPhoto: ET(8, 15, 7, 46),
  e1Resumed: ET(8, 15, 7, 51), // 10 minutes later, typing while holding Sofia
  attempt1Start: ET(8, 15, 7, 51),
  attempt1End: ET(8, 15, 7, 53),
  e1Published: ET(8, 15, 7, 55),
  clarifyAsked: ET(8, 15, 7, 53),
  clarifyAnswered: ET(8, 15, 7, 54),
  e2Created: ET(8, 15, 8, 5), // S1-D failed state
  e2AttemptStart: ET(8, 15, 8, 5),
  e2AttemptEnd: ET(8, 15, 8, 6),
  e2Manual: ET(8, 15, 8, 8),
  e2Published: ET(8, 15, 8, 9),
  marcoOpened: ET(8, 15, 18, 10), // S1-E
  marcoAsked: ET(8, 15, 18, 11),
  marcoConfirmed: ET(8, 15, 18, 12),
  rosaOpened: ET(8, 16, 14, 0), // S1-F, next day
} as const

// ---------------------------------------------------------------------------
// Wire events (contract v0.2 shapes) + presentation projection.
// ---------------------------------------------------------------------------
type WireEvent = {
  _tag: "Event"
  category: "potty" | "meal" | "sleep" | "mood" | "milestone" | "school"
  occurredAt: number
  quantity?: { value: number; unit?: string }
  confidence: number
  authorId: string
  note?: string
}

const wire = (e: WireEvent): WireEvent => {
  const out: Record<string, unknown> = { ...e }
  if (out.quantity === undefined) delete out.quantity // absent, never null
  if (out.note === undefined) delete out.note
  return out as WireEvent
}

const events = [
  {
    eventId: "ev-sleep-1",
    entryId: "entry-e1",
    audienceScope: "household",
    supersededBy: "ev-sleep-2",
    sourceExcerpt: topicExcerpt(1),
    wire: wire({
      _tag: "Event",
      category: "sleep",
      occurredAt: T.misreadNapStart,
      confidence: 0.61,
      authorId: "elena",
      note: "afternoon nap (extraction guess — misread)",
    }),
  },
  {
    eventId: "ev-sleep-2",
    entryId: "entry-e1",
    audienceScope: "household",
    corrects: "ev-sleep-1",
    endAt: T.nightWakingEnd,
    sourceExcerpt: topicExcerpt(1),
    wire: wire({
      _tag: "Event",
      category: "sleep",
      occurredAt: T.nightWakingStart,
      confidence: 1, // caregiver-confirmed (S1-B correction, 07:44) — pinned
      authorId: "elena",
      note: "night waking 23:00–00:30 — corrected from the afternoon-nap misread",
    }),
  },
  {
    eventId: "ev-meal-1",
    entryId: "entry-e1",
    audienceScope: "household",
    sourceExcerpt: topicExcerpt(0),
    photoId: "media/breakfast-photo.png",
    wire: wire({
      _tag: "Event",
      category: "meal",
      occurredAt: T.breakfast,
      quantity: { value: 0.5, unit: "serving" },
      confidence: 0.88,
      authorId: "elena",
      note: "half the oatmeal, refused milk",
    }),
  },
  {
    eventId: "ev-school-1",
    entryId: "entry-e1",
    audienceScope: "parents", // S1-B restriction at 07:45
    sourceExcerpt: topicExcerpt(2),
    wire: wire({
      _tag: "Event",
      category: "school",
      occurredAt: T.dropoff,
      confidence: 0.83,
      authorId: "elena",
      note: "hard drop-off — about five minutes of crying, then she settled",
    }),
  },
  {
    eventId: "ev-potty-1",
    entryId: "entry-e1",
    audienceScope: "household",
    sourceExcerpt: topicExcerpt(3),
    wire: wire({
      _tag: "Event",
      category: "potty",
      occurredAt: T.pottySuccesses,
      quantity: { value: 2, unit: "successes" },
      confidence: 0.9,
      authorId: "elena",
      note: "two successes before breakfast",
    }),
  },
  {
    eventId: "ev-milestone-1",
    entryId: "entry-e1",
    audienceScope: "household",
    sourceExcerpt: topicExcerpt(4),
    wire: wire({
      _tag: "Event",
      category: "milestone",
      occurredAt: T.bike,
      confidence: 0.88,
      authorId: "elena",
      note: "pedaled the balance bike halfway down the block — first time",
    }),
  },
  {
    eventId: "ev-mood-1",
    entryId: "entry-e1",
    audienceScope: "household",
    sourceExcerpt: topicExcerpt(5),
    wire: wire({
      _tag: "Event",
      category: "mood",
      occurredAt: T.quietTimeYesterday,
      confidence: 1, // confirmed through the one clarification exchange
      authorId: "elena",
      note: "teary after preschool quiet time yesterday; wanted to keep playing; calmed quickly",
    }),
  },
  {
    eventId: "ev-potty-2",
    entryId: "entry-e2",
    audienceScope: "household",
    sourceExcerpt: { start: 0, end: E2_TRANSCRIPT.length },
    wire: wire({
      _tag: "Event",
      category: "potty",
      occurredAt: T.pottyAccident,
      quantity: { value: 1, unit: "accident" },
      confidence: 1, // typed manually by Elena after the failed attempt (S1-D)
      authorId: "elena",
      note: "one accident at home before breakfast — typed manually after extraction timed out",
    }),
  },
]

// ---------------------------------------------------------------------------
// Entries (contract v0.2 wire) + capture sessions (envelope semantics).
// The contract Entry.events carries the CURRENT event set per entry.
// ---------------------------------------------------------------------------
const e1Current = events.filter((e) => e.entryId === "entry-e1" && e.eventId !== "ev-sleep-1")
const e2Current = events.filter((e) => e.entryId === "entry-e2")

const entries = [
  {
    captureId: "cap-e1-morning",
    entryId: "entry-e1",
    wire: {
      _tag: "Entry",
      transcript: E1_TRANSCRIPT,
      authorId: "elena",
      createdAt: T.e1Created,
      visibility: "published",
      events: e1Current.map((e) => e.wire),
    },
    capture: {
      mode: "mixed",
      voiceTopics: [0, 1, 2],
      typedTopics: [3, 4, 5],
      interruptedAt: T.e1Interrupted,
      resumedAt: T.e1Resumed,
      interruptionNote:
        "Incoming call from the preschool after the third topic; Elena returned 10 minutes later and finished by typing while holding Sofia (quiet-input path). Server extraction (attempt 0) was NOT cancelled by the disconnect — envelope rule (a).",
      attempts: [
        {
          attempt: 0,
          startedAt: T.attempt0Start,
          finishedAt: T.attempt0End,
          outcome: "succeeded",
          note: "ran server-side over the partial transcript (topics 1–3) while the client was interrupted",
        },
        {
          attempt: 1,
          startedAt: T.attempt1Start,
          finishedAt: T.attempt1End,
          outcome: "succeeded",
          note: "full transcript after typed completion; stale attempt 0 discarded, never merged (rule 2); the extractor again proposed an afternoon nap — suppressed because the caregiver-confirmed correction is pinned (art_rBKvvzIa §3.2)",
          suppressedConflicts: [
            { category: "sleep", reason: "caregiver-confirmed correction ev-sleep-2 is pinned; rerun never downgrades it" },
          ],
        },
      ],
      clarification: {
        question:
          "\"She was upset again after quiet time\" — when was that, and what happened?",
        answer:
          "Yesterday at preschool, after quiet time — she got teary because she wanted to keep playing; she calmed after a few minutes.",
        askedAt: T.clarifyAsked,
        answeredAt: T.clarifyAnswered,
      },
      visibilityTimeline: [
        { at: T.e1Created, state: "draft" },
        { at: T.e1Published, state: "published" },
      ],
    },
  },
  {
    captureId: "cap-e2-accident",
    entryId: "entry-e2",
    wire: {
      _tag: "Entry",
      transcript: E2_TRANSCRIPT,
      authorId: "elena",
      createdAt: T.e2Created,
      visibility: "published",
      events: e2Current.map((e) => e.wire),
    },
    capture: {
      mode: "text",
      voiceTopics: [],
      typedTopics: [0],
      attempts: [
        {
          attempt: 0,
          startedAt: T.e2AttemptStart,
          finishedAt: T.e2AttemptEnd,
          outcome: "failed",
          failureReason: "Timeout — provider/network timeout (retryable)",
          note: "visible failed state offered retry; Elena typed the event manually instead. The failed attempt stays in lineage; the raw transcript is preserved — no data loss (S1-D).",
        },
      ],
      visibilityTimeline: [
        { at: T.e2Created, state: "draft" },
        { at: T.e2Published, state: "published" },
      ],
    },
  },
]

const audienceRestrictions = [
  {
    eventId: "ev-school-1",
    scope: "parents",
    grantedBy: "elena",
    grantedAt: T.s1bRestrict,
    note: "S1-B: restrict the drop-off meltdown event to parents only, per the grants model",
  },
]

const reviewSessions = [
  {
    at: T.s1bCorrect,
    entryId: "entry-e1",
    seenState: "draft",
    caption:
      "S1-B (07:44): extraction finished server-side during the call; Elena inspects the draft, corrects the nap misread with a preview, restricts the drop-off event, and attaches the breakfast photo. Full review-card flow = slots 11–14 (out of scope) — this is the one representative doorway.",
    actions: [
      { kind: "correct", at: T.s1bCorrect, detail: "ev-sleep-1 (afternoon nap, 0.61) → ev-sleep-2 (night waking 23:00–00:30, confirmed 1.0); preview shown before confirm" },
      { kind: "restrict-audience", at: T.s1bRestrict, detail: "ev-school-1 → parents only" },
      { kind: "attach-photo", at: T.s1bPhoto, detail: "breakfast photo attached to ev-meal-1" },
    ],
  },
]

const readOnlyQuestions = [
  {
    question: "Did she nap?",
    askedBy: "marco",
    askedAt: T.marcoAsked,
    answer:
      "No — no nap today. The night waking (23:00–00:30) was first misread as an afternoon nap; Elena corrected it at 07:44. With no nap, expect an early meltdown and consider an early bedtime.",
    sources: [
      { kind: "correction", ref: "ev-sleep-2", excerpt: "night waking 23:00–00:30 — corrected from the afternoon-nap misread" },
      { kind: "event", ref: "ev-sleep-2" },
      { kind: "fixture", ref: "absence: no nap event during 2026-09-15 daytime" },
    ],
  },
]

const takeover = {
  confirmedBy: "marco",
  confirmedAt: T.marcoConfirmed,
  plan: {
    note: "Expect an early meltdown; consider an early bedtime (no nap today).",
    basis: ["ev-sleep-2"],
  },
  fiveFacts: [
    {
      headline: "Night waking 23:00–00:30 last night",
      detail: "Corrected at 07:44 — extraction first read it as an afternoon nap.",
      refs: [{ kind: "event", ref: "ev-sleep-2" }, { kind: "correction", ref: "ev-sleep-1 → ev-sleep-2" }],
    },
    {
      headline: "Ate half the oatmeal, refused milk",
      refs: [{ kind: "event", ref: "ev-meal-1" }, { kind: "transcript-excerpt", ref: "entry-e1", excerpt: E1_TOPICS[0]!.text }],
    },
    {
      headline: "Hard drop-off — settled after about five minutes",
      detail: "Parents only (Elena restricted this at 07:45) — Marco sees it; Rosa does not.",
      refs: [{ kind: "event", ref: "ev-school-1" }],
    },
    {
      headline: "No nap today — expect an early meltdown, consider an early bedtime",
      detail: "Reads from the correction: what looked like a nap was the night waking.",
      refs: [{ kind: "correction", ref: "ev-sleep-1 → ev-sleep-2" }, { kind: "fixture", ref: "absence: no nap event 2026-09-15 daytime" }],
    },
    {
      headline: "Pedaled the balance bike halfway down the block — worth celebrating",
      refs: [{ kind: "event", ref: "ev-milestone-1" }, { kind: "transcript-excerpt", ref: "entry-e1", excerpt: E1_TOPICS[4]!.text }],
    },
  ],
  pendingItems: [
    {
      label: "Clarification answered",
      detail: "\"upset again after quiet time\" — Elena confirmed: teary after preschool quiet time yesterday; calmed quickly.",
      state: "resolved",
      at: T.clarifyAnswered,
    },
    {
      label: "Failed extraction resolved by hand",
      detail: "Potty-accident event timed out on a provider timeout; Elena typed it manually. Failed attempt visible in lineage; nothing lost.",
      state: "resolved",
      at: T.e2Manual,
    },
  ],
}

const s1Day = {
  fixtureId: "HOME-C-S1-DAY",
  scenario: "Canonical scenario S1 — rubric art_VyNYOggs v1.0 (binding)",
  candidate: "3 — handoff-first (direct worker assignment, thread th_wkbO7wK7, root todo_IpkisZRm)",
  timezone: "America/New_York",
  dayLabel: "Tuesday",
  day: "2026-09-15",
  renderedMoment: "S1-E 18:10 — Marco opens cold, takeover brief is the home",
  household,
  entries,
  events,
  audienceRestrictions,
  reviewSessions,
  readOnlyQuestions,
  takeover,
}

// ---------------------------------------------------------------------------
// 30-day month history — deterministic, seeded; last day set FROM S1 data.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MILESTONE_POOL = [
  "told a full story about her day",
  "washed hands without being asked",
  "first two-wheel scooter attempt",
  "used the big slide alone",
  "built a tower of ten blocks",
  "called grandma Rosa by herself",
]

const monthDays: Array<Record<string, unknown>> = []
const rand = mulberry32(20260915)
let milestoneCursor = 0
for (let i = 0; i < 30; i++) {
  const dayMs = Date.UTC(2026, 7, 17 + i) // Aug 17 + i days
  const d = new Date(dayMs)
  const date = d.toISOString().slice(0, 10)
  const weekday = d.getUTCDay()
  const dayLabel = WEEKDAYS[weekday]!
  const isSep15 = date === "2026-09-15"

  if (isSep15) {
    // Last row: set FROM the S1 fixture — never generated (consistency by
    // construction; the evaluator compares candidates on this row).
    monthDays.push({
      date,
      dayLabel,
      captures: 2,
      eventsByCategory: { meal: 1, sleep: 1, school: 1, potty: 2, milestone: 1, mood: 1 },
      nightWakings: 1,
      napMinutes: 0,
      pottySuccesses: 2,
      pottyAccidents: 1,
      milestones: ["balance bike — pedaled half a block for the first time"],
      coverage: "partial",
      gapNotes: ["day in progress — captures through 08:09"],
      source: "set from HOME-C-S1-DAY (not generated)",
    })
    continue
  }

  const preschool = weekday >= 1 && weekday <= 5
  const noCapture = date === "2026-08-23" || date === "2026-09-06" // Sundays out
  if (noCapture) {
    monthDays.push({
      date,
      dayLabel,
      captures: 0,
      eventsByCategory: {},
      nightWakings: 0,
      napMinutes: 0,
      pottySuccesses: 0,
      pottyAccidents: 0,
      milestones: [],
      coverage: "none",
      gapNotes: ["no capture — family day out"],
      source: "generated",
    })
    continue
  }

  const captures = 1 + Math.floor(rand() * 3)
  const napMinutes = rand() < 0.75 ? 45 + 15 * Math.floor(rand() * 4) : 0
  const pottySuccesses = 2 + Math.floor(rand() * 4)
  const pottyAccidents = rand() < 0.35 ? 1 + Math.floor(rand() * 2) : 0
  const nightWakings = rand() < 0.18 ? 1 : 0
  const hasMilestone = rand() < 0.14
  const partial = !preschool ? rand() < 0.2 : rand() < 0.3
  const eventsByCategory: Record<string, number> = {
    meal: 2 + Math.floor(rand() * 2),
    sleep: 1 + nightWakings + (napMinutes > 0 ? 1 : 0),
    potty: (1 + Math.floor(rand() * 2)) + (pottyAccidents > 0 ? 1 : 0),
    mood: rand() < 0.5 ? 1 : 0,
    school: preschool ? 1 : 0,
    milestone: hasMilestone ? 1 : 0,
  }
  const gapNotes = partial ? ["no evening capture"] : []
  monthDays.push({
    date,
    dayLabel,
    captures,
    eventsByCategory,
    nightWakings,
    napMinutes,
    pottySuccesses,
    pottyAccidents,
    milestones: hasMilestone ? [MILESTONE_POOL[milestoneCursor++ % MILESTONE_POOL.length]!] : [],
    coverage: partial ? "partial" : "full",
    gapNotes,
    source: "generated",
  })
}

const monthHistory = {
  fixtureId: "HOME-C-MONTH-HISTORY",
  window: { start: "2026-08-17", end: "2026-09-15", days: 30 },
  deterministic: { seed: 20260915, generator: "scripts/generate-fixtures.ts", prng: "mulberry32" },
  note: "The final row is set from the S1 day so month history and scenario can never diverge.",
  days: monthDays,
}

// ---------------------------------------------------------------------------
// Media + manifest.
// ---------------------------------------------------------------------------
const BREAKFAST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
const pngBytes = Buffer.from(BREAKFAST_PNG_BASE64, "base64")
const pngSha = createHash("sha256").update(pngBytes).digest("hex")

const manifest = {
  manifestVersion: "0.1.0",
  rubric: {
    artifactId: "art_VyNYOggs",
    version: "1.0 (frozen 2026-09-17)",
    candidate: "3 — handoff-first",
    registryTask: "todo_wZdouzJU (folio version superseded by direct worker assignment)",
    executingThread: "th_wkbO7wK7",
    rootTask: "todo_IpkisZRm",
  },
  contract: {
    artifactId: "art_I2TCG08V",
    version: "0.2",
    effectPin: "4.0.0-rc.115",
    note: "Wire shapes follow the contract document (and the evaluation corpus adapter); the merged packages/domain implementation diverges (timestamp/payload vs occurredAt/quantity) — flagged in the evidence document.",
  },
  scenario: { scenarioId: "S1", personas: ["elena", "marco", "rosa", "sofia"], binding: true },
  fixtures: [
    { id: "HOME-C-S1-DAY", file: "s1-day.json", kind: "scenario", beats: ["S1-A", "S1-B", "S1-C", "S1-D", "S1-E", "S1-F"] },
    { id: "HOME-C-MONTH-HISTORY", file: "month-history.json", kind: "history", days: 30 },
    { id: "HOME-C-BREAKFAST-PHOTO", file: "media/breakfast-photo.png", kind: "media", bytes: pngBytes.length, sha256: pngSha, note: "synthetic placeholder image (1×1 PNG)" },
  ],
  transcripts: {
    sha256: { "entry-e1": sha256(E1_TRANSCRIPT), "entry-e2": sha256(E2_TRANSCRIPT) },
    byteFidelityRule: "transcript bytes are exactly what was dictated; interruption markers are session facts, never transcript bytes",
  },
  allSynthetic: true,
}

// ---------------------------------------------------------------------------
// Emit.
// ---------------------------------------------------------------------------
const dayCheck = new Date(ET(8, 15, 7, 38)).toUTCString().slice(0, 3)
if (dayCheck !== "Tue") throw new Error(`scenario day must be Tuesday, got ${dayCheck}`)

const write = (rel: string, content: string | Buffer): void => {
  const p = join(OUT, rel)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content)
  console.log(`wrote ${rel} (${typeof content === "string" ? content.length : content.length} bytes)`)
}

write("s1-day.json", `${JSON.stringify(s1Day, null, 2)}\n`)
write("month-history.json", `${JSON.stringify(monthHistory, null, 2)}\n`)
write("media/breakfast-photo.png", pngBytes)
write("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`\nscenario-day sanity: 2026-09-15 is Tuesday (dayCheck=${dayCheck}); ET label for e1Created: ${etLabel(T.e1Created)} (expect 07:38)`)
console.log(`night waking: ${etLabel(T.nightWakingStart)} → ${etLabel(T.nightWakingEnd)} (expect 23:00 → 00:30)`)
