/**
 * Home-candidate adapter seam v1 — the ONLY integration surface between the
 * parent-home journey pack and a home candidate.
 *
 * Mirrors the merged harness conventions (evaluation/src/adapter.ts):
 *   - factory contract: adapter modules export a named `createAdapter()`
 *     returning an object with a non-empty `name`;
 *   - wire rules: every record carries a literal `_tag`; instants are
 *     Unix-ms numbers; optional fields are ABSENT, never null;
 *   - refusals are typed values (`Refused`) with `disclosure: ''` — the
 *     type itself forbids leaking a reason string to an unauthorized actor.
 *
 * A candidate implements this seam for the machine-checkable protocols P1-P6.
 * Where a candidate's deliverable form cannot host the seam (e.g., a
 * non-persistent prototype), its journeys run as scripted evidence and the
 * pack runs only where hostable — recorded per candidate in the rubric (§9).
 */

export type CaptureMode = 'voice-transcript' | 'text'

export type EventCategory = 'potty' | 'meal' | 'sleep' | 'mood' | 'milestone' | 'school'

export interface Quantity {
  readonly value: number
  readonly unit: string
}

export interface CaptureInput {
  readonly captureId: string
  /** Monotonic attempt for this captureId — only the latest attempt may win (P5). */
  readonly attempt: number
  readonly mode: CaptureMode
  /** The utterance, byte-for-byte. Adapters must not trim or normalize. */
  readonly raw: string
  readonly actorId: string
  readonly childId: string
  readonly capturedAt: number
  readonly timezone: string
}

export interface ProposedEvent {
  readonly _tag: 'ProposedEvent'
  readonly localId: string
  readonly category: EventCategory
  /** Absolute instant, Unix ms. ABSENT when unresolved — never null, never fabricated (G5). */
  readonly occurredAt?: number
  readonly quantity?: Quantity
  readonly note?: string
  readonly confidence: number
  /** Traceability into the raw transcript (substring); absent when not resolvable. */
  readonly sourceSpan?: string
}

export type SubmitResult =
  | {
      readonly _tag: 'Proposed'
      readonly captureId: string
      readonly attempt: number
      readonly proposals: readonly ProposedEvent[]
      /** SHA-256 of the raw transcript as stored — byte-fidelity check (G3). */
      readonly rawSha256: string
    }
  | {
      readonly _tag: 'ClarificationNeeded'
      readonly captureId: string
      readonly attempt: number
      readonly question: string
      readonly rawSha256: string
    }
  | { readonly _tag: 'Superseded'; readonly captureId: string; readonly attempt: number; readonly winnerAttempt: number }
  | { readonly _tag: 'Refused'; readonly reason: 'unauthorized' | 'invalid-actor' | 'out-of-scope-child'; readonly disclosure: '' }

export type CorrectionAction =
  | { readonly _tag: 'Patch'; readonly fields: Partial<Pick<ProposedEvent, 'category' | 'occurredAt' | 'quantity' | 'note'>> }
  | { readonly _tag: 'Reject' }

export interface CorrectionInput {
  readonly captureId: string
  readonly eventLocalId: string
  readonly action: CorrectionAction
  readonly authorId: string
  /** Natural-language statement when correcting via NL; must resolve to eventLocalId or return UnresolvedReference. */
  readonly viaStatement?: string
}

export type CorrectionResult =
  | {
      readonly _tag: 'Revised'
      readonly revisionId: string
      readonly supersedes: string
      readonly originalPreserved: true
      readonly byActorId: string
    }
  | { readonly _tag: 'UnresolvedReference'; readonly question: string }
  | { readonly _tag: 'Refused'; readonly reason: 'unauthorized' | 'invalid-actor'; readonly disclosure: '' }

export interface PublishReceipt {
  readonly entryId: string
  readonly proposalHash: string
  readonly wroteAt: number
  readonly authoredBy: string
}

export type PublishResult =
  | { readonly _tag: 'Published'; readonly receipt: PublishReceipt; readonly idempotentHit: false }
  | { readonly _tag: 'AlreadyPublished'; readonly receipt: PublishReceipt; readonly idempotentHit: true }
  | { readonly _tag: 'Refused'; readonly reason: 'unauthorized' | 'nothing-proposed'; readonly disclosure: '' }

export interface HistoryQuery {
  readonly actorId: string
  readonly childId: string
  readonly from: number
  readonly to: number
}

export interface HistoryGap {
  readonly _tag: 'HistoryGap'
  /** Household-local day (YYYY-MM-DD) with no data. */
  readonly day: string
  readonly reason: 'no-data'
}

export interface HistoryEvent {
  readonly _tag: 'Event'
  readonly eventId: string
  readonly entryId: string
  readonly category: EventCategory
  readonly occurredAt: number
  readonly quantity?: Quantity
  readonly note?: string
  readonly authorId: string
  /** True when a later revision supersedes this record; lineage holds the original (G6). */
  readonly superseded?: true
}

export type HistoryResult =
  | {
      readonly _tag: 'History'
      readonly events: readonly HistoryEvent[]
      readonly gaps: readonly HistoryGap[]
      /** The query window was honored exactly — nothing outside [from, to]. */
      readonly windowRespected: true
    }
  | { readonly _tag: 'Refused'; readonly reason: 'unauthorized' | 'out-of-scope-child'; readonly disclosure: '' }

export interface AskInput {
  readonly actorId: string
  readonly childId: string
  readonly question: string
  readonly askAt: number
}

export interface AnswerCitation {
  readonly entryId: string
  readonly eventId?: string
}

export type AskResult =
  | {
      readonly _tag: 'Answer'
      readonly answer: string
      readonly citations: readonly AnswerCitation[]
      /** Literal — the answer surface declares zero writes (G4, proven by P3 state equality). */
      readonly wrote: false
    }
  | { readonly _tag: 'Refused'; readonly reason: 'unauthorized' | 'out-of-scope-child'; readonly disclosure: '' }

export interface LineageQuery {
  readonly captureId: string
  readonly actorId: string
}

export interface RevisionRecord {
  readonly revisionId: string
  readonly eventLocalId: string
  readonly action: CorrectionAction
  readonly supersedes: string
  readonly byActorId: string
  /** The full superseded state — originals always retrievable (G6). */
  readonly original: ProposedEvent
}

export type LineageResult =
  | {
      readonly _tag: 'Lineage'
      readonly captureId: string
      readonly revisions: readonly RevisionRecord[]
      /** Verbatim raw transcript as stored (G3 evidence surface). */
      readonly originalRaw: string
    }
  | { readonly _tag: 'Refused'; readonly reason: 'unauthorized'; readonly disclosure: '' }

export interface HomeCandidateAdapter {
  /** Non-empty; identifies the candidate in run output. */
  readonly name: string
  /** Raw-first capture: persist the utterance byte-for-byte, then propose typed events. */
  submitCapture(input: CaptureInput): Promise<SubmitResult>
  /** Append-only correction: patch or reject; the original stays retrievable. */
  applyCorrection(input: CorrectionInput): Promise<CorrectionResult>
  /** Idempotent publish keyed by captureId — one write, one receipt, forever. */
  publishCapture(captureId: string, actorId: string): Promise<PublishResult>
  /** Windowed, audience-respecting, gap-disclosing history read. */
  readHistory(query: HistoryQuery): Promise<HistoryResult>
  /** Read-only question surface: answers cite sources and never write. */
  askQuestion(input: AskInput): Promise<AskResult>
  /** Revision lineage for one capture: every correction plus the originals. */
  readLineage(query: LineageQuery): Promise<LineageResult>
}
