/**
 * Candidate-agnostic correction-adapter contract for the conversational
 * correction challenge corpus (evaluation/corrections).
 *
 * PROPOSAL-LEVEL: this observation view is intentionally narrower than the
 * canonical domain contracts (packages/domain). No correction/revision schema
 * exists there yet (contract v0.3 owns the lineage fold separately), so this
 * corpus evaluates candidates against a proposal-marked journal view instead
 * of touching canonical schemas. See corrections/README.md.
 *
 * A candidate adapter is a replaceable in-memory correction engine: it
 * receives conversational turns, returns an outcome class per turn, and
 * exposes the resulting journal view. Deterministic; no I/O, no LLM, no clock.
 */

export type EventCategory = 'potty' | 'meal' | 'sleep' | 'mood' | 'milestone' | 'school'
export type EntryStatus = 'draft' | 'published'
export type RevisionKind = 'capture' | 'correction' | 'undo' | 'cancel'
export type ChildGrant = 'read' | 'read-write'

export interface HouseholdChild {
  readonly childId: string
  readonly displayName: string
}

export interface HouseholdMember {
  readonly memberId: string
  readonly displayName: string
  readonly role: 'parent' | 'caregiver'
  readonly childGrants: Readonly<Record<string, ChildGrant>>
}

/** Shared synthetic household (evaluation/corrections/household-env.json). */
export interface HouseholdEnv {
  readonly householdId: string
  readonly timezone: string
  readonly children: readonly HouseholdChild[]
  readonly members: readonly HouseholdMember[]
}

/** Current-value event as observed in the journal view (lineage lives on revisions). */
export interface JournalEvent {
  readonly category: EventCategory
  readonly occurredAt: number
  readonly quantity?: { readonly value: number; readonly unit: string }
  readonly note?: string
}

export interface JournalEntry {
  readonly captureId: string
  readonly childId: string
  /** Original capture author — never rewritten by corrections. */
  readonly authorId: string
  /** Byte-faithful raw transcript — never mutated or deleted by corrections. */
  readonly rawTranscript: string
  readonly status: EntryStatus
  readonly events: readonly JournalEvent[]
}

export interface JournalRevision {
  readonly kind: RevisionKind
  readonly entryCaptureId: string
  /** Who made this revision (corrector / canceller / undoer). */
  readonly authorId: string
  readonly capturedAt: number
  /** Idempotency key when the turn carried one. */
  readonly correctionId?: string
  readonly summary: string
}

export interface JournalView {
  /** Entries in creation order; revisions in append order. */
  readonly entries: readonly JournalEntry[]
  readonly revisions: readonly JournalRevision[]
}

export interface UtteranceTurn {
  readonly turnId: string
  readonly speakerId: string
  readonly text: string
  readonly capturedAt: number
  readonly correctionId?: string
  /** For capture turns: the capture identity the recorded entry must use. */
  readonly captureId?: string
  /** Seed events mark a setup capture turn: the candidate records them as the entry's current events. */
  readonly seedEvents?: readonly JournalEvent[]
}

export type ResponseClass = 'applied' | 'clarification' | 'rejected'

export interface TurnOutcome {
  readonly responseClass: ResponseClass
  readonly reason?: string
}

export interface CorrectionCandidateAdapter {
  readonly name: string
  processTurn(turn: UtteranceTurn): Promise<TurnOutcome>
  /** Publication is runner-driven only; corrections must never change status. */
  publishEntry(captureId: string): Promise<void>
  readJournal(): Promise<JournalView>
}

/** Factory signature for correction adapters (env-dependent, unlike the capture corpus). */
export type CorrectionAdapterFactory = (env: HouseholdEnv) => CorrectionCandidateAdapter
