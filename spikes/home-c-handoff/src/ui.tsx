import type { ReactNode } from "react"
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native"

/**
 * Shared presentation primitives for the candidate-C prototype screens.
 * Everything is plain react-native — the point of candidate C is the home
 * LENS (what the screen leads with), not a navigation library.
 */

export const C = {
  bg: "#0B1220",
  card: "#111C2E",
  cardLine: "#24344F",
  text: "#EAF2FF",
  dim: "#8FA3BF",
  accent: "#5AC8FA",
  accentSoft: "#12314A",
  ok: "#34C77B",
  okSoft: "#0F2E20",
  warn: "#FFB020",
  warnSoft: "#33270D",
  danger: "#FF5D5D",
  dangerSoft: "#331414",
} as const

export const Screen = ({ children }: { children: ReactNode }) => (
  <View style={styles.screen}>{children}</View>
)

export const Card = ({
  title,
  tone,
  children,
  style,
}: {
  title?: string
  tone?: "default" | "ok" | "warn" | "danger"
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) => (
  <View
    style={[
      styles.card,
      tone === "ok" && { borderColor: C.ok },
      tone === "warn" && { borderColor: C.warn },
      tone === "danger" && { borderColor: C.danger },
      style,
    ]}
  >
    {title !== undefined && <Text style={styles.cardTitle}>{title}</Text>}
    {children}
  </View>
)

export const Btn = ({
  label,
  onPress,
  primary = false,
  tone,
}: {
  label: string
  onPress?: () => void
  primary?: boolean
  tone?: "ok" | "danger"
}) => (
  <Pressable
    onPress={onPress}
    style={[styles.btn, primary && styles.btnPrimary, tone === "ok" && styles.btnOk, tone === "danger" && styles.btnDanger]}
  >
    <Text style={[styles.btnLabel, primary && styles.btnLabelPrimary]}>{label}</Text>
  </Pressable>
)

export const Chip = ({ label, tone = "default", onPress }: { label: string; tone?: "default" | "accent" | "ok" | "warn" | "danger"; onPress?: () => void }) => (
  <Pressable onPress={onPress} disabled={onPress === undefined} style={[styles.chip, tone === "accent" && styles.chipAccent, tone === "ok" && styles.chipOk, tone === "warn" && styles.chipWarn, tone === "danger" && styles.chipDanger]}>
    <Text style={styles.chipLabel}>{label}</Text>
  </Pressable>
)

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <Text style={styles.sectionTitle}>{children}</Text>
)

export const Caption = ({ children }: { children: ReactNode }) => (
  <Text style={styles.caption}>{children}</Text>
)

export const FactRow = ({
  index,
  headline,
  detail,
  onOpenSource,
}: {
  index: number
  headline: string
  detail?: string
  onOpenSource?: () => void
}) => (
  <View style={styles.factRow}>
    <Text style={styles.factIndex}>{index}</Text>
    <View style={styles.factBody}>
      <Text style={styles.factHeadline}>{headline}</Text>
      {detail !== undefined && detail !== "" && <Text style={styles.factDetail}>{detail}</Text>}
    </View>
    {onOpenSource !== undefined && (
      <Pressable onPress={onOpenSource} hitSlop={8}>
        <Text style={styles.sourceLink}>source ↗</Text>
      </Pressable>
    )}
  </View>
)

export const styles = StyleSheet.create({
  screen: { backgroundColor: C.bg, flex: 1, paddingBottom: 24, paddingHorizontal: 16, paddingTop: 48 },
  card: { backgroundColor: C.card, borderColor: C.cardLine, borderRadius: 14, borderWidth: 1, marginBottom: 12, padding: 14 },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: "700", marginBottom: 8 },
  btn: { backgroundColor: C.accentSoft, borderColor: C.accent, borderRadius: 12, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 16 },
  btnPrimary: { backgroundColor: C.accent },
  btnOk: { backgroundColor: C.okSoft, borderColor: C.ok },
  btnDanger: { backgroundColor: C.dangerSoft, borderColor: C.danger },
  btnLabel: { color: C.accent, fontSize: 15, fontWeight: "600", textAlign: "center" },
  btnLabelPrimary: { color: "#04121E" },
  chip: { backgroundColor: C.card, borderColor: C.cardLine, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  chipAccent: { backgroundColor: C.accentSoft, borderColor: C.accent },
  chipOk: { backgroundColor: C.okSoft, borderColor: C.ok },
  chipWarn: { backgroundColor: C.warnSoft, borderColor: C.warn },
  chipDanger: { backgroundColor: C.dangerSoft, borderColor: C.danger },
  chipLabel: { color: C.text, fontSize: 12 },
  sectionTitle: { color: C.dim, fontSize: 12, fontWeight: "700", letterSpacing: 1.2, marginBottom: 6, textTransform: "uppercase" },
  caption: { color: C.dim, fontSize: 12, lineHeight: 17 },
  factRow: { alignItems: "flex-start", flexDirection: "row", gap: 10, marginBottom: 10 },
  factIndex: { color: C.accent, fontSize: 14, fontWeight: "800", marginTop: 1 },
  factBody: { flex: 1 },
  factHeadline: { color: C.text, fontSize: 14, fontWeight: "600", lineHeight: 19 },
  factDetail: { color: C.dim, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  sourceLink: { color: C.accent, fontSize: 12, fontWeight: "600", marginTop: 2 },
})
