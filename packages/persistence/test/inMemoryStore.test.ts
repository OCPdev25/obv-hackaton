import { describe, expect, it } from 'vitest'
import { Effect, Schema } from 'effect'
import { CaptureId, ChildId, Entry, Event, fixtureCaregiverAlex, fixtureChild } from '@journal/domain'
import type { CaregiverId } from '@journal/domain'
import { makeInMemoryCaptureStore } from '../src/inMemoryStore.js'

const captureId = Schema.decodeSync(CaptureId)('cap-test-001')
const childId = Schema.decodeSync(ChildId)(fixtureChild.childId)
const authorId = fixtureCaregiverAlex.caregiverId as CaregiverId
const event = Schema.decodeSync(Event)({
  _tag: 'Event',
  category: 'sleep',
  occurredAt: 1726574400000,
  confidence: 0.9,
  authorId,
})
const entry = Schema.decodeSync(Entry)({
  _tag: 'Entry',
  captureId,
  childId,
  transcript: 'Mila slept 13 hours.',
  authorId,
  createdAt: 1726574400000,
  status: 'draft',
  events: [],
})

describe('in-memory CaptureStore (controlled test double)', () => {
  it('persists raw once, publishes once, reports AlreadyPublished, keeps one timeline item', async () => {
    const { store } = makeInMemoryCaptureStore()
    await Effect.runPromise(store.persistRaw(entry))
    await Effect.runPromise(store.persistRaw(entry)) // idempotent by captureId

    const first = await Effect.runPromise(store.publish({ captureId, events: [event] }))
    expect(first._tag).toBe('Published')
    const second = await Effect.runPromise(store.publish({ captureId, events: [event] }))
    expect(second._tag).toBe('AlreadyPublished')
    expect(second.entryId).toBe(first.entryId)

    const timeline = await Effect.runPromise(store.timeline(childId))
    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.events.map((e) => e.category)).toEqual(['sleep'])
  })
})
