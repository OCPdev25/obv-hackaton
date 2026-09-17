import { Schema } from "effect"
import type { CaptureRecovery } from "./state.js"

/**
 * UI projection contract: everything the one-handed recovery surface shows is
 * DERIVED here from persisted state — never from in-memory optimism. If a
 * banner says "safe on this device", the raw transcript is persisted; if it
 * says nothing about the server, the server outcome is genuinely unknown.
 *
 * One-handed encoding: the banner is bottom-anchored inside thumb reach,
 * exposes at most two actions, and the single primary action meets the 48pt
 * touch-target floor. No state offers more than one thing to tap first.
 */
export const BannerTone = Schema.Literals(["info", "warning", "success", "neutral"])
export type BannerTone = typeof BannerTone["Type"]

export const RecoveryAction = Schema.Literals(["resume", "retry", "discard", "review"])
export type RecoveryAction = typeof RecoveryAction["Type"]

export const BannerAction = Schema.Struct({
  action: RecoveryAction,
  label: Schema.String,
})
export type BannerAction = typeof BannerAction["Type"]

export const RecoveryBanner = Schema.Struct({
  visible: Schema.Boolean,
  tone: BannerTone,
  title: Schema.String,
  detail: Schema.String,
  primary: Schema.optionalKey(BannerAction),
  secondary: Schema.optionalKey(BannerAction),
  touchTargetPt: Schema.Literals([48]),
  anchored: Schema.Literals(["bottom"]),
})
export type RecoveryBanner = typeof RecoveryBanner["Type"]

/** Chip shown for a saved capture (the banner itself stays hidden). */
export const successChip = "Saved to the journal"

const hidden = (): RecoveryBanner => ({
  visible: false,
  tone: "info",
  title: "",
  detail: "",
  touchTargetPt: 48,
  anchored: "bottom",
})

export const bannerFor = (state: CaptureRecovery): RecoveryBanner => {
  switch (state.phase) {
    case "drafting": {
      if (state.interruptedAt === undefined) return hidden()
      return {
        visible: true,
        tone: "info",
        title: "Draft is safe on this device",
        detail: "The interruption did not lose your words. Pick up where you left off.",
        primary: { action: "resume", label: "Keep recording" },
        touchTargetPt: 48,
        anchored: "bottom",
      }
    }
    case "pending": {
      if (state.networkLostAt !== undefined) {
        return {
          visible: true,
          tone: "warning",
          title: "Waiting for network",
          detail: "Will send when you're back online. Your recording is safe on this device.",
          touchTargetPt: 48,
          anchored: "bottom",
        }
      }
      return {
        visible: true,
        tone: "info",
        title: "Sending…",
        detail: "Not saved to the journal yet. A copy stays on this device.",
        touchTargetPt: 48,
        anchored: "bottom",
      }
    }
    case "failed": {
      const reason = state.lastFailure?.reason
      if (reason === "unauthorized") {
        return {
          visible: true,
          tone: "warning",
          title: "Sign-in needed",
          detail: "Your recording is safe on this device.",
          primary: { action: "retry", label: "Sign in & send" },
          secondary: { action: "discard", label: "Discard" },
          touchTargetPt: 48,
          anchored: "bottom",
        }
      }
      if (reason === "invalid") {
        return {
          visible: true,
          tone: "warning",
          title: "Needs a fix before sending",
          detail: "Your recording is safe on this device.",
          primary: { action: "review", label: "Review" },
          secondary: { action: "discard", label: "Discard" },
          touchTargetPt: 48,
          anchored: "bottom",
        }
      }
      return {
        visible: true,
        tone: "warning",
        title:
          reason === "server"
            ? "Couldn't send — server problem"
            : "Couldn't send — network problem",
        detail: "Your recording is safe on this device.",
        primary: { action: "retry", label: "Try again" },
        secondary: { action: "discard", label: "Discard" },
        touchTargetPt: 48,
        anchored: "bottom",
      }
    }
    case "saved":
      // Hidden banner still carries success semantics — the surface renders
      // the success chip from the same projection.
      return { ...hidden(), tone: "success" }
    case "discarded":
      return {
        visible: true,
        tone: "neutral",
        title: "Discarded — nothing was added to the journal",
        detail: "You discarded this recording. Only a receipt remains on this device.",
        touchTargetPt: 48,
        anchored: "bottom",
      }
  }
}
