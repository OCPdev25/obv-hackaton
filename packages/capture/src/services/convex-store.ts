/**
 * LOCAL-REAL Convex persistence layer. Speaks the wire contract (millis,
 * plain strings) via encodeEntry/decodeEntryResult and talks to whatever
 * backend URL it is given — in this slice always the local dev backend
 * (`convex dev` local mode), never a cloud deployment.
 */
import { ConvexHttpClient } from "convex/browser"

import type { Entry } from "@journal/domain"
import { decodeEntryResult, encodeEntry } from "@journal/domain"
import { Effect, Layer, Result } from "effect"

import { EntryStore, PublishError, ReadError } from "./entries.js"

type MutationFnName = Parameters<ConvexHttpClient["mutation"]>[0]
type QueryFnName = Parameters<ConvexHttpClient["query"]>[0]
// Convex function references are phantom-tagged strings; string names are the
// documented runtime form, so the cast only recovers the tag, never changes data.
const asMutationName = (name: string): MutationFnName => name as unknown as MutationFnName
const asQueryName = (name: string): QueryFnName => name as unknown as QueryFnName

export const makeConvexEntryStoreLayer = (url: string): Layer.Layer<EntryStore, never, never> =>
  Layer.effect(
    EntryStore,
    Effect.sync(() => {
      const client = new ConvexHttpClient(url)
      return {
        publish: (draft: Entry) =>
          Effect.tryPromise({
            // Convex reserves _-prefixed field names; the stored shape omits
            // the constant discriminator and the function restores it on read.
            try: () => {
              const { _tag: _omitted, ...storeArgs } = encodeEntry(draft)
              return client.mutation(asMutationName("entries:publishEntry"), storeArgs)
            },
            catch: (error) =>
              new PublishError({
                captureId: draft.captureId,
                reason: error instanceof Error ? error.message : String(error),
              }),
          }).pipe(
            Effect.flatMap((wire) => {
              const decoded = decodeEntryResult(wire)
              if (Result.isSuccess(decoded)) return Effect.succeed(decoded.success)
              return Effect.fail(
                new PublishError({
                  captureId: draft.captureId,
                  reason: `stored entry failed decode: ${String(decoded.failure)}`,
                }),
              )
            }),
          ),
        timeline: (childId) =>
          Effect.tryPromise({
            try: () => client.query(asQueryName("entries:timelineForChild"), { childId }),
            catch: (error) =>
              new ReadError({
                childId,
                reason: error instanceof Error ? error.message : String(error),
              }),
          }).pipe(
            Effect.flatMap((wire) => {
              if (!Array.isArray(wire)) {
                return Effect.fail(new ReadError({ childId, reason: "timeline response is not an array" }))
              }
              const entries: Entry[] = []
              for (const row of wire) {
                const decoded = decodeEntryResult(row)
                if (Result.isSuccess(decoded)) {
                  entries.push(decoded.success)
                  continue
                }
                return Effect.fail(
                  new ReadError({
                    childId,
                    reason: `timeline row failed decode: ${String(decoded.failure)}`,
                  }),
                )
              }
              return Effect.succeed(entries)
            }),
          ),
      }
    }),
  )
