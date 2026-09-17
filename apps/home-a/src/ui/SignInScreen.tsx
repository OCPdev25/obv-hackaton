/** Known-members-only entry: anonymous and non-member paths are demoable. */
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import { colors, radius, spacing } from "./theme"

export interface SignInOption {
  readonly memberId: string
  readonly label: string
  readonly role: string
  readonly note: string
}

const OPTIONS: readonly SignInOption[] = [
  { memberId: "mem_dana", label: "Dana Polanco", role: "Mom · parent", note: "full access, parents-only visibility" },
  { memberId: "mem_gilbert", label: "Gilbert Polanco", role: "Dad · parent", note: "full access" },
  { memberId: "mem_rosa", label: "Rosa Marin", role: "Nana Rosa · caregiver", note: "invited; parents-only entries hidden" },
  { memberId: "mem_stranger", label: "Continue without signing in", role: "anonymous / non-member", note: "fail-closed: sees nothing" },
]

export function SignInScreen({ onSignIn }: { onSignIn: (memberId: string) => void }) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Shared Child Journal</Text>
      <Text style={styles.subtitle}>Parent home — Candidate A “conversation-first” · synthetic data only</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {OPTIONS.map((option) => (
          <Pressable key={option.memberId} style={styles.card} onPress={() => onSignIn(option.memberId)}>
            <Text style={styles.name}>{option.label}</Text>
            <Text style={styles.role}>{option.role}</Text>
            <Text style={styles.note}>{option.note}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: spacing(20), paddingHorizontal: spacing(3) },
  title: { fontSize: 24, fontWeight: "800", color: colors.ink, textAlign: "center" },
  subtitle: { fontSize: 13, color: colors.sub, textAlign: "center", marginTop: spacing(1), marginBottom: spacing(6) },
  list: { gap: spacing(2), paddingBottom: spacing(8) },
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: spacing(3) },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  role: { fontSize: 12, color: colors.accent, marginTop: 2 },
  note: { fontSize: 11, color: colors.sub, marginTop: 2 },
})
