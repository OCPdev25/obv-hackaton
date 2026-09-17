/**
 * Named effectful commands (Foldkit R4): pure data descriptions of the side
 * effects the capture state machine may need. The update function never runs
 * them — `runtime.executeCommand` maps each to a service effect and feeds the
 * resulting result-message back into the same update loop.
 */
import type { CaregiverId, ChildId, CaptureId } from "@journal/domain"
import type { Event } from "@journal/domain"

export interface ExtractEvents {
  readonly _tag: "ExtractEvents"
  readonly captureId: CaptureId
  readonly childId: ChildId
  readonly authorId: CaregiverId
  readonly transcript: string
}

export interface PublishEntry {
  readonly _tag: "PublishEntry"
  readonly captureId: CaptureId
  readonly childId: ChildId
  readonly authorId: CaregiverId
  readonly transcript: string
  readonly createdAt: Date
  readonly events: ReadonlyArray<Event>
}

export type CaptureCommand = ExtractEvents | PublishEntry

export type CommandName = CaptureCommand["_tag"]
