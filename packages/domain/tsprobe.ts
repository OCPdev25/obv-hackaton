import { Schema } from 'effect'

const CaptureId = Schema.NonEmptyString.pipe(Schema.brand('CaptureId'))

// V1: TaggedStruct WITH branded field
const t1 = Schema.TaggedStruct('Recording', { captureId: CaptureId, startedAt: Schema.DateFromMillis })
// V2: TaggedStruct WITHOUT brand
const t2 = Schema.TaggedStruct('Recording', { captureId: Schema.NonEmptyString, startedAt: Schema.DateFromMillis })
// V3: plain Struct WITH brand + literal tag field
const t3 = Schema.Struct({ _tag: Schema.Literals(['Recording']), captureId: CaptureId, startedAt: Schema.DateFromMillis })
// V4: plain Struct with optional field + brand
const t4 = Schema.Struct({ _tag: Schema.Literals(['Review']), captureId: CaptureId, lastError: Schema.optionalKey(Schema.Struct({ detail: Schema.String })) })

// Discrimination: narrow union and touch the branded field
const u1 = Schema.Union([t1, Schema.TaggedStruct('Idle', {})])
type U1 = Schema.Schema.Type<typeof u1>
const f1 = (m: U1): string => (m._tag === 'Recording' ? m.captureId : 'idle')

const u3 = Schema.Union([t3, Schema.TaggedStruct('Idle', {})])
type U3 = Schema.Schema.Type<typeof u3>
const f3 = (m: U3): string => (m._tag === 'Recording' ? m.captureId : 'idle')

void f1; void f3; void t2; void t4
