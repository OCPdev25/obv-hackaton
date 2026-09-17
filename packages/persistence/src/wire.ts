import { Schema } from 'effect'
import { Entry, Event, TimelineItem } from '@journal/domain'
import type { Event as EventType, Entry as EntryType } from '@journal/domain'

/**
 * Wire codec. Domain types carry `Date` and readonly arrays; the Convex wire
 * carries unix-ms numbers and mutable arrays. Encoding/decoding runs through
 * the canonical Effect schemas at the adapter boundary — the schema is the
 * only authority for both directions, and the wire types are derived from it
 * (never restated). `_tag` stays on the wire per the contract.
 */

type EncodedEntry = (typeof Entry)['Encoded']
type EncodedEvent = EncodedEntry['events'][number]

export type WireEvent = EncodedEvent
export type WireEntry = Omit<EncodedEntry, 'events'> & { events: Array<EncodedEvent> }
export type WireTimelineItem = Omit<(typeof TimelineItem)['Encoded'], 'events'> & {
  events: Array<(typeof TimelineItem)['Encoded']['events'][number]>
}

export const encodeEntry = (entry: EntryType): WireEntry => {
  const encoded = Schema.encodeSync(Entry)(entry)
  return { ...encoded, events: Array.from(encoded.events) }
}

export const encodeEvents = (events: ReadonlyArray<EventType>): Array<WireEvent> =>
  Array.from(Schema.encodeSync(Schema.Array(Event))([...events]))

export const decodeTimeline = (wire: unknown): Array<Schema.Schema.Type<typeof TimelineItem>> =>
  Array.from(Schema.decodeUnknownSync(Schema.Array(TimelineItem))(wire))
