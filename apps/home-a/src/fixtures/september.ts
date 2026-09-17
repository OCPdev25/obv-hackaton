/**
 * Synthetic month history — September 1–16, 2026 (Polanco Household).
 *
 * Built THROUGH the real pipeline: every entry is captured (raw transcript
 * preserved verbatim), its proposals reviewed-confirmed, and published —
 * exactly the flow a live caregiver drives — so seeded history is
 * schema-decoded, provenance-linked, and receipted by construction. One seeded
 * post-publish correction (Iris's Sep 12 nap 30 → 60 minutes) exercises
 * append-only lineage. 100% synthetic; no real user data.
 */
import { JournalStore, type Audience, type EventEdit } from "../journal/store"
import { at, HOUSEHOLD_SEED, memberPrincipal } from "./household"

interface SeedCapture {
  readonly captureId: string
  readonly memberId: string
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly transcript: string
  readonly photoId?: string
  readonly audience?: Audience
}

/** The month's raw captures — voice-utterance style, mixed-topic, verbatim. */
const SEED_CAPTURES: readonly SeedCapture[] = [
  // Sep 1
  { captureId: "seed_sep01_breakfast", memberId: "mem_dana", day: 1, hour: 7, minute: 55,
    transcript: "Milo had oatmeal and bananas for breakfast at 7:45." },
  { captureId: "seed_sep01_diaper", memberId: "mem_dana", day: 1, hour: 8, minute: 20,
    transcript: "Iris is soaked through again — third diaper change before 8, this one was a poop." },
  { captureId: "seed_sep01_bedtime", memberId: "mem_dana", day: 1, hour: 19, minute: 58,
    transcript: "Milo went down at 8 after two books, and Iris finally crashed at 7:40." },
  // Sep 2 — anchor: Milo starts the new pre-K classroom (Dad)
  { captureId: "seed_sep02_preschool", memberId: "mem_gilbert", day: 2, hour: 8, minute: 25,
    transcript: "Milo started in the new pre-K classroom today. He was nervous at drop-off but his teacher says he settled right in by circle time." },
  { captureId: "seed_sep02_dinner", memberId: "mem_gilbert", day: 2, hour: 17, minute: 45,
    transcript: "Milo told me all about his new classroom over dinner — he ate most of his pasta and refused the peas." },
  // Sep 3 — Nana Rosa afternoon-care note
  { captureId: "seed_sep03_rosa", memberId: "mem_rosa", day: 3, hour: 16, minute: 50,
    transcript: "Nana Rosa — Iris had applesauce and crackers around 3:30 and then napped 50 minutes. Milo had pickle and pretzels after school." },
  // Sep 4
  { captureId: "seed_sep04_potty", memberId: "mem_dana", day: 4, hour: 9, minute: 30,
    transcript: "Milo pooped on the potty all by himself this morning — huge win for week two of training." },
  // Sep 5 — anchor: park trip photo (Mom)
  { captureId: "seed_sep05_park", memberId: "mem_dana", day: 5, hour: 10, minute: 30,
    transcript: "Park trip this morning — got a great photo of Milo and Iris on the swings.",
    photoId: "photo_park_2026_09_05" },
  // Sep 6
  { captureId: "seed_sep06_nap", memberId: "mem_dana", day: 6, hour: 10, minute: 15,
    transcript: "Iris napped 55 minutes this morning." },
  { captureId: "seed_sep06_tower", memberId: "mem_dana", day: 6, hour: 11, minute: 5,
    transcript: "Milo built a block tower for an hour and then had a total meltdown when it fell." },
  { captureId: "seed_sep06_bite", memberId: "mem_dana", day: 6, hour: 20, minute: 10,
    transcript: "Milo bit a classmate today — teacher called after pickup. Let's coordinate with the teacher before Nana Rosa hears it secondhand; don't want her worried.",
    audience: "parents-only" },
  // Sep 7
  { captureId: "seed_sep07_dinner", memberId: "mem_gilbert", day: 7, hour: 18, minute: 30,
    transcript: "Milo refused dinner again. Iris ate her weight in sweet potato." },
  // Sep 8 — anchor: milestone, first pedals on the balance bike (Mom)
  { captureId: "seed_sep08_bike", memberId: "mem_dana", day: 8, hour: 17, minute: 40,
    transcript: "Big moment — Milo pedaled the balance bike all by himself for the first time today!" },
  // Sep 9
  { captureId: "seed_sep09_nap", memberId: "mem_dana", day: 9, hour: 13, minute: 20,
    transcript: "Iris napped 45 minutes. Milo is getting grumpy after skipped preschool nap days." },
  { captureId: "seed_sep09_night", memberId: "mem_gilbert", day: 9, hour: 20, minute: 5,
    transcript: "Both kids down by 8. Milo woke at 6:45 ready to go — that night sleep is holding at 10 hours 45." },
  // Sep 10 — Nana Rosa afternoon-care note
  { captureId: "seed_sep10_rosa", memberId: "mem_rosa", day: 10, hour: 16, minute: 55,
    transcript: "Afternoon with Nana Rosa — Iris napped 60 minutes from 1:00, then snack was yogurt and berries at 3:15. Milo came home without his shoes again." },
  // Sep 11
  { captureId: "seed_sep11_checkup", memberId: "mem_dana", day: 11, hour: 17, minute: 30,
    transcript: "Can you log that Iris had her checkup today? Oh and Milo refused dinner again." },
  // Sep 12 — the lineage example: logged 30, corrected to 60
  { captureId: "seed_sep12_nap", memberId: "mem_dana", day: 12, hour: 13, minute: 5,
    transcript: "Iris napped 30 minutes." },
  { captureId: "seed_sep12_dinner", memberId: "mem_gilbert", day: 12, hour: 18, minute: 40,
    transcript: "Silver dollar pancakes for dinner tonight — Milo ate three at 6, and Iris had mashed banana." },
  // Sep 13
  { captureId: "seed_sep13_nonap", memberId: "mem_dana", day: 13, hour: 15, minute: 10,
    transcript: "Iris skipped her afternoon nap entirely and got crankier by the hour." },
  // Sep 14
  { captureId: "seed_sep14_nap", memberId: "mem_dana", day: 14, hour: 13, minute: 35,
    transcript: "Iris napped 55 minutes while Milo was at school." },
  // Sep 15 — Nana Rosa afternoon-care note
  { captureId: "seed_sep15_rosa", memberId: "mem_rosa", day: 15, hour: 16, minute: 45,
    transcript: "Nana Rosa — potty practice before snack: Milo peed on the potty at 4:15 like a champ, then crackers and milk at 4:30." },
  // Sep 16
  { captureId: "seed_sep16_waterplay", memberId: "mem_gilbert", day: 16, hour: 8, minute: 40,
    transcript: "Water play day at pre-K — Milo's teacher says he led the bucket brigade. He was soaked and delighted." },
  { captureId: "seed_sep16_bedtime", memberId: "mem_dana", day: 16, hour: 19, minute: 5,
    transcript: "Iris napped 65 minutes late this afternoon, so bedtime slid to 7:45 for her; Milo still down at 8." },
]

/** Named facts tests and the UI pin against (stable ids from the seed walk). */
export interface SeedFacts {
  readonly entryCount: number
  readonly entryIdByCaptureId: ReadonlyMap<string, string>
  readonly eventIdsByCaptureId: ReadonlyMap<string, readonly string[]>
  /** The Sep 12 nap event corrected 30 → 60 (append-only lineage example). */
  readonly sep12Nap: { readonly entryId: string; readonly eventId: string }
  /** The parents-only raw+event entry (Sep 6). */
  readonly parentsOnlyEntryId: string
}

/**
 * Build the seeded September store. Deterministic: fixed timestamps, the
 * deterministic extraction double, fixed review confirmations.
 */
export function createSeptemberStore(): { readonly store: JournalStore; readonly facts: SeedFacts } {
  const store = new JournalStore(HOUSEHOLD_SEED)
  const entryIdByCaptureId = new Map<string, string>()
  const eventIdsByCaptureId = new Map<string, readonly string[]>()

  for (const seed of SEED_CAPTURES) {
    const principal = memberPrincipal(seed.memberId)
    const capturedAt = at(seed.day, seed.hour, seed.minute)
    const outcome = store.capture(principal, {
      captureId: seed.captureId,
      transcript: seed.transcript,
      authorId: seed.memberId,
      capturedAt,
      channel: "text",
      ...(seed.photoId === undefined ? {} : { photoId: seed.photoId }),
    })
    if (outcome.kind !== "captured") {
      throw new Error(`seed capture ${seed.captureId} failed: ${JSON.stringify(outcome)}`)
    }
    entryIdByCaptureId.set(seed.captureId, outcome.entryId)

    // Review-confirmation: the month history was already reviewed by the
    // caregiver at seed time → publish with no further edits (confidence 1).
    const audience: Audience | undefined = seed.audience
    const edits = new Map<string, EventEdit>()
    const published = store.publish(principal, {
      entryId: outcome.entryId,
      edits,
      ...(audience === undefined ? {} : { audience }),
      at: capturedAt + 60_000,
    })
    if (published.kind !== "published") {
      throw new Error(`seed publish ${seed.captureId} failed: ${JSON.stringify(published)}`)
    }
    eventIdsByCaptureId.set(seed.captureId, published.eventIds)
  }

  // Lineage example: Iris's Sep 12 nap logged 30 minutes, corrected to 60 —
  // append-only (the original stays preserved in the correction record).
  const napEntryId = entryIdByCaptureId.get("seed_sep12_nap")
  const napEventIds = eventIdsByCaptureId.get("seed_sep12_nap")
  if (napEntryId === undefined || napEventIds === undefined || napEventIds.length !== 1) {
    throw new Error("seed lineage capture missing its published event")
  }
  const napEventId = napEventIds[0]
  if (napEventId === undefined) throw new Error("seed lineage event id missing")
  const corrected = store.correct(memberPrincipal("mem_dana"), {
    eventId: napEventId,
    changes: { payload: { minutes: 60 } },
    reason: "Timer said 60 — she was out cold; logging it properly.",
    authorId: "mem_dana",
    at: at(12, 17, 45),
  })
  if (corrected.kind !== "corrected") {
    throw new Error(`seed correction failed: ${JSON.stringify(corrected)}`)
  }

  // Dana last checked in the evening of Sep 9 — her catch-up demo covers
  // Sep 10–16. Set through the explicit write path (receipted).
  const caughtUp = store.markCaughtUp(memberPrincipal("mem_dana"), at(9, 20, 30))
  if (caughtUp.kind !== "marked") throw new Error("seed markCaughtUp failed")

  const parentsOnlyEntryId = entryIdByCaptureId.get("seed_sep06_bite")
  if (napEntryId === undefined || parentsOnlyEntryId === undefined) {
    throw new Error("seed facts incomplete")
  }

  return {
    store,
    facts: {
      entryCount: SEED_CAPTURES.length,
      entryIdByCaptureId,
      eventIdsByCaptureId,
      sep12Nap: { entryId: napEntryId, eventId: napEventId },
      parentsOnlyEntryId,
    },
  }
}
