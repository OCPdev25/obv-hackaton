import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import type { Event } from '../src/schema'
import { decodeModelEvents, EventsFailedSchema, MalformedModelOutput, ProviderFailure } from '../src/llm/contract'
import { openaiChatClient, openaiExtractEvents, OPENAI_API_KEY_ENV, DEFAULT_EXTRACTION_MODEL } from '../src/llm/openai'
import type { ChatCompletionsClient } from '../src/llm/openai'

const request = { captureId: 'cap_test_123', attempt: 0, transcript: 'she went potty twice this morning' }

const rawPotty = {
  category: 'potty',
  occurredAt: 1_726_000_010_000,
  confidence: 0.9,
  authorId: 'user_mom',
}

/** Fake chat client returning a canned completion — no network, no API key. */
const fakeClient = (content: string | null, failWith?: Error): ChatCompletionsClient => ({
  create: async () => {
    if (failWith) throw failWith
    return { choices: [{ message: { content } }] }
  },
})

const failureOf = (effect: Effect.Effect<unknown, unknown, never>): Promise<unknown> =>
  Effect.runPromise(Effect.flip(effect))

describe('OpenAI extraction provider (mocked)', () => {
  it('extracts typed events and stamps the result envelope with captureId and attempt', async () => {
    const client = fakeClient(JSON.stringify({ events: [rawPotty] }))
    const extract = openaiExtractEvents({ client, model: 'test-model' })

    const result = await Effect.runPromise(extract(request))

    expect(result.captureId).toBe('cap_test_123')
    expect(result.attempt).toBe(0)
    expect(result.events).toHaveLength(1)
    const event = result.events[0] as Event
    expect(event.category).toBe('potty')
    expect(event.occurredAt).toBeInstanceOf(Date)
  })

  it('sends the transcript with the extraction system prompt and json_object response format', async () => {
    let capturedBody: {
      model?: string
      messages?: Array<{ role: string; content: string }>
      response_format?: { type: string }
    } | undefined
    const client: ChatCompletionsClient = {
      create: async (body) => {
        capturedBody = body
        return { choices: [{ message: { content: JSON.stringify({ events: [] }) } }] }
      },
    }

    await Effect.runPromise(openaiExtractEvents({ client })(request))

    expect(capturedBody?.model).toBe(DEFAULT_EXTRACTION_MODEL)
    expect(capturedBody?.response_format).toStrictEqual({ type: 'json_object' })
    expect(capturedBody?.messages?.[0]?.role).toBe('system')
    expect(capturedBody?.messages?.[1]).toStrictEqual({ role: 'user', content: request.transcript })
  })

  it('fails with EventsFailedSchema when a model event breaks the canonical schema', async () => {
    const client = fakeClient(JSON.stringify({ events: [{ ...rawPotty, category: 'treat', confidence: 0.5 }] }))

    const error = await failureOf(openaiExtractEvents({ client })(request))

    expect(error).toBeInstanceOf(EventsFailedSchema)
    expect((error as EventsFailedSchema).issues[0]).toContain('event[0]')
  })

  it('fails with MalformedModelOutput on non-JSON replies and wrong envelope shapes', async () => {
    const notJson = await failureOf(openaiExtractEvents({ client: fakeClient('not json at all') })(request))
    expect(notJson).toBeInstanceOf(MalformedModelOutput)
    expect((notJson as MalformedModelOutput).raw).toBe('not json at all')

    const wrongEnvelope = await failureOf(
      openaiExtractEvents({ client: fakeClient(JSON.stringify({ items: [] })) })(request),
    )
    expect(wrongEnvelope).toBeInstanceOf(MalformedModelOutput)
  })

  it('fails with MalformedModelOutput when the completion is empty', async () => {
    const error = await failureOf(openaiExtractEvents({ client: fakeClient(null) })(request))
    expect(error).toBeInstanceOf(MalformedModelOutput)
  })

  it('fails with ProviderFailure when the client throws', async () => {
    const error = await failureOf(
      openaiExtractEvents({ client: fakeClient(null, new Error('quota exceeded')) })(request),
    )
    expect(error).toBeInstanceOf(ProviderFailure)
    expect((error as ProviderFailure).reason).toContain('quota exceeded')
  })
})

describe('decodeModelEvents (contract-level strictness)', () => {
  it('attaches the Event discriminant and stamps the envelope', async () => {
    const result = await Effect.runPromise(decodeModelEvents(request, [rawPotty]))
    expect(result.captureId).toBe('cap_test_123')
    expect(result.attempt).toBe(0)
    expect(result.events[0]?.category).toBe('potty')
  })

  it('fails the whole batch on one invalid event, reporting its index', async () => {
    const error = await failureOf(decodeModelEvents(request, [rawPotty, { ...rawPotty, category: 'bogus' }]))
    expect(error).toBeInstanceOf(EventsFailedSchema)
    expect((error as EventsFailedSchema).issues[0]).toContain('event[1]')
  })
})

describe('env-key gating', () => {
  it('fails fast at construction when the key is absent', () => {
    const previous = process.env[OPENAI_API_KEY_ENV]
    delete process.env[OPENAI_API_KEY_ENV]
    try {
      expect(() => openaiChatClient()).toThrow(/OPENAI_API_KEY/)
    } finally {
      if (previous !== undefined) process.env[OPENAI_API_KEY_ENV] = previous
    }
  })

  it('accepts an explicitly provided key without reading the environment', () => {
    expect(() => openaiChatClient('sk-test')).not.toThrow()
  })
})
