import { Schema } from 'effect'

/**
 * Branded identifiers. Every id decodes from a plain non-empty string at the
 * boundary and is branded in domain code, so ids cannot be cross-assigned.
 */
export const ChildId = Schema.NonEmptyString.pipe(Schema.brand('ChildId'))
export type ChildId = Schema.Schema.Type<typeof ChildId>

export const CaregiverId = Schema.NonEmptyString.pipe(Schema.brand('CaregiverId'))
export type CaregiverId = Schema.Schema.Type<typeof CaregiverId>

/** Stable, client-generated idempotency key for a capture. */
export const CaptureId = Schema.NonEmptyString.pipe(Schema.brand('CaptureId'))
export type CaptureId = Schema.Schema.Type<typeof CaptureId>

/** Convex document id of a persisted entry. */
export const EntryId = Schema.NonEmptyString.pipe(Schema.brand('EntryId'))
export type EntryId = Schema.Schema.Type<typeof EntryId>
