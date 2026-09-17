/**
 * Capture state machine — Foldkit-style, schema-described and inspectable.
 *
 * The state union, message union, and command union are all executable Effect
 * Schemas; their TS types are inferred. `update` is a pure, total function:
 * (state, message) => [state, commands]. Commands are named, tagged
 * descriptions of effects — they are only executed by the interpreter
 * (src/engine/interpreter.ts), which isolates the effectful operations behind
 * service interfaces.
 *
 * Stale-result suppression is structural: each flow run binds the captureId
 * from its own state; `captureStarted` in a non-idle state and any message
 * after the terminal `published` state are ignored.
 */
import { Schema } from "effect"
import { CaregiverId, CaptureId, ChildId, Event, Transcript } from "./schema.js"

// ---------------------------------------------------------------------------
// State — Idle / Recording / Transcribed / Extracting / Review / Published,
// plus the failure states the brief requires (validation failure with raw
// input preserved, and persistence failure).
// "Recording" covers text entry in this slice (voice capture stands in).
// ---------------------------------------------------------------------------

export const CaptureState = Schema.Union([
  Schema.Struct({ status: Schema.Literal("idle") }),
  Schema.Struct({ status: Schema.Literal("recording"), captureId: CaptureId, authorId: CaregiverId, childId: ChildId }),
  Schema.Struct({ status: Schema.Literal("transcribed"), captureId: CaptureId, authorId: CaregiverId, childId: ChildId, transcript: Transcript }),
  Schema.Struct({ status: Schema.Literal("extracting"), captureId: CaptureId, authorId: CaregiverId, childId: ChildId, transcript: Transcript }),
  Schema.Struct({ status: Schema.Literal("review"), captureId: CaptureId, authorId: CaregiverId, childId: ChildId, transcript: Transcript, events: Schema.Array(Event) }),
  Schema.Struct({ status: Schema.Literal("validationFailed"), captureId: CaptureId, authorId: CaregiverId, childId: ChildId, transcript: Transcript, reason: Schema.String }),
  Schema.Struct({ status: Schema.Literal("publishing"), captureId: CaptureId, authorId: CaregiverId, childId: ChildId, transcript: Transcript, events: Schema.Array(Event) }),
  Schema.Struct({ status: Schema.Literal("persistFailed"), captureId: CaptureId, authorId: CaregiverId, childId: ChildId, transcript: Transcript, events: Schema.Array(Event), reason: Schema.String }),
  Schema.Struct({ status: Schema.Literal("published"), captureId: CaptureId, authorId: CaregiverId, childId: ChildId, transcript: Transcript, events: Schema.Array(Event), recordId: Schema.String }),
])
export type CaptureState = Schema.Schema.Type<typeof CaptureState>

export const idleCaptureState: CaptureState = { status: "idle" }

export const isTerminalCaptureState = (state: CaptureState): boolean => state.status === "published"

// ---------------------------------------------------------------------------
// Messages — tagged union driving all transitions.
// ---------------------------------------------------------------------------

export const CaptureMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal("captureStarted"), captureId: CaptureId, authorId: CaregiverId, childId: ChildId }),
  Schema.Struct({ type: Schema.Literal("textEntered"), transcript: Transcript }),
  Schema.Struct({ type: Schema.Literal("extractionStarted") }),
  Schema.Struct({ type: Schema.Literal("extractionSucceeded"), events: Schema.Array(Event) }),
  Schema.Struct({ type: Schema.Literal("extractionFailed"), reason: Schema.String }),
  Schema.Struct({ type: Schema.Literal("retryRequested") }),
  Schema.Struct({ type: Schema.Literal("publishRequested") }),
  Schema.Struct({ type: Schema.Literal("persistSucceeded"), recordId: Schema.String }),
  Schema.Struct({ type: Schema.Literal("persistFailed"), reason: Schema.String }),
])
export type CaptureMessage = Schema.Schema.Type<typeof CaptureMessage>

// ---------------------------------------------------------------------------
// Commands — named effect requests, interpreted (never executed inline).
// Self-contained: each command carries every piece of data its interpreter
// needs, so the interpreter never re-reads state fields (update stays pure,
// and no Date/timestamp is minted inside it).
// ---------------------------------------------------------------------------

export const CaptureCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("extractEvents"),
    captureId: CaptureId,
    authorId: CaregiverId,
    transcript: Transcript,
  }),
  Schema.Struct({
    type: Schema.Literal("persistCapture"),
    captureId: CaptureId,
    childId: ChildId,
    authorId: CaregiverId,
    transcript: Transcript,
    events: Schema.Array(Event),
  }),
])
export type CaptureCommand = Schema.Schema.Type<typeof CaptureCommand>

// ---------------------------------------------------------------------------
// The pure update. Every (state, message) combination is handled; impossible
// combinations return the state unchanged and no commands.
// ---------------------------------------------------------------------------

export const update = (
  state: CaptureState,
  message: CaptureMessage,
): readonly [CaptureState, ReadonlyArray<CaptureCommand>] => {
  switch (state.status) {
    case "idle":
      if (message.type !== "captureStarted") return [state, []]
      return [
        { status: "recording", captureId: message.captureId, authorId: message.authorId, childId: message.childId },
        [],
      ]

    case "recording":
      if (message.type !== "textEntered") return [state, []]
      return [
        { ...state, status: "transcribed", transcript: message.transcript },
        [{ type: "extractEvents", captureId: state.captureId, authorId: state.authorId, transcript: message.transcript }],
      ]

    case "transcribed":
      if (message.type !== "extractionStarted") return [state, []]
      return [{ ...state, status: "extracting" }, []]

    case "extracting":
      switch (message.type) {
        case "extractionSucceeded":
          return [{ ...state, status: "review", events: message.events }, []]
        case "extractionFailed":
          // Raw transcript stays in state — validation failure never loses input.
          return [{ ...state, status: "validationFailed", reason: message.reason }, []]
        default:
          return [state, []]
      }

    case "validationFailed":
      if (message.type !== "retryRequested") return [state, []]
      // Retry re-extracts from the PRESERVED transcript — no re-entry, no data loss.
      return [
        { ...state, status: "extracting" },
        [{ type: "extractEvents", captureId: state.captureId, authorId: state.authorId, transcript: state.transcript }],
      ]

    case "review":
      if (message.type !== "publishRequested") return [state, []]
      return [
        { ...state, status: "publishing" },
        [
          {
            type: "persistCapture",
            captureId: state.captureId,
            childId: state.childId,
            authorId: state.authorId,
            transcript: state.transcript,
            events: state.events,
          },
        ],
      ]

    case "publishing":
      switch (message.type) {
        case "persistSucceeded":
          return [{ ...state, status: "published", recordId: message.recordId }, []]
        case "persistFailed":
          return [{ ...state, status: "persistFailed", reason: message.reason }, []]
        default:
          return [state, []]
      }

    case "persistFailed":
      if (message.type !== "retryRequested") return [state, []]
      return [
        { ...state, status: "publishing" },
        [
          {
            type: "persistCapture",
            captureId: state.captureId,
            childId: state.childId,
            authorId: state.authorId,
            transcript: state.transcript,
            events: state.events,
          },
        ],
      ]

    case "published":
      // Terminal — the capture is durable; later messages are ignored.
      return [state, []]
  }
}
