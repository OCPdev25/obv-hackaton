import { ConvexError, v } from 'convex/values'
import * as Schema from 'effect/Schema'
import { Entry, Event } from './contract'
import { mutation } from './_generated/server'

/**
 * Extraction output arrives unvalidated on purpose: the canonical Effect schema
 * (contract.ts) is the validation authority, and a failed extraction must never
 * block the capture — the raw transcript is preserved either way.
 *
 * The adapter wraps before decode: `_tag` is injected when the caller omitted
 * it, and undefined-valued keys are dropped (explicit null/undefined is not in
 * the contract; encode strips undefined optionals).
 */
function withEventTag(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value !== undefined) cleaned[key] = value
  }
  if (cleaned._tag === undefined) cleaned._tag = 'Event'
  return cleaned
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export const createEntry = mutation({
  args: {
    childId: v.id('children'),
    // Idempotency key: a retried capture must not double-write.
    captureId: v.string(),
    transcript: v.string(),
    authorId: v.string(),
    status: v.optional(v.union(v.literal('draft'), v.literal('published'))),
    events: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args) => {
    if (args.captureId.length === 0) {
      throw new ConvexError({
        code: 'INVALID_CAPTURE_ID',
        message: 'captureId must be a non-empty string',
      })
    }
    if (args.transcript.length === 0) {
      throw new ConvexError({
        code: 'EMPTY_TRANSCRIPT',
        message: 'transcript must be non-empty — there is no raw input to preserve',
      })
    }
    if (args.authorId.length === 0) {
      throw new ConvexError({
        code: 'INVALID_AUTHOR_ID',
        message: 'authorId must be a non-empty string',
      })
    }
    const status = args.status ?? 'draft'

    // Idempotency: the original capture wins. A retry with the same captureId
    // returns the existing entry without writing, even if the payload changed.
    const existing = await ctx.db
      .query('entries')
      .withIndex('by_capture_id', (q) => q.eq('captureId', args.captureId))
      .first()
    if (existing !== null) {
      return {
        status: 'idempotent_hit' as const,
        captureId: args.captureId,
        entryId: existing._id,
      }
    }

    const domainEvents: Event[] = []
    const eventErrors: { index: number; error: string }[] = []
    for (const [index, raw] of (args.events ?? []).entries()) {
      try {
        domainEvents.push(Schema.decodeUnknownSync(Event)(withEventTag(raw)))
      } catch (err) {
        eventErrors.push({ index, error: errorText(err) })
      }
    }

    // Assemble the domain entry and encode to wire form: unix-ms times,
    // undefined optionals stripped. The Convex schema validator (entryValidator
    // via schema.ts) guards the write itself.
    const domainEntry: Entry = {
      _tag: 'Entry',
      transcript: args.transcript,
      authorId: args.authorId,
      createdAt: new Date(),
      status,
      events: domainEvents,
    }
    const wire = Schema.encodeSync(Entry)(domainEntry)
    // Storage boundary: strip the wire-level `_tag` discriminators — Convex
    // rejects `_`-prefixed stored fields. timeline:list re-wraps them on read.
    const { _tag: _entryTag, ...entryWire } = wire
    const events = entryWire.events.map(({ _tag: _eventTag, ...eventWire }) => eventWire)
    const entryId = await ctx.db.insert('entries', {
      ...entryWire,
      events,
      childId: args.childId,
      captureId: args.captureId,
    })

    if (eventErrors.length > 0) {
      return {
        status: 'captured_with_event_errors' as const,
        entryId,
        rawPreserved: true as const,
        eventErrors,
      }
    }
    return {
      status: 'created' as const,
      entryId,
      captureId: args.captureId,
      eventCount: domainEvents.length,
    }
  },
})
