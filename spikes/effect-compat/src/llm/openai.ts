/**
 * OpenAI provider for the extraction contract.
 *
 * Gated behind the OPENAI_API_KEY env key (hackathon access). Fully mocked in
 * tests: the provider depends on a minimal structural chat client, so tests
 * inject a fake and never touch the network or the key.
 */
import { Effect } from 'effect'
import OpenAI from 'openai'
import type { ExtractEvents, ExtractEventsRequest, ExtractionError, ExtractionResult } from './contract'
import { MalformedModelOutput, ProviderFailure, decodeModelEvents } from './contract'

/** The slice of the OpenAI SDK this provider uses — structurally mockable. */
export interface ChatCompletionsClient {
  create(body: {
    model: string
    messages: Array<{ role: 'system' | 'user'; content: string }>
    response_format?: { type: 'json_object' }
    temperature?: number
  }): Promise<{ choices: Array<{ message?: { content?: string | null } }> }>
}

export const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY'
export const DEFAULT_EXTRACTION_MODEL = 'gpt-4o-mini'

/**
 * Production wiring: the real OpenAI client, gated behind the env key.
 * Throws at construction when the key is absent — fail fast, not on first call.
 */
export const openaiChatClient = (apiKey?: string): ChatCompletionsClient => {
  const key = apiKey ?? process.env[OPENAI_API_KEY_ENV]
  if (!key) {
    throw new Error(`${OPENAI_API_KEY_ENV} is not set — the OpenAI extraction provider requires it`)
  }
  return new OpenAI({ apiKey: key }).chat.completions
}

const SYSTEM_PROMPT = [
  'You extract structured child-care journal events from a dictated transcript.',
  'Return ONLY a JSON object of the shape {"events": [...]}.',
  'Each event: {"category": "potty"|"meal"|"sleep"|"mood"|"milestone"|"school",',
  '"occurredAt": <unix epoch milliseconds>, "quantity": {"value": <finite number>, "unit"?: <string>} (omit when not applicable),',
  '"confidence": <number 0..1>, "authorId": <string>, "note"?: <non-empty string>}.',
  'Use authorId exactly as given in the transcript context. Omit fields you cannot support.',
].join(' ')

const buildMessages = (transcript: string) => [
  { role: 'system' as const, content: SYSTEM_PROMPT },
  { role: 'user' as const, content: transcript },
]

const parseJsonEnvelope = (content: string): Effect.Effect<ReadonlyArray<unknown>, MalformedModelOutput> =>
  Effect.try({
    try: () => {
      const parsed: unknown = JSON.parse(content)
      if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as { events?: unknown }).events)) {
        throw new Error('envelope is not {"events": [...]}')
      }
      return (parsed as { events: ReadonlyArray<unknown> }).events
    },
    catch: () => new MalformedModelOutput({ raw: content.slice(0, 2000) }),
  })

/**
 * The OpenAI-backed ExtractEvents implementation. Model output is ALWAYS
 * decoded through the canonical schema (strict — see decodeModelEvents).
 */
export const openaiExtractEvents =
  ({ client, model = DEFAULT_EXTRACTION_MODEL }: { client: ChatCompletionsClient; model?: string }): ExtractEvents =>
  (request: ExtractEventsRequest): Effect.Effect<ExtractionResult, ExtractionError> =>
    Effect.gen(function* () {
      const completion = yield* Effect.tryPromise({
        try: () =>
          client.create({
            model,
            messages: buildMessages(request.transcript),
            response_format: { type: 'json_object' },
          }),
        catch: (error) => new ProviderFailure({ reason: error instanceof Error ? error.message : String(error) }),
      })
      const content = completion.choices[0]?.message?.content
      if (typeof content !== 'string') {
        return yield* Effect.fail(new MalformedModelOutput({ raw: '<empty completion>' }))
      }
      const rawEvents = yield* parseJsonEnvelope(content)
      return yield* decodeModelEvents(request, rawEvents)
    })
