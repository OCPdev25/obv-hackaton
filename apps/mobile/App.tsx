import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"
import { useCaptureMachine } from "./src/useCaptureMachine"

const PHASE_COLORS: Record<string, string> = {
  idle: "#6b7280",
  recording: "#dc2626",
  transcribed: "#2563eb",
  extracting: "#7c3aed",
  review: "#d97706",
  published: "#059669",
}

const eventLabel = (event: unknown): string => {
  if (event === null || event === undefined) return "(raw-only entry)"
  if (typeof event === "object" && "_tag" in (event as Record<string, unknown>)) {
    const e = event as Record<string, unknown> & { _tag: string }
    switch (e._tag) {
      case "meal":
        return `meal — ${e.food}, amount: ${e.amount}`
      case "sleep":
        return `sleep — ${e.kind}${e.minutes !== undefined ? ` (${e.minutes} min)` : ""}`
      case "potty":
        return `potty — ${e.kind}, ${e.success ? "success" : "accident"}`
      case "mood":
        return `mood — ${e.mood}`
      case "milestone":
        return `milestone — ${String(e.label).slice(0, 60)}`
      case "school":
        return `school — ${String(e.note).slice(0, 60)}`
      default:
        return e._tag
    }
  }
  return JSON.stringify(event)
}

export default function App() {
  const capture = useCaptureMachine()
  const reviewState = capture.state._tag === "Review" ? capture.state : undefined

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Shared Child Journal</Text>
      <Text style={styles.subtitle}>Capture → persist → timeline (arena candidate B)</Text>

      <View style={[styles.badge, { backgroundColor: PHASE_COLORS[capture.phase] ?? "#6b7280" }]}>
        <Text style={styles.badgeText}>machine: {capture.state._tag}</Text>
      </View>

      <TextInput
        style={styles.input}
        multiline
        value={capture.rawText}
        onChangeText={capture.setRawText}
        placeholder="Type the dictation text for Maya…"
      />
      <Text style={styles.rawNote}>
        Raw input is retained unchanged, always — even when extraction or publishing fails.
      </Text>

      <View style={styles.row}>
        <Pressable
          style={[styles.button, capture.phase !== "idle" && capture.phase !== "published" && styles.buttonDisabled]}
          disabled={capture.phase !== "idle" && capture.phase !== "published"}
          onPress={capture.startCapture}
        >
          <Text style={styles.buttonText}>Capture text</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.buttonSecondary, (capture.phase !== "review") && styles.buttonDisabled]}
          disabled={capture.phase !== "review"}
          onPress={capture.publish}
        >
          <Text style={styles.buttonText}>Publish</Text>
        </Pressable>
      </View>

      <View style={[styles.row, styles.checkboxRow]}>
        <Pressable
          style={[styles.checkbox, capture.corruptNext && styles.checkboxOn]}
          onPress={() => capture.setCorruptNext(!capture.corruptNext)}
        >
          <Text style={styles.checkboxText}>{capture.corruptNext ? "☑" : "☐"}</Text>
        </Pressable>
        <Text style={styles.checkboxLabel}>
          Corrupt next meal event (amount "half" — out of vocabulary) to demo validation failure
        </Text>
      </View>

      {reviewState !== undefined && reviewState.event !== undefined && (
        <View style={styles.reviewCard}>
          <Text style={styles.reviewTitle}>Proposed event (schema-validated at publish)</Text>
          <Text style={styles.reviewBody}>{eventLabel(reviewState.event)}</Text>
          {reviewState.error !== undefined && (
            <>
              <Text style={styles.error}>Publish failed: {reviewState.error}</Text>
              <Text style={styles.rawNote}>Raw text is intact — correct and retry below.</Text>
            </>
          )}
          {reviewState.error !== undefined && reviewState.event._tag === "meal" && (
            <Pressable style={[styles.button, styles.buttonSecondary]} onPress={capture.retryPublishCorrected}>
              <Text style={styles.buttonText}>Retry publish (corrected, same captureId)</Text>
            </Pressable>
          )}
        </View>
      )}

      {reviewState !== undefined && reviewState.event === undefined && (
        <View style={styles.reviewCard}>
          <Text style={styles.reviewTitle}>No structured event extracted</Text>
          <Text style={styles.rawNote}>Publish will store the raw capture as a raw-only entry.</Text>
          <Pressable style={[styles.button, styles.buttonSecondary]} onPress={capture.publish}>
            <Text style={styles.buttonText}>Publish raw-only</Text>
          </Pressable>
        </View>
      )}

      {capture.state._tag === "Published" && (
        <View style={[styles.reviewCard, styles.publishedCard]}>
          <Text style={styles.reviewTitle}>Published ✓</Text>
          <Text style={styles.rawNote}>
            Entry {capture.state.entryId} — capture {capture.state.captureId}
          </Text>
          <Pressable style={[styles.button, styles.buttonSecondary]} onPress={capture.reset}>
            <Text style={styles.buttonText}>New capture</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.timelineHeader}>
        <Text style={styles.timelineTitle}>Maya's timeline</Text>
        <Pressable style={styles.smallButton} onPress={() => void capture.refreshTimeline()}>
          <Text style={styles.smallButtonText}>Reload</Text>
        </Pressable>
      </View>
      {capture.timeline.length === 0 && <Text style={styles.empty}>No entries yet — capture something above.</Text>}
      {capture.timeline.map((entry) => (
        <View key={entry._id} style={styles.entry}>
          <Text style={styles.entryTime}>{new Date(entry.occurredAt).toLocaleString()}</Text>
          <Text style={styles.entryEvent}>{eventLabel(entry.event)}</Text>
          <Text style={styles.entryCapture}>capture {entry.captureId.slice(0, 13)}…</Text>
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#f8fafc", flex: 1 },
  content: { padding: 20, paddingBottom: 48 },
  title: { color: "#0f172a", fontSize: 24, fontWeight: "700" },
  subtitle: { color: "#64748b", fontSize: 13, marginBottom: 16, marginTop: 2 },
  badge: { alignSelf: "flex-start", borderRadius: 999, marginBottom: 14, paddingHorizontal: 12, paddingVertical: 5 },
  badgeText: { color: "#ffffff", fontSize: 12, fontWeight: "600" },
  input: {
    backgroundColor: "#ffffff",
    borderColor: "#cbd5e1",
    borderRadius: 10,
    borderWidth: 1,
    color: "#0f172a",
    minHeight: 72,
    padding: 12,
    textAlignVertical: "top",
  },
  rawNote: { color: "#64748b", fontSize: 12, marginBottom: 10, marginTop: 4 },
  row: { flexDirection: "row", gap: 10 },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    flex: 1,
    padding: 12,
  },
  buttonSecondary: { backgroundColor: "#0f172a", flex: 0, paddingHorizontal: 16, alignSelf: "flex-start", marginTop: 8 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: "#ffffff", fontWeight: "600", textAlign: "center" },
  checkboxRow: { alignItems: "center", marginVertical: 8 },
  checkbox: {
    borderColor: "#cbd5e1",
    borderRadius: 6,
    borderWidth: 1,
    height: 24,
    width: 24,
  },
  checkboxOn: { backgroundColor: "#2563eb" },
  checkboxText: { color: "#ffffff", textAlign: "center" },
  checkboxLabel: { color: "#334155", flex: 1, fontSize: 12, marginLeft: 8 },
  reviewCard: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  publishedCard: { backgroundColor: "#ecfdf5" },
  reviewTitle: { color: "#0f172a", fontSize: 14, fontWeight: "600" },
  reviewBody: { color: "#334155", fontSize: 14, marginTop: 4 },
  error: { color: "#b91c1c", fontSize: 13, marginTop: 6 },
  timelineHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 8, marginTop: 20 },
  timelineTitle: { color: "#0f172a", fontSize: 18, fontWeight: "700" },
  smallButton: { borderColor: "#cbd5e1", borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 4 },
  smallButtonText: { color: "#2563eb", fontSize: 12, fontWeight: "600" },
  empty: { color: "#64748b", fontSize: 13 },
  entry: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    padding: 12,
  },
  entryTime: { color: "#64748b", fontSize: 11 },
  entryEvent: { color: "#0f172a", fontSize: 15, fontWeight: "500", marginTop: 2 },
  entryCapture: { color: "#94a3b8", fontSize: 10, marginTop: 2 },
})
