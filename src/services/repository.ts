/**
 * Capture repository implementations.
 *
 * PROVIDER LABEL — persistence:
 *   - makeConvexRepository: LIVE local persistence (real Convex dev backend
 *     over HTTP; documents are durably stored in the local backend's storage).
 *   - makeInMemoryRepository: controlled test double mirroring the server's
 *     captureId idempotency contract for fast deterministic unit tests.
 *   - Cloud/production deployment: NOT exercised in this candidate (labeled
 *     absence — no Convex cloud deploy was made).
 */
import { ConvexHttpClient } from "convex/browser"
import { Effect, Schema } from "effect"
import { api } from "../../convex/_generated/api.js"
import { Entry, PublishOutput, type EntryWire } from "../domain/schema.js"
import type { CaptureRepositoryApi, RepositoryError } from "../domain/services.js"

const explain = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Live persistence against a Convex backend (local dev backend in this slice). */
export const makeConvexRepository = (url: string): CaptureRepositoryApi => {
  const client = new ConvexHttpClient(url)
  return {
    publish: (entry) =>
      Effect.tryPromise({
        try: async () => {
          // Domain → wire: Date fields become unix-ms numbers, absent optional
          // keys are stripped. The wire payload is what the server's args
          // validator (and then the server-side Effect decode) sees.
          const wire: EntryWire = Schema.encodeSync(Entry)(entry)
          // The generated args type wants a mutable events array; the wire
          // form is readonly. Shallow copies only — values stay untouched.
          const output = await client.mutation(api.captures.publishCapture, { ...wire, events: [...wire.events] })
          // Boundary decode of the server response — the client never trusts
          // untyped server data.
          return Schema.decodeUnknownSync(PublishOutput)(output)
        },
        catch: (error): RepositoryError => ({
          reason: "transport",
          detail: `publishCapture rejected: ${explain(error)}`,
        }),
      }),
  }
}

export interface InMemoryRecord {
  readonly recordId: string
  readonly entry: Entry
}

/**
 * Controlled test double. Mirrors the server contract: publishing the same
 * captureId twice returns the first result with duplicate: true and never
 * stores a second record.
 */
export interface InMemoryCaptureRepository extends CaptureRepositoryApi {
  readonly published: ReadonlyMap<string, InMemoryRecord>
}

export const makeInMemoryRepository = (): InMemoryCaptureRepository => {
  const records = new Map<string, InMemoryRecord>()
  let sequence = 0
  return {
    published: records,
    publish: (entry) =>
      Effect.sync(() => {
        const existing = records.get(entry.captureId)
        if (existing !== undefined) {
          return { recordId: existing.recordId, duplicate: true, eventCount: existing.entry.events.length }
        }
        sequence += 1
        const recordId = `mem-record-${sequence}`
        records.set(entry.captureId, { recordId, entry })
        return { recordId, duplicate: false, eventCount: entry.events.length }
      }),
  }
}
