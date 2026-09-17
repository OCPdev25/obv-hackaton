import { Schema } from "effect"

/**
 * CaptureId is generated client-side when dictation ends and is the stable
 * idempotency key for the whole capture→persist→publish flow. Branded so a
 * plain string can't be passed where a capture id is required.
 */
export const CaptureId = Schema.brand("CaptureId")(Schema.String)
export type CaptureId = typeof CaptureId.Type

/**
 * UUID generation. `crypto.randomUUID` exists on web and modern Expo runtimes;
 * the fallback keeps the same guarantee (globally-unique-enough synthetic id)
 * on runtimes without a global crypto object. contracts stays DOM-free, so
 * crypto is reached through a structural globalThis lookup.
 */
const globalRef = globalThis as { readonly crypto?: { readonly randomUUID?: () => string } }
const randomId = (): string => {
  const cryptoApi = globalRef.crypto
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID()
  const chunk = (): string => Math.random().toString(36).slice(2, 12)
  return `${Date.now().toString(36)}-${chunk()}${chunk()}`
}

export const newCaptureId = (): CaptureId => `cap-${randomId()}` as CaptureId
