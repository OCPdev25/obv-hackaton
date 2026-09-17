import { Effect, Schema } from 'effect'
import { CaptureId, Entry, Event, StoreError } from '@journal/domain'
import { dispatchMessage, fixtureChild, fixtureSessionAlex, fixtureTranscript } from '@journal/domain'
import type { CaptureState, CaptureStoreShape, PublishOutcome, TimelineItem } from '@journal/domain'

/** The stable capture id the whole journey hangs off — retries key on it. */
export const JOURNEY_CAPTURE_ID = Schema.decodeSync(CaptureId)('cap-2026-09-17-candidate-c')

export interface JourneyDeps {
  readonly mode: 'memory' | 'convex'
  /** Idempotency probe: republish the journey's captureId after publication. */
  readonly republish: () => Effect.Effect<PublishOutcome, StoreError>
  /** Reload read — a FRESH store handle in convex mode, same store in memory mode. */
  readonly readTimeline: () => Effect.Effect<ReadonlyArray<TimelineItem>, StoreError>
}

const log = (message: string): void => {
  process.stdout.write(`${message}\n`)
}

const show = (step: string, state: CaptureState): void => {
  log(`  [${state._tag}] after ${step}`)
}

/** Schema-authority probe: does the canonical schema reject this value? */
const rejects = (decode: (value: unknown) => unknown, value: unknown): boolean => {
  try {
    decode(value)
    return false
  } catch {
    return true
  }
}

/** Deterministic scripted outage: the first persist fails, the retry succeeds. */
export const withScriptedOutage = (inner: CaptureStoreShape, captureId: string): CaptureStoreShape => {
  let failedOnce = false
  return {
    ...inner,
    persistRaw: (entry) => {
      if (entry.captureId === captureId && !failedOnce) {
        failedOnce = true
        return Effect.fail(
          new StoreError({ code: 'unavailable', detail: 'scripted transient outage (deterministic test double)' }),
        )
      }
      return inner.persistRaw(entry)
    },
  }
}

export const runJourney = (deps: JourneyDeps) =>
  Effect.gen(function* () {
    log('=== Shared Child Journal — capture → persist → extract → review → publish → timeline ===')
    log(`store mode: ${deps.mode} · extraction: deterministic heuristic double (NOT a live LLM)`)

    // 0. Schema authority: invalid extracted events and invalid entries cannot
    //    exist at all. The caregiver's raw text is never touched by these probes.
    log('\n--- step 0: validation failure at the schema boundary (raw input untouched) ---')
    const bogusEvent = {
      _tag: 'Event',
      category: 'meal',
      occurredAt: Date.now(),
      confidence: 1.5,
      authorId: fixtureSessionAlex.authorId,
    }
    log(`  invalid event (confidence 1.5): ${rejects((v) => Schema.decodeUnknownSync(Event)(v), bogusEvent) ? 'REJECTED by schema' : 'ACCEPTED (unexpected!)'}`)
    const emptyEntry = {
      _tag: 'Entry',
      captureId: 'cap-x',
      childId: 'child-x',
      transcript: '',
      authorId: 'cg-x',
      createdAt: new Date(),
      status: 'draft',
      events: [],
    }
    log(`  invalid entry (empty transcript): ${rejects((v) => Schema.decodeUnknownSync(Entry)(v), emptyEntry) ? 'REJECTED by schema' : 'ACCEPTED (unexpected!)'}`)
    log(`  raw transcript still intact: "${fixtureTranscript.slice(0, 40)}…"`)

    // 1. Capture (Idle → Transcribed). In memory mode the first persist fails
    //    (scripted outage) and the retry succeeds — the reducer keeps the raw
    //    transcript through both.
    log('\n--- step 1: text captured → raw persisted (scripted outage + retry in memory mode) ---')
    let state: CaptureState = { _tag: 'Idle' }
    state = yield* dispatchMessage(fixtureSessionAlex, state, {
      _tag: 'TextCaptured',
      captureId: JOURNEY_CAPTURE_ID,
      transcript: fixtureTranscript,
      at: new Date(1726574400000),
    })
    show('TextCaptured', state)
    if (state._tag === 'Transcribed' && state.lastError !== undefined) {
      log(`  persist failed once (${state.lastError.code}) — raw text preserved in state: "${state.transcript.slice(0, 40)}…"`)
      state = yield* dispatchMessage(fixtureSessionAlex, state, { _tag: 'RetryPersistRaw' })
      show('RetryPersistRaw', state)
    }

    // 2. Extraction by the deterministic double (Transcribed → Review).
    log('\n--- step 2: extraction (deterministic double) → review ---')
    state = yield* dispatchMessage(fixtureSessionAlex, state, { _tag: 'SubmittedForExtraction' })
    show('SubmittedForExtraction', state)
    if (state._tag === 'Review') {
      for (const event of state.events) {
        log(`  event: ${event.category} (confidence ${event.confidence}) — "${event.note ?? ''}"`)
      }
    }

    // 3. Review confirmed → publish (Review → Published).
    log('\n--- step 3: review confirmed → published ---')
    state = yield* dispatchMessage(fixtureSessionAlex, state, { _tag: 'ConfirmedReview' })
    show('ConfirmedReview', state)

    // 3b. Idempotency: republishing the SAME captureId is a no-op — no
    //     duplicate entry, no duplicate events.
    log('\n--- step 3b: idempotent republish (same captureId) ---')
    const republish = yield* deps.republish()
    log(`  republish outcome: ${republish._tag} (entryId ${republish.entryId})`)

    // 4. Reload: read the child timeline through a fresh store handle.
    log('\n--- step 4: reload timeline from a fresh store handle ---')
    const items = yield* deps.readTimeline()
    log(`  timeline items for child ${fixtureChild.childId}: ${items.length}`)
    for (const item of items) {
      log(`  - ${item.createdAt.toISOString()} by ${item.authorId}: "${item.transcript.slice(0, 50)}…" [${item.events.map((e) => e.category).join(', ')}]`)
    }

    log(`\n=== journey complete (store mode: ${deps.mode}; extraction: deterministic double) ===`)
  })
