/** Demo theme — quiet, paper-like, conversation-first. */
export const colors = {
  bg: "#F7F5F2",
  card: "#FFFFFF",
  ink: "#1F2937",
  sub: "#6B7280",
  accent: "#4F46E5",
  accentSoft: "#EEF2FF",
  ok: "#047857",
  okSoft: "#ECFDF5",
  warn: "#B45309",
  warnSoft: "#FFFBEB",
  danger: "#B91C1C",
  dangerSoft: "#FEF2F2",
  chip: "#F3F4F6",
  border: "#E5E7EB",
} as const

export const radius = 14
export const spacing = (n: number): number => n * 4
