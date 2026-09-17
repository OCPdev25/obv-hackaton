import { Effect, Layer } from 'effect'
import { ConvexHttpClient } from 'convex/browser'
import { fixtureChild, type PublishOutcome, type StoreError, type TimelineItem } from '@journal/domain'
import { convexStoreLayer, inMemoryStoreLayer, makeConvexCaptureStore, makeInMemoryCaptureStore } from '@journal/persistence'
import { deterministicExtractorLayer } from '@journal/extraction'
import { JOURNEY_CAPTURE_ID, runJourney, withScriptedOutage } from './journey.js'
import type { JourneyDeps } from './journey.js'

const args = process.argv.slice(2)
const mode = args.includes('--store=convex') ? 'convex' : 'memory'
const urlArg = args.find((a: string) => a.startsWith('--url='))
const url = urlArg === undefined ? 'http://127.0.0.1:3210' : urlArg.slice(6)

const buildDeps = () => {
  if (mode === 'convex') {
    return {
      deps: {
        mode,
        republish: (): Effect.Effect<PublishOutcome, StoreError> =>
          makeConvexCaptureStore(new ConvexHttpClient(url)).publish({ captureId: JOURNEY_CAPTURE_ID, events: [] }),
        readTimeline: (): Effect.Effect<ReadonlyArray<TimelineItem>, StoreError> =>
          makeConvexCaptureStore(new ConvexHttpClient(url)).timeline(fixtureChild.childId),
      } satisfies JourneyDeps,
      storeLayer: convexStoreLayer(url),
    }
  }
  const mem = makeInMemoryCaptureStore()
  const store = withScriptedOutage(mem.store, JOURNEY_CAPTURE_ID)
  return {
    deps: {
      mode,
      republish: (): Effect.Effect<PublishOutcome, StoreError> =>
        store.publish({ captureId: JOURNEY_CAPTURE_ID, events: [] }),
      readTimeline: (): Effect.Effect<ReadonlyArray<TimelineItem>, StoreError> => store.timeline(fixtureChild.childId),
    } satisfies JourneyDeps,
    // The SAME wrapped store handle powers the dispatch layer and the probes.
    storeLayer: inMemoryStoreLayer(store),
  }
}

const { deps, storeLayer } = buildDeps()
const env = Layer.merge(storeLayer, deterministicExtractorLayer)

Effect.runPromise(Effect.provide(runJourney(deps), env)).catch((error: unknown) => {
  process.stderr.write(`journey failed: ${String(error)}\n`)
  process.exit(1)
})
