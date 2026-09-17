/**
 * Named effectful commands (Foldkit R4): pure data descriptions of the side
 * effects the capture state machine may need. The update function never runs
 * them — `runtime.executeCommand` maps each to a service effect and feeds the
 * resulting result-message back into the same update loop.
 *
 * Command set (base: candidate D; grafts: candidate C):
 *  - PersistRawDraft — raw-first durable draft at TextCaptured (C).
 *  - AttachEvents — extracted events attach to the existing DRAFT entry
 *    (corpus status-model decision: fresh entries are drafts with events).
 *  - ExtractEvents / PublishEntry — candidate D's original commands, with
 *    PublishEntry narrowed to a status flip (the entry already exists).
 */
import type { CapturedEvent } from "./event.js"

import type { CaptureId } from "@journal/domain"

export interface ExtractEvents {
  readonly _tag: "ExtractEvents"
  readonly captureId: CaptureId
  readonly childId: string
  readonly authorId: string
  readonly transcript: string
  readonly capturedAt: number
  readonly timezone: string
}

export interface PersistRawDraft {
  readonly _tag: "PersistRawDraft"
  readonly captureId: CaptureId
  readonly childId: string
  readonly authorId: string
  readonly rawTranscript: string
  readonly createdAt: number
}

export interface AttachEvents {
  readonly _tag: "AttachEvents"
  readonly captureId: CaptureId
  readonly events: ReadonlyArray<CapturedEvent>
}

export interface PublishEntry {
  readonly _tag: "PublishEntry"
  readonly captureId: CaptureId
}

export type CaptureCommand = ExtractEvents | PersistRawDraft | AttachEvents | PublishEntry

export type CommandName = CaptureCommand["_tag"]
