/**
 * React wiring for the capture flow: UI dispatches messages; this hook runs
 * the interpreter against the current state with LIVE services (Convex
 * repository + deterministic extraction double) provided at this composition
 * boundary. Intermediate states are surfaced to the UI as they land.
 */
import { useCallback, useRef, useState } from "react"
import { Effect } from "effect"
import { idleCaptureState, type CaptureMessage, type CaptureState } from "../domain/captureState.js"
import { CaptureRepositoryService, ExtractionService, type CaptureRepositoryApi, type ExtractionApi } from "../domain/services.js"
import { runCaptureFlow } from "../engine/interpreter.js"
import { makeDeterministicExtraction } from "../services/extraction.js"
import { makeConvexRepository } from "../services/repository.js"

interface FlowServices {
  readonly extraction: ExtractionApi
  readonly repository: CaptureRepositoryApi
}

export const useCaptureFlow = (convexUrl: string): { state: CaptureState; dispatch: (messages: ReadonlyArray<CaptureMessage>) => void } => {
  const [state, setState] = useState<CaptureState>(idleCaptureState)
  const stateRef = useRef<CaptureState>(idleCaptureState)
  const runningRef = useRef(false)
  const pendingRef = useRef<CaptureMessage[]>([])
  const servicesRef = useRef<FlowServices | null>(null)

  const getServices = (): FlowServices => {
    if (servicesRef.current === null) {
      servicesRef.current = {
        extraction: makeDeterministicExtraction(),
        repository: makeConvexRepository(convexUrl),
      }
    }
    return servicesRef.current
  }

  const pump = useCallback(() => {
    if (runningRef.current) return
    const pending = pendingRef.current
    if (pending.length === 0) return
    pendingRef.current = []
    runningRef.current = true
    const services = getServices()
    const program = runCaptureFlow(stateRef.current, pending, {
      onStateChange: (next) => {
        stateRef.current = next
        setState(next)
      },
    }).pipe(
      Effect.provideService(ExtractionService, services.extraction),
      Effect.provideService(CaptureRepositoryService, services.repository),
    )
    // The interpreter's error channel is never (all failures are data); any
    // rejection here would be a composition bug and surfaces as an unhandled
    // rejection rather than being swallowed.
    void Effect.runPromise(program).then(() => {
      runningRef.current = false
      pump()
    })
  }, [])

  const dispatch = useCallback(
    (messages: ReadonlyArray<CaptureMessage>) => {
      pendingRef.current.push(...messages)
      pump()
    },
    [pump],
  )

  return { state, dispatch }
}
