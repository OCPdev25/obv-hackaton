import { describe, expect, it } from 'vitest'
import { Effect, Layer, Schema } from 'effect'
import { makeCaptureUpdate } from '../src/capture.js'
import { dispatchMessage, runCommand } from '../src/commands.js'
import { CaptureStore, Extractor, type CaptureStoreShape } from '../src/services.js'
import { StoreError } from '../src/errors.js'
import { Entry, Event, TimelineItem } from '../src/schema.js'
import { CaptureId, ChildId, CaregiverId, EntryId } from '../src/ids.js'
import { fixtureChild, fixtureCaregiverAlex, fixtureSessionAlex } from '../src/fixtures.js'
import type { CaptureMessage, CaptureState } from '../src/capture.js'
import type { TimelineItem as TimelineItemType } from '../src/schema.js'

// --- fixture helpers -------------------------------------------------------

const CAPTURE_MS = 1726574400000

const capId = Schema.decodeSync(CaptureId)('cap-2026-09-17-001')
const alexId = fixtureCaregiverAlex.caregiverId
const childId = fixtureChild.childId
const entryOne = Schema.decodeSync(EntryId)('entry-1')
const entryTwo = Schema.decodeSync(EntryId)('entry-2')

const pottyEvent = Schema.decodeSync(Event)({
  _tag: 'Event',
  category: 'potty',
  occurredAt: CAPTURE_MS,
  confidence: 0.9,
  authorId: alexId,
})

// --- controlled test double: in-memory store -------------------------------

const makeMemoryStore = () => {
  const entries = new Map<string, unknown>()
  const published = new Map<string, { entryId: typeof EntryId.Type; events: ReadonlyArray<typeof Event.Type> }>()
  const timeline: Array<TimelineItemType> = []
  let persistCalls = 0
  let publishCalls = 0

  const store: CaptureStoreShape = {
    persistRaw: (entry) =>
      Effect.sync(() => {
        persistCalls += 1
        // Idempotent by captureId: an existing draft is left untouched.
        if (!entries.has(entry.captureId)) entries.set(entry.captureId, { ...entry })
      }),
    publish: ({ captureId, events }) =>
      Effect.sync(() => {
        publishCalls += 1
        const existing = published.get(captureId)
        if (existing) return { _tag: 'AlreadyPublished' as const, entryId: existing.entryId }
        const entryId = published.size === 0 ? entryOne : entryTwo
        published.set(captureId, { entryId, events: [...events] })
        timeline.unshift({
          entryId,
          captureId,
          childId,
          transcript: (entries.get(captureId) as { transcript: string }).transcript,
          authorId: alexId,
          createdAt: new Date(CAPTURE_MS),
          events: [...events],
        })
        return { _tag: 'Published' as const, entryId }
      }),
    timeline: () => Effect.sync(() => [...timeline]),
  }
  return { store, entries, published, timeline, persistCalls: () => persistCalls, publishCalls: () => publishCalls }
}

const extractorLayer = (events: ReadonlyArray<typeof Event.Type>) =>
  Layer.effect(Extractor)(Effect.succeed({ extract: () => Effect.succeed(events) }))

const storeLayer = (store: CaptureStoreShape) => Layer.effect(CaptureStore)(Effect.succeed(store))

// --- tests -----------------------------------------------------------------

describe('pure update transitions', () => {
  const update = makeCaptureUpdate(fixtureSessionAlex)

  it('TextCaptured from Idle moves to Transcribed and commands one raw persist', () => {
    const message: CaptureMessage = { _tag: 'TextCaptured', captureId: capId, transcript: 'Mila used the potty at 10am.', at: new Date(CAPTURE_MS) }
    const [state, commands] = update({ _tag: 'Idle' }, message)
    expect(state._tag).toBe('Transcribed')
    if (state._tag === 'Transcribed') expect(state.transcript).toBe('Mila used the potty at 10am.')
    expect(commands).toHaveLength(1)
    expect(commands[0]?._tag).toBe('PersistRawCapture')
    if (commands[0]?._tag === 'PersistRawCapture') {
      expect(commands[0].entry.status).toBe('draft')
      expect(commands[0].entry.transcript).toBe('Mila used the potty at 10am.')
    }
  })

  it('TextCaptured outside Idle is a no-op (no duplicate capture)', () => {
    const message: CaptureMessage = { _tag: 'TextCaptured', captureId: capId, transcript: 'again', at: new Date(CAPTURE_MS) }
    const [state, commands] = update({ _tag: 'Recording', captureId: capId, startedAt: new Date(CAPTURE_MS) }, message)
    expect(state._tag).toBe('Recording')
    expect(commands).toHaveLength(0)
  })

  it('FailedExtraction falls back to Transcribed with the raw transcript intact', () => {
    const updateFor = makeCaptureUpdate(fixtureSessionAlex)
    const [extracting] = updateFor(
      { _tag: 'Transcribed', captureId: capId, transcript: 'raw text', capturedAt: new Date(CAPTURE_MS) },
      { _tag: 'SubmittedForExtraction' },
    )
    const [state, commands] = updateFor(extracting, { _tag: 'FailedExtraction', error: { code: 'extraction_failed', detail: 'llm unreachable' } })
    expect(state._tag).toBe('Transcribed')
    if (state._tag === 'Transcribed') {
      expect(state.transcript).toBe('raw text')
      expect(state.lastError?.detail).toBe('llm unreachable')
    }
    expect(commands).toHaveLength(0)
  })
})

describe('boundary validation (Effect Schema is the domain authority)', () => {
  it('decodes a wire entry and brands ids', () => {
    const decoded = Schema.decodeUnknownSync(Entry)({
      _tag: 'Entry',
      captureId: 'cap-1',
      childId: 'child-mila',
      transcript: 'hello',
      authorId: 'cg-alex-rivera',
      createdAt: CAPTURE_MS,
      status: 'draft',
      events: [],
    })
    expect(decoded.captureId).toBe('cap-1')
    expect(decoded.createdAt).toBeInstanceOf(Date)
  })

  it('rejects an empty transcript at the boundary', () => {
    expect(() =>
      Schema.decodeUnknownSync(Entry)({
        _tag: 'Entry',
        captureId: 'cap-1',
        childId: 'child-mila',
        transcript: '',
        authorId: 'cg-alex-rivera',
        createdAt: CAPTURE_MS,
        status: 'draft',
        events: [],
      }),
    ).toThrow()
  })

  it('rejects confidence outside [0,1]', () => {
    expect(() =>
      Schema.decodeUnknownSync(Event)({
        _tag: 'Event',
        category: 'potty',
        occurredAt: CAPTURE_MS,
        confidence: 1.5,
        authorId: alexId,
      }),
    ).toThrow()
  })
})

describe('dispatch loop (update -> commands -> messages) with controlled doubles', () => {
  it('persists raw, extracts, reviews, publishes, and renders the child timeline', async () => {
    const mem = makeMemoryStore()
    const env = Layer.merge(storeLayer(mem.store), extractorLayer([pottyEvent]))
    let state: CaptureState = { _tag: 'Idle' }

    state = await Effect.runPromise(
      Effect.provide(
        dispatchMessage(fixtureSessionAlex, state, {
          _tag: 'TextCaptured',
          captureId: capId,
          transcript: 'Mila used the potty at 10am.',
          at: new Date(CAPTURE_MS),
        }),
        env,
      ),
    )
    expect(state._tag).toBe('Transcribed')
    expect(mem.persistCalls()).toBe(1)

    state = await Effect.runPromise(Effect.provide(dispatchMessage(fixtureSessionAlex, state, { _tag: 'SubmittedForExtraction' }), env))
    expect(state._tag).toBe('Review')
    if (state._tag === 'Review') expect(state.events).toHaveLength(1)

    state = await Effect.runPromise(Effect.provide(dispatchMessage(fixtureSessionAlex, state, { _tag: 'ConfirmedReview' }), env))
    expect(state._tag).toBe('Published')
    expect(mem.published.size).toBe(1)

    const timeline = await Effect.runPromise(Effect.provide(mem.store.timeline(childId), env))
    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.transcript).toBe('Mila used the potty at 10am.')
    expect(timeline[0]?.events[0]?.category).toBe('potty')
  })

  it('retries a failed persist WITHOUT losing raw input and WITHOUT duplicating the entry', async () => {
    const mem = makeMemoryStore()
    const failingFirst = (() => {
      let calls = 0
      return {
        store: {
          ...mem.store,
          // Fails on the typed error channel exactly like the live adapter
          // would during an outage — never by throwing a defect.
          persistRaw: (entry: Parameters<CaptureStoreShape['persistRaw']>[0]) => {
            calls += 1
            return calls === 1
              ? Effect.fail(new StoreError({ code: 'unavailable', detail: 'scripted store outage' }))
              : mem.store.persistRaw(entry)
          },
        } satisfies CaptureStoreShape,
      }
    })()
    const env = Layer.merge(storeLayer(failingFirst.store), extractorLayer([]))

    let state: CaptureState = await Effect.runPromise(
      Effect.provide(
        dispatchMessage(fixtureSessionAlex, { _tag: 'Idle' }, {
          _tag: 'TextCaptured',
          captureId: capId,
          transcript: 'Mila napped 90 minutes.',
          at: new Date(CAPTURE_MS),
        }),
        env,
      ),
    )
    // Persist failed but the raw transcript is still in state, retryable.
    expect(state._tag).toBe('Transcribed')
    if (state._tag === 'Transcribed') {
      expect(state.transcript).toBe('Mila napped 90 minutes.')
      expect(state.lastError?.code).toBe('persist_failed')
    }

    // User retries once the store recovers — same captureId, no re-entry.
    state = await Effect.runPromise(Effect.provide(dispatchMessage(fixtureSessionAlex, state, { _tag: 'RetryPersistRaw' }), env))
    expect(state._tag).toBe('Transcribed')
    if (state._tag === 'Transcribed') expect(state.lastError).toBeUndefined()
    expect(mem.entries.size).toBe(1) // exactly one draft persisted
  })

  it('is idempotent on re-publish (same captureId never duplicates timeline items)', async () => {
    const mem = makeMemoryStore()
    const env = Layer.merge(storeLayer(mem.store), extractorLayer([pottyEvent]))
    let state: CaptureState = { _tag: 'Idle' }
    state = await Effect.runPromise(
      Effect.provide(
        dispatchMessage(fixtureSessionAlex, state, { _tag: 'TextCaptured', captureId: capId, transcript: 'note', at: new Date(CAPTURE_MS) }),
        env,
      ),
    )
    state = await Effect.runPromise(Effect.provide(dispatchMessage(fixtureSessionAlex, state, { _tag: 'SubmittedForExtraction' }), env))
    state = await Effect.runPromise(Effect.provide(dispatchMessage(fixtureSessionAlex, state, { _tag: 'ConfirmedReview' }), env))
    expect(state._tag).toBe('Published')

    // Second confirm against the same machine state is guarded (publishing flag),
    // and a stale repeat command against the store reports AlreadyPublished.
    const outcome = await Effect.runPromise(
      Effect.provide(
        runCommand(fixtureSessionAlex, { _tag: 'PublishEntry', captureId: capId, events: [pottyEvent] }).pipe(Effect.flatMap(() => mem.store.publish({ captureId: capId, events: [pottyEvent] }))),
        env,
      ),
    )
    expect(outcome._tag).toBe('AlreadyPublished')
    expect(mem.timeline).toHaveLength(1)
  })

  it('round-trips the timeline item through the TimelineItem schema (wire validity)', async () => {
    const mem = makeMemoryStore()
    const env = Layer.merge(storeLayer(mem.store), extractorLayer([pottyEvent]))
    let state: CaptureState = await Effect.runPromise(
      Effect.provide(
        dispatchMessage(fixtureSessionAlex, { _tag: 'Idle' }, {
          _tag: 'TextCaptured',
          captureId: capId,
          transcript: 'wire check',
          at: new Date(CAPTURE_MS),
        }),
        env,
      ),
    )
    state = await Effect.runPromise(Effect.provide(dispatchMessage(fixtureSessionAlex, state, { _tag: 'SubmittedForExtraction' }), env))
    state = await Effect.runPromise(Effect.provide(dispatchMessage(fixtureSessionAlex, state, { _tag: 'ConfirmedReview' }), env))
    expect(state._tag).toBe('Published')

    const encoded = Schema.encodeSync(Schema.Array(TimelineItem))(mem.timeline)
    const decoded = Schema.decodeUnknownSync(Schema.Array(TimelineItem))(encoded)
    expect(decoded[0]?.transcript).toBe('wire check')
    expect(encoded[0]?.createdAt).toBe(CAPTURE_MS) // Date encodes back to unix ms
  })
})

