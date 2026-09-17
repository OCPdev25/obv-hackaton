import { ConvexHttpClient } from 'convex/browser'
import { Effect, Layer } from 'effect'
import { CaptureStore } from '@journal/domain'
import type { CaptureStoreShape } from '@journal/domain'
import { makeInMemoryCaptureStore } from './inMemoryStore.js'
import { makeConvexCaptureStore } from './convexStore.js'

/**
 * Store layers. The service interface is the seam: callers pick a layer, and
 * nothing downstream knows which implementation runs.
 */

export const inMemoryStoreLayer = (store: CaptureStoreShape = makeInMemoryCaptureStore().store): Layer.Layer<CaptureStore> =>
  Layer.effect(CaptureStore)(Effect.succeed(store))

export const convexStoreLayer = (url: string): Layer.Layer<CaptureStore> =>
  Layer.effect(CaptureStore)(Effect.succeed(makeConvexCaptureStore(new ConvexHttpClient(url))))

export { makeInMemoryCaptureStore, makeConvexCaptureStore }
export * from './wire.js'
