/**
 * Local smoke test for the canonical contract — run with `npm run contract:smoke`.
 * Verifies the Effect v4 API surface the thin path depends on BEFORE deploying:
 * decode acceptance/rejection, refinement bounds, and encode wire rules
 * (unix-ms times, undefined optionals stripped).
 */
import * as Schema from 'effect/Schema'
import { Entry, Event } from '../convex/contract'

const show = (label: string, value: unknown) => console.log(`${label}: ${JSON.stringify(value)}`)

const wireEvent = {
  _tag: 'Event',
  category: 'potty',
  occurredAt: 1726500000000,
  quantity: { value: 2 },
  confidence: 1,
  authorId: 'gil_test_operator',
  note: 'morning, before preschool',
}

const decoded = Schema.decodeUnknownSync(Event)(wireEvent)
show('decode ok — encoded back to wire', Schema.encodeSync(Event)(decoded))

// Absent optionals stay absent on the wire after a decode/encode round trip.
show(
  'absent optionals stripped',
  Schema.encodeSync(
    Event,
  )(
    Schema.decodeUnknownSync(Event)({
      _tag: 'Event',
      category: 'meal',
      occurredAt: 1726500100000,
      confidence: 0.5,
      authorId: 'gil_test_operator',
    }),
  ),
)

// Rejections: category outside the six literals, confidence out of [0,1],
// explicit null (not in the contract), occurredAt not unix-ms.
const rejections: [string, unknown][] = [
  ['category "nap" rejected', { ...wireEvent, category: 'nap' }],
  ['confidence 1.5 rejected', { ...wireEvent, confidence: 1.5 }],
  ['note null rejected', { ...wireEvent, note: null }],
  ['occurredAt string rejected', { ...wireEvent, occurredAt: '2026-09-17' }],
]
for (const [label, bad] of rejections) {
  try {
    Schema.decodeUnknownSync(Event)(bad)
    console.log(`${label}: UNEXPECTED PASS`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.log(`${label}: ${message.split('\n').slice(0, 3).join(' | ')}`)
  }
}

// Entry contract: empty events allowed (extraction failure never blocks
// capture); round trip through the canonical Entry schema.
const wireEntry = {
  _tag: 'Entry',
  transcript: 'raw dictated text stays verbatim',
  authorId: 'gil_test_operator',
  createdAt: 1726500200000,
  status: 'draft',
  events: [],
}
show('entry wire round-trip', Schema.encodeSync(Entry)(Schema.decodeUnknownSync(Entry)(wireEntry)))
