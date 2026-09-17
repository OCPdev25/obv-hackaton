/**
 * Deliberately faulty adapter — the harness's negative control.
 *
 * Faults (each must be caught by a different fixture):
 *  1. double-submit creates a DUPLICATE entry instead of replaying (breaks
 *     retry-double-submit and duplicate protection)
 *  2. transcripts are trimmed before storage (breaks byte fidelity)
 *
 * Run with --expect-failure: `bun src/run.ts --adapter=./src/example/broken-adapter.ts --expect-failure`
 * exits 0 iff the harness catches these faults.
 */
import type { CandidateAdapter, CreateEntryResult, EntryStatus, WireEvent } from '../adapter.ts'

interface StoreEntry {
  readonly _tag: 'Entry'
  readonly captureId: string
  readonly transcript: string // BUG (fault 2): trimmed before storage
  readonly authorId: string
  readonly createdAt: number
  readonly status: EntryStatus
  readonly events: readonly WireEvent[]
}

export function createAdapter(): CandidateAdapter {
  const store = new Map<string, StoreEntry>()

  return {
    name: 'broken (deliberate negative control — must fail the corpus)',

    async createEntry(input): Promise<CreateEntryResult> {
      const existing = store.get(input.captureId)
      if (existing !== undefined) {
        // BUG (fault 1): a retry persists a second entry instead of replaying.
        const dupe = {
          _tag: 'Entry' as const,
          captureId: `${input.captureId}#${store.size + 1}`,
          transcript: input.transcript.trim(),
          authorId: input.authorId,
          createdAt: input.capturedAt,
          status: 'draft' as const,
          events: existing.events,
        }
        store.set(dupe.captureId, dupe)
        return { _tag: 'Created', entry: dupe }
      }
      const entry = {
        _tag: 'Entry' as const,
        captureId: input.captureId,
        transcript: input.transcript.trim(),
        authorId: input.authorId,
        createdAt: input.capturedAt,
        status: 'draft' as const,
        events: [],
      }
      store.set(input.captureId, entry)
      return { _tag: 'Created', entry }
    },

    async readTimeline() {
      return [...store.values()]
    },

    async reload(): Promise<void> {
      // Reads are already cold-start equivalent (single Map = "durable" store).
    },
  }
}
