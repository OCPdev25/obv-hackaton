import { describe, expect, it } from 'vitest'
import { Effect, Layer, Schema } from 'effect'
import { CaptureId, Event, Extractor, fixtureCaregiverAlex, fixtureTranscript } from '@journal/domain'
import { makeDeterministicExtractor } from '../src/extractors.js'

const capId = Schema.decodeSync(CaptureId)('cap-test-001')
const at = new Date(1726574400000)
const env = Layer.effect(Extractor)(Effect.succeed(makeDeterministicExtractor()))

const extract = (transcript: string): Promise<Array<typeof Event.Type>> =>
  Effect.runPromise(
    Effect.provide(
      Effect.flatMap(Extractor, (ext) =>
        ext.extract({ captureId: capId, transcript, authorId: fixtureCaregiverAlex.caregiverId, capturedAt: at })),
      env,
    ),
  )

describe('deterministic extractor (controlled test double — NOT a live LLM)', () => {
  it('finds meal, sleep, milestone, school in the shared fixture transcript', async () => {
    const events = await extract(fixtureTranscript)
    expect(events.map((e) => e.category).sort()).toEqual(['meal', 'milestone', 'school', 'sleep'])
  })

  it('is deterministic: same transcript yields identical event sets', async () => {
    const [a, b] = await Promise.all([extract(fixtureTranscript), extract(fixtureTranscript)])
    expect(Schema.encodeSync(Schema.Array(Event))(a)).toEqual(Schema.encodeSync(Schema.Array(Event))(b))
  })

  it('extracts nothing from an unrelated transcript', async () => {
    const events = await extract('The weather was fine today.')
    expect(events).toEqual([])
  })
})
