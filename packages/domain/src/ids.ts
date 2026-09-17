/**
 * Branded single-value identifiers (OpenCode rule: Schema.brand for every ID).
 * Brands add nominal type safety only — no runtime change — so the wire value
 * is still a plain string everywhere (Convex, JSON, logs).
 */
import { Schema } from "effect"

export const ChildId = Schema.NonEmptyString.pipe(Schema.brand("ChildId"))
export type ChildId = Schema.Schema.Type<typeof ChildId>

export const CaregiverId = Schema.NonEmptyString.pipe(Schema.brand("CaregiverId"))
export type CaregiverId = Schema.Schema.Type<typeof CaregiverId>

/** Minted client-side at capture start; stable across validation retries and publish retries. */
export const CaptureId = Schema.NonEmptyString.pipe(Schema.brand("CaptureId"))
export type CaptureId = Schema.Schema.Type<typeof CaptureId>

/** Assigned by the persistence layer; absent until an entry is first stored. */
export const EntryId = Schema.NonEmptyString.pipe(Schema.brand("EntryId"))
export type EntryId = Schema.Schema.Type<typeof EntryId>
