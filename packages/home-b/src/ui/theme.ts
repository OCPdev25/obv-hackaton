/**
 * Candidate B visual tokens — small, self-contained palette so the demo
 * screen reads as a product surface without pulling @journal/ui (the shared
 * placeholder) or a navigation dependency. Candidate-scoped by design.
 */
export const colors = {
  bg: "#f6f7fb",
  card: "#ffffff",
  ink: "#1c1f26",
  inkSoft: "#5b6472",
  inkFaint: "#8a93a3",
  accent: "#3366d6",
  accentSoft: "#e6edfb",
  danger: "#b3361f",
  dangerSoft: "#fbe9e4",
  ok: "#1f7a4d",
  okSoft: "#e2f3ea",
  warn: "#8a6116",
  warnSoft: "#faf1dc",
  line: "#e3e7ee",
  chip: "#eef1f6",
} as const

export const spacing = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
} as const

export const radius = { s: 8, m: 12, l: 18 } as const

/** Canonical category presentation — six categories, one icon each. */
export const CATEGORY_META: Record<string, { readonly icon: string; readonly label: string }> = {
  meal: { icon: "🍽️", label: "Meal" },
  sleep: { icon: "😴", label: "Sleep" },
  mood: { icon: "🙂", label: "Mood" },
  potty: { icon: "🚽", label: "Potty" },
  milestone: { icon: "⭐", label: "Milestone" },
  school: { icon: "🎒", label: "School" },
}

export const categoryIcon = (category: string): string => CATEGORY_META[category]?.icon ?? "•"
export const categoryLabel = (category: string): string => CATEGORY_META[category]?.label ?? category
