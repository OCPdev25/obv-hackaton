/**
 * Deterministic synthetic September 2026 dataset for Candidate B, seeded
 * through the REAL store pipeline (submitCapture -> extraction double ->
 * review edits -> publish -> correction). Nothing here hand-writes events:
 * every published event in the feed was produced by the same capture path a
 * parent drives, which keeps the demo data and the tests on one code path.
 *
 * All data is synthetic (Polanco household: Dana, Gilbert, Nana Rosa;
 * children Milo 4y and Iris 18m). Anchors: Sep 2 Milo starts new pre-K
 * classroom (Dad), Sep 5 park trip photo (Mom), Sep 8 Milo first balance-bike
 * pedals (Mom), Nana Rosa afternoon-care notes Sep 3 / 10 / 15, Iris nap
 * Sep 12 logged 30 min then corrected to 60 via append-only lineage.
 *
 * Contract conformance notes: the canonical taxonomy has exactly six event
 * categories (potty/meal/sleep/mood/milestone/school) — photos ride on
 * Entry.photoId and health notes stay in the preserved raw transcript
 * (dropped-clause reporting surfaces them) rather than inventing a category.
 */
import { ChildDocument, HouseholdDocument, type ChildDocument as ChildDoc, type HouseholdDocument as HouseholdDoc } from "@journal/domain"
import { Schema } from "effect"
import type { CaregiverPrincipal } from "./auth.js"
import type { HomeBStore, Member } from "./store.js"
import { HOUSEHOLD_TIMEZONE, wallToUtc } from "./time.js"

export const DEMO_MONTH = { year: 2026, month: 9 }

export interface DemoPersona {
  readonly caregiverId: string
  readonly name: string
  readonly role: "parent" | "caregiver"
}

export const HOUSEHOLD_ID = "hh_polanco_demo"
export const CHILD_MILO = "ch_milo_demo"
export const CHILD_IRIS = "ch_iris_demo"

export const PERSONAS = {
  dana: { caregiverId: "cg_dana_demo", name: "Dana Polanco", role: "parent" },
  gilbert: { caregiverId: "cg_gilbert_demo", name: "Gilbert Polanco", role: "parent" },
  rosa: { caregiverId: "cg_rosa_demo", name: "Rosa Marin", role: "caregiver" },
} satisfies Record<string, DemoPersona>

export const OUTSIDER: DemoPersona = { caregiverId: "cg_outsider_demo", name: "Not A Member", role: "caregiver" }

/** Demo persona -> authenticated principal (roster facts attached at the store boundary). */
export function principalOf(persona: DemoPersona): CaregiverPrincipal {
  return { kind: "caregiver", caregiverId: persona.caregiverId, name: persona.name, role: persona.role, householdIds: [HOUSEHOLD_ID] }
}

/** Birth dates as epoch millis (day precision), per ChildFields. */
const MILO_BIRTH_MS = Date.UTC(2022, 5, 14)
const IRIS_BIRTH_MS = Date.UTC(2025, 2, 2)
const ROSTER_CREATED_MS = wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 8, 20, 12, 0)

export function buildHousehold(): HouseholdDoc {
  // Canonical HouseholdDocument is name + createdAt + system fields; membership
  // lives in the members roster (Member[]), children in the children table.
  return Schema.decodeUnknownSync(HouseholdDocument)({
    name: "Polanco Household",
    createdAt: ROSTER_CREATED_MS,
    _id: HOUSEHOLD_ID,
    _creationTime: ROSTER_CREATED_MS,
  })
}

export function buildChildren(): readonly ChildDoc[] {
  return [
    Schema.decodeUnknownSync(ChildDocument)({
      householdId: HOUSEHOLD_ID,
      name: "Milo",
      birthDate: MILO_BIRTH_MS,
      notes: "Pre-K; balance bike; bedtime ~20:00, wake ~06:45",
      createdAt: ROSTER_CREATED_MS,
      _id: CHILD_MILO,
      _creationTime: ROSTER_CREATED_MS,
    }),
    Schema.decodeUnknownSync(ChildDocument)({
      householdId: HOUSEHOLD_ID,
      name: "Iris",
      birthDate: IRIS_BIRTH_MS,
      notes: "18 months; naps 45-90 min; checkup this month",
      createdAt: ROSTER_CREATED_MS,
      _id: CHILD_IRIS,
      _creationTime: ROSTER_CREATED_MS,
    }),
  ]
}

export function buildMembers(): readonly Member[] {
  return [
    { ...PERSONAS.dana, householdIds: [HOUSEHOLD_ID], lastSeenAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 11, 20, 30) },
    { ...PERSONAS.gilbert, householdIds: [HOUSEHOLD_ID], lastSeenAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 12, 7, 45) },
    { ...PERSONAS.rosa, householdIds: [HOUSEHOLD_ID], lastSeenAt: wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, 5, 17, 0) },
  ]
}

/** Household-local wall-clock -> unix ms (the dataset's single time vocabulary). */
function at(day: number, hh: number, mm: number): number {
  return wallToUtc(HOUSEHOLD_TIMEZONE, 2026, 9, day, hh, mm)
}

/** Deterministic capture ids, channel-tagged (text vs the simulated voice path). */
function captureId(day: number, hh: number, mm: number, channel: "text" | "voice"): string {
  const stamp = `${String(day).padStart(2, "0")}-${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}`
  return `cap-2026-09-${stamp}-${channel}`
}

interface RawUtterance {
  readonly day: number
  readonly hh: number
  readonly mm: number
  readonly channel: "text" | "voice"
  readonly author: DemoPersona
  readonly focus: string
  readonly transcript: string
  readonly photoId?: string
}

/**
 * Ordered raw utterances, Sep 1-16. Mixed-topic utterances (two children,
 * two events) are load-bearing: they force per-clause attribution.
 */
const UTTERANCES: readonly RawUtterance[] = [
  { day: 1, hh: 8, mm: 5, channel: "text", author: PERSONAS.dana, focus: CHILD_MILO, transcript: "Milo had oatmeal and banana at 7:30 for breakfast. He was cheerful this morning." },
  { day: 1, hh: 20, mm: 20, channel: "voice", author: PERSONAS.gilbert, focus: CHILD_MILO, transcript: "Milo bedtime routine went fine, lights out at 8." },
  { day: 2, hh: 8, mm: 40, channel: "voice", author: PERSONAS.gilbert, focus: CHILD_MILO, transcript: "Big morning, Milo started his new pre-K classroom today. Drop off at 8. He was a bit shy but ate his whole lunch, pasta and peas.", photoId: "photo-milo-prek-day1" },
  { day: 2, hh: 18, mm: 15, channel: "text", author: PERSONAS.dana, focus: CHILD_IRIS, transcript: "Iris napped 50 minutes after lunch and had yogurt and blueberries at 3." },
  { day: 3, hh: 17, mm: 5, channel: "voice", author: PERSONAS.rosa, focus: CHILD_IRIS, transcript: "Nana Rosa here. Iris had apple slices and crackers at 3:30, and a dry diaper change at 4. She giggled at the bubbles the whole time." },
  { day: 4, hh: 12, mm: 45, channel: "text", author: PERSONAS.dana, focus: CHILD_MILO, transcript: "Milo grilled cheese and apple at 12:15, then a grumpy stretch before quiet time." },
  { day: 5, hh: 11, mm: 20, channel: "voice", author: PERSONAS.dana, focus: CHILD_MILO, transcript: "Park trip with both kids! Milo on the swings, Iris in the bucket swing. Snack was crackers and raisins at 10:45.", photoId: "photo-park-trip-swings" },
  { day: 5, hh: 20, mm: 30, channel: "text", author: PERSONAS.gilbert, focus: CHILD_MILO, transcript: "Milo down at 8:05 after two books." },
  { day: 6, hh: 9, mm: 10, channel: "text", author: PERSONAS.dana, focus: CHILD_IRIS, transcript: "Iris scrambled eggs and toast at 8:40. She said baba for the first time this month, pretty sure.", photoId: "photo-iris-breakface-eggs" },
  { day: 7, hh: 13, mm: 30, channel: "voice", author: PERSONAS.rosa, focus: CHILD_MILO, transcript: "Milo chicken and rice at noon, then nap 45 minutes from 12:45." },
  { day: 8, hh: 17, mm: 40, channel: "voice", author: PERSONAS.dana, focus: CHILD_MILO, transcript: "Milestone! Milo pedaled his balance bike all by himself down the driveway, first time today at 5:15.", photoId: "photo-milo-bike-pedals" },
  { day: 8, hh: 21, mm: 0, channel: "text", author: PERSONAS.gilbert, focus: CHILD_IRIS, transcript: "Iris slept through, down at 7:30, still out at 10." },
  { day: 9, hh: 8, mm: 25, channel: "text", author: PERSONAS.dana, focus: CHILD_MILO, transcript: "Milo waffles and strawberries at 7:50. He asked about his new classroom again, excited." },
  { day: 10, hh: 16, mm: 50, channel: "voice", author: PERSONAS.rosa, focus: CHILD_MILO, transcript: "Nana Rosa: Milo tuna sandwich at 3:45 and we practiced letters, he knows M and O now." },
  { day: 11, hh: 12, mm: 20, channel: "text", author: PERSONAS.dana, focus: CHILD_IRIS, transcript: "Iris napped only 30 minutes, short one. Lunch was soup and avocado at 11:45." },
  { day: 12, hh: 14, mm: 5, channel: "voice", author: PERSONAS.dana, focus: CHILD_IRIS, transcript: "Iris napped 30 minutes starting at 1:30." },
  { day: 12, hh: 19, mm: 35, channel: "text", author: PERSONAS.gilbert, focus: CHILD_MILO, transcript: "Milo mac and cheese and broccoli at 6:15, then a big meltdown when the bath ended, recovered by story time." },
  { day: 13, hh: 10, mm: 15, channel: "text", author: PERSONAS.dana, focus: CHILD_MILO, transcript: "Milo pancakes at 9:45. Potty success at 10:05." },
  { day: 14, hh: 15, mm: 40, channel: "voice", author: PERSONAS.rosa, focus: CHILD_IRIS, transcript: "Iris had a wet diaper at 2, changed. Then she napped 75 minutes from 2:20, deep sleep." },
  { day: 15, hh: 16, mm: 55, channel: "voice", author: PERSONAS.rosa, focus: CHILD_MILO, transcript: "Nana Rosa again. Milo veggie sticks and hummus at 4, and a scrape on his knee at the playground, cleaned and bandaged, minor." },
  { day: 16, hh: 8, mm: 0, channel: "text", author: PERSONAS.dana, focus: CHILD_MILO, transcript: "Milo ate scrambled eggs and toast at 8, then had a total meltdown when the block tower fell, and Iris napped 45 minutes." },
  { day: 16, hh: 8, mm: 30, channel: "text", author: PERSONAS.dana, focus: CHILD_IRIS, transcript: "Can you log that Iris had her checkup today? Oh and Milo refused dinner again." },
]

export interface SeedResult {
  readonly entryCount: number
  readonly publishedCount: number
  readonly draftCount: number
  readonly correctionCount: number
  /** Event id of the corrected Iris nap (Sep 12), for evidence + tests. */
  readonly correctedEventId?: string
  /** Entry id of the mixed-topic Sep 16 capture, for evidence + tests. */
  readonly mixedTopicEntryId?: string
}

/**
 * Seed a fresh store through the real pipeline. Returns counts plus the two
 * narrative ids the evidence doc points at.
 */
export function seedStore(store: HomeBStore): SeedResult {
  let published = 0
  let correctedEventId: string | undefined
  let mixedTopicEntryId: string | undefined

  // Entries through Sep 11 publish silently; Sep 12+ keeps drafts so the
  // review surface has content on first open.
  const autoPublishUntilDay = 11

  for (const u of UTTERANCES) {
    const result = store.submitCapture(principalOf(u.author), {
      captureId: captureId(u.day, u.hh, u.mm, u.channel),
      transcript: u.transcript,
      channel: u.channel,
      capturedAt: at(u.day, u.hh, u.mm),
      timezone: HOUSEHOLD_TIMEZONE,
      focusChildId: u.focus,
      ...(u.photoId !== undefined ? { photoId: u.photoId } : {}),
    })
    if (result._tag !== "Created") {
      throw new Error(`fixture seeding failed at Sep ${u.day} ${u.hh}:${u.mm} (${result._tag})`)
    }
    if (u.day === 16 && u.hh === 8 && u.mm === 0) mixedTopicEntryId = result.entryId

    if (u.day <= autoPublishUntilDay) {
      const publishedResult = store.publishEntry(principalOf(u.author), result.entryId)
      if (publishedResult._tag !== "Published") {
        throw new Error(`fixture publish failed at Sep ${u.day} (${publishedResult._tag})`)
      }
      published += 1
    }
  }

  // Lineage demo: the Sep 12 Iris nap (logged 30 min) is corrected to 60 min
  // via append-only correction — the original row stays intact.
  const napFeed = store.getFeed(principalOf(PERSONAS.dana), { childId: CHILD_IRIS })
  if (napFeed._tag === "Feed") {
    const napEvent = napFeed.published.find(
      (v) => v.category === "sleep" && v.childId === CHILD_IRIS && v.timestamp >= at(12, 0, 0) && v.timestamp < at(12, 23, 59),
    )
    if (napEvent !== undefined) {
      const correction = store.correctEvent(principalOf(PERSONAS.dana), {
        eventId: napEvent.eventId,
        patch: { payload: { minutes: 60 } },
        reason: "Timer log showed 60 minutes; initial dictation said 30.",
      })
      if (correction._tag === "Corrected") correctedEventId = napEvent.eventId
    }
  }

  const counts = store.counts()
  const feed = store.getFeed(principalOf(PERSONAS.dana))
  const draftCount = feed._tag === "Feed" ? feed.drafts.length : 0
  return {
    entryCount: counts.entries,
    publishedCount: published,
    draftCount,
    correctionCount: counts.corrections,
    ...(correctedEventId !== undefined ? { correctedEventId } : {}),
    ...(mixedTopicEntryId !== undefined ? { mixedTopicEntryId } : {}),
  }
}
