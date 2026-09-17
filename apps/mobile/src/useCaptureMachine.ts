import { ConvexHttpClient } from "convex/browser"
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "@journal/backend/_generated/api"
import {
  extractDeterministic,
  newCaptureId,
  update,
  type CaptureCommand,
  type CaptureMessage,
  type CaptureState,
} from "@journal/contracts"

/**
 * The capture runtime: drives the pure [state, commands] machine from
 * @journal/contracts and executes the named commands against the LOCAL
 * self-hosted Convex backend (LOCAL-REAL persistence — not a test double).
 *
 * Extraction runs the deterministic keyword rules (CONTROLLED TEST DOUBLE —
 * also the shipping offline fallback). The live-LLM path is a Convex action
 * and is CLOUD-ABSENT in this slice: no cloud deployment or LLM keys are
 * used; nothing here pretends otherwise.
 */

const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210"
const CONTEXT = { childId: "child_demo_maya", authorCaregiverId: "cg_demo_alex" }
const SCHEMA_VERSION = 1

export type TimelineEntry = {
  readonly _id: string
  readonly captureId: string
  readonly occurredAt: number
  readonly event: unknown
}

export type CapturePhase =
  | "idle"
  | "recording"
  | "transcribed"
  | "extracting"
  | "review"
  | "published"

const client = new ConvexHttpClient(CONVEX_URL)

export function useCaptureMachine() {
  const stateRef = useRef<CaptureState>({ _tag: "Idle" })
  const [state, setState] = useState<CaptureState>(stateRef.current)
  const [timeline, setTimeline] = useState<readonly TimelineEntry[]>([])
  const [rawText, setRawText] = useState("She ate most of her pasta at lunch")
  const corruptNextRef = useRef(false)
  const [corruptNext, setCorruptNext] = useState(false)

  const refreshTimeline = useCallback(async () => {
    const entries = await client.query(api.captures.listEntries, { childId: CONTEXT.childId })
    setTimeline(entries as readonly TimelineEntry[])
  }, [])

  useEffect(() => {
    void refreshTimeline()
  }, [refreshTimeline])

  const publishArgsFrom = (review: Extract<CaptureState, { _tag: "Review" }>) => ({
    captureId: review.captureId,
    childId: CONTEXT.childId,
    authorCaregiverId: CONTEXT.authorCaregiverId,
    rawText: review.rawText,
    occurredAt: review.occurredAt,
    schemaVersion: SCHEMA_VERSION,
  })

  const executeCommand = useCallback(
    async (next: CaptureState, command: CaptureCommand) => {
      if (command._tag === "PersistCaptureRaw") {
        try {
          await client.mutation(api.captures.persistCaptureRaw, {
            captureId: command.captureId,
            childId: command.childId,
            authorCaregiverId: command.authorCaregiverId,
            rawText: command.rawText,
            occurredAt: command.occurredAt,
            schemaVersion: SCHEMA_VERSION,
          })
          dispatch({ _tag: "ExtractionRequested" })
        } catch (error) {
          dispatch({ _tag: "PersistCaptureFailed", reason: String(error).slice(0, 200) })
        }
        return
      }
      if (command._tag === "Extract" && next._tag === "Extracting") {
        // Deterministic extraction runs in the client runtime. Corruption
        // toggle demonstrates the validation-failure + retry loop live.
        const event = extractDeterministic({
          captureId: next.captureId,
          rawText: next.rawText,
          occurredAt: next.occurredAt,
        })
        if (corruptNextRef.current && event !== undefined && event._tag === "meal") {
          corruptNextRef.current = false
          setCorruptNext(false)
          // Intentionally invalid payload — simulates a misbehaving extraction
          // adapter. Legal as JSON on the wire, illegal in the domain type; the
          // backend's JournalEvent decode is the authority that catches it.
          const corrupted = { ...event, amount: "half" } as unknown as typeof event
          dispatch({ _tag: "ExtractionSucceeded", event: corrupted })
          return
        }
        if (event === undefined) {
          dispatch({ _tag: "ExtractionFailed", reason: "unclassified: no rule matched" })
        } else {
          dispatch({ _tag: "ExtractionSucceeded", event })
        }
        return
      }
      if (command._tag === "PublishEvent" && next._tag === "Review") {
        try {
          const result = await client.mutation(api.captures.publishEvent, {
            ...publishArgsFrom(next),
            event: command.event,
          })
          dispatch({ _tag: "PublishSucceeded", entryId: result.entryId, publishedAt: Date.now() })
          void refreshTimeline()
        } catch (error) {
          dispatch({ _tag: "PublishFailed", reason: String(error).slice(0, 200) })
        }
        return
      }
      if (command._tag === "PublishRawOnly" && next._tag === "Review") {
        try {
          const result = await client.mutation(api.captures.publishRawOnly, publishArgsFrom(next))
          dispatch({ _tag: "PublishSucceeded", entryId: result.entryId, publishedAt: Date.now() })
          void refreshTimeline()
        } catch (error) {
          dispatch({ _tag: "PublishFailed", reason: String(error).slice(0, 200) })
        }
      }
    },
    [refreshTimeline]
  )

  const dispatch = useCallback(
    (message: CaptureMessage) => {
      const [next, commands] = update(stateRef.current, message, CONTEXT)
      stateRef.current = next
      setState(next)
      for (const command of commands) {
        void executeCommand(next, command)
      }
    },
    [executeCommand]
  )

  const startCapture = useCallback(() => {
    corruptNextRef.current = corruptNext // snapshot the toggle for this capture
    dispatch({ _tag: "StartRecording" })
    const captureId = newCaptureId()
    dispatch({
      _tag: "StopRecording",
      rawText,
      captureId,
      occurredAt: Date.now(),
    })
  }, [dispatch, rawText])

  const retryPublishCorrected = useCallback(() => {
    // Correct the out-of-vocabulary amount and republish on the SAME captureId.
    const review = stateRef.current
    if (review._tag !== "Review" || review.event === undefined || review.event._tag !== "meal") return
    dispatch({ _tag: "EventEdited", event: { ...review.event, amount: "none" } })
    dispatch({ _tag: "PublishRequested" })
  }, [dispatch])

  const publish = useCallback(() => dispatch({ _tag: "PublishRequested" }), [dispatch])
  const reset = useCallback(() => dispatch({ _tag: "Reset" }), [dispatch])

  const phase: CapturePhase = state._tag.toLowerCase() as CapturePhase
  return {
    state,
    phase,
    timeline,
    rawText,
    setRawText,
    corruptNext,
    setCorruptNext,
    startCapture,
    publish,
    retryPublishCorrected,
    reset,
    refreshTimeline,
  }
}
