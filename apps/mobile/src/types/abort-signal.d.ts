// React Native's global AbortSignal class (src/types/globals.d.ts) satisfies
// @types/node's `typeof globalThis extends { onmessage: any }` check, which
// empties node's AbortSignal augmentation — dropping `reason` from the merged
// global type. The spike's transcription port reads `signal.reason` for
// cancellation causes; restore it via interface merging.
interface AbortSignal {
  readonly reason: unknown
}
