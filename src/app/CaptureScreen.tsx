/**
 * Capture screen — caregiver enters synthetic text; the raw input is shown
 * unchanged at every step; extracted events are reviewed before publishing to
 * the child's realtime timeline.
 *
 * UI-originated messages with domain-typed fields (transcript, captureId) are
 * decoded through the Effect Schema message union — boundary decode of user
 * input; invalid input never becomes a state transition, and the draft stays
 * in the field untouched.
 */
import { useMemo, useState } from "react"
import { StyleSheet, Text, TextInput, Pressable, View, FlatList } from "react-native"
import { StatusBar } from "expo-status-bar"
import { Schema } from "effect"
import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import { CaptureId, CaregiverId, TimelineRow, type CaptureId as CaptureIdType, type TimelineRow as TimelineRowType } from "../domain/schema.js"
import { CaptureMessage, type CaptureState } from "../domain/captureState.js"
import { fixtureCaregivers, fixtureChild } from "../services/fixtures.js"
import { useCaptureFlow } from "./useCaptureFlow"

const newCaptureId = (): CaptureIdType =>
  Schema.decodeSync(CaptureId)(`cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

const statusLabel: Record<CaptureState["status"], string> = {
  idle: "Idle — start a capture to begin",
  recording: "Recording (text stands in for voice in this slice)",
  transcribed: "Transcribed — raw text kept verbatim",
  extracting: "Extracting structured events…",
  review: "Review — confirm the extracted events",
  validationFailed: "Validation failed — raw text preserved, retry when ready",
  publishing: "Publishing to the journal…",
  persistFailed: "Persistence failed — raw text preserved, retry when ready",
  published: "Published — durable in the child timeline",
}

const decodeTimelineRow = (row: unknown): TimelineRowType => Schema.decodeUnknownSync(TimelineRow)(row)

export const CaptureScreen = ({ convexUrl }: { convexUrl: string }) => {
  const { state, dispatch } = useCaptureFlow(convexUrl)
  const [authorId, setAuthorId] = useState(fixtureCaregivers[0]?.caregiverId)
  const [draft, setDraft] = useState("")
  const [inputError, setInputError] = useState<string | undefined>(undefined)

  // Realtime child timeline; rows are re-decoded through the Effect schema.
  const timelineRows = useQuery(api.events.timelineForChild, { childId: fixtureChild.childId })
  const decodedRows = useMemo(() => {
    if (timelineRows === undefined) return undefined
    try {
      return timelineRows.map(decodeTimelineRow)
    } catch (error) {
      // Boundary decode failure is surfaced, never silently dropped.
      const systemId = Schema.decodeSync(CaregiverId)("caregiver-system")
      return [
        {
          recordId: "decode-error",
          captureId: Schema.decodeSync(CaptureId)("decode-error"),
          transcript: `timeline decode failed: ${error instanceof Error ? error.message : String(error)}`,
          authorId: systemId,
          authorName: "system",
          status: "published" as const,
          createdAt: new Date(0),
          events: [],
        },
      ]
    }
  }, [timelineRows])

  const submitTranscript = () => {
    try {
      const message = Schema.decodeSync(CaptureMessage)({ type: "textEntered", transcript: draft })
      setInputError(undefined)
      dispatch([message])
    } catch (error) {
      // The draft stays in the input untouched — nothing is lost.
      setInputError(`raw text rejected by domain schema: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const startCapture = () => {
    dispatch([
      {
        type: "captureStarted",
        captureId: newCaptureId(),
        authorId: authorId ?? fixtureCaregivers[0]!.caregiverId,
        childId: fixtureChild.childId,
      },
    ])
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.title}>Shared Child Journal — {fixtureChild.name}</Text>
      <Text style={styles.caption}>
        persistence: local Convex backend (real) · extraction: deterministic rule-based double (no LLM wired)
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Who is capturing?</Text>
        <View style={styles.row}>
          {fixtureCaregivers.map((caregiver) => (
            <Pressable
              key={caregiver.caregiverId}
              onPress={() => setAuthorId(caregiver.caregiverId)}
              style={[styles.pill, authorId === caregiver.caregiverId ? styles.pillSelected : undefined]}
            >
              <Text style={authorId === caregiver.caregiverId ? styles.pillTextSelected : styles.pillText}>
                {caregiver.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>1 · Capture</Text>
        {state.status === "idle" ? (
          <Pressable style={styles.button} onPress={startCapture}>
            <Text style={styles.buttonText}>Start capture</Text>
          </Pressable>
        ) : (
          <Text style={styles.body}>
            captureId: {state.captureId} — raw input is preserved verbatim through every step.
          </Text>
        )}
        {state.status === "recording" ? (
          <View>
            <TextInput
              style={styles.input}
              multiline
              placeholder={'e.g. "milestone: Ada said her first word — mama"'}
              value={draft}
              onChangeText={setDraft}
            />
            {inputError !== undefined ? <Text style={styles.error}>{inputError}</Text> : null}
            <Pressable
              style={[styles.button, draft.trim().length === 0 ? styles.buttonDisabled : undefined]}
              disabled={draft.trim().length === 0}
              onPress={submitTranscript}
            >
              <Text style={styles.buttonText}>Save transcript (raw kept unchanged)</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>2 · Flow status</Text>
        <Text style={styles.status}>{statusLabel[state.status]}</Text>
        {"transcript" in state ? <Text style={styles.raw}>raw: {state.transcript}</Text> : null}
        {state.status === "validationFailed" || state.status === "persistFailed" ? (
          <View>
            <Text style={styles.error}>reason: {state.reason}</Text>
            <Pressable style={styles.button} onPress={() => dispatch([{ type: "retryRequested" }])}>
              <Text style={styles.buttonText}>Retry (same captureId, raw preserved)</Text>
            </Pressable>
          </View>
        ) : null}
        {"events" in state && state.events.length > 0 ? (
          <View style={styles.eventsBox}>
            {state.events.map((event, index) => (
              <Text key={index} style={styles.event}>
                [{event.category}] {event.note ?? ""} (confidence {event.confidence})
              </Text>
            ))}
          </View>
        ) : null}
        {state.status === "review" ? (
          <Pressable style={styles.button} onPress={() => dispatch([{ type: "publishRequested" }])}>
            <Text style={styles.buttonText}>Publish to {fixtureChild.name}'s timeline</Text>
          </Pressable>
        ) : null}
        {state.status === "published" ? <Text style={styles.record}>record: {state.recordId}</Text> : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>3 · {fixtureChild.name}'s timeline (realtime)</Text>
        {decodedRows === undefined ? (
          <Text style={styles.body}>Loading…</Text>
        ) : (
          <FlatList
            data={decodedRows}
            keyExtractor={(row) => row.recordId}
            renderItem={({ item }) => (
              <View style={styles.timelineRow}>
                {item.events.map((event, index) => (
                  <Text key={index} style={styles.timelineEvent}>
                    [{event.category}] {event.note ?? "(no note)"} — by {item.authorName} at{" "}
                    {event.occurredAt.toLocaleTimeString()}
                  </Text>
                ))}
                <Text style={styles.timelineRaw}>raw kept: "{item.transcript}"</Text>
              </View>
            )}
          />
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f6f7fb", padding: 20, paddingTop: 60 },
  title: { fontSize: 22, fontWeight: "700", color: "#1c1e27" },
  caption: { fontSize: 12, color: "#6b7280", marginTop: 4, marginBottom: 12 },
  section: { marginTop: 14, backgroundColor: "#ffffff", borderRadius: 12, padding: 14 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#374151", marginBottom: 8 },
  row: { flexDirection: "row", gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#eef0f6" },
  pillSelected: { backgroundColor: "#2f6fed" },
  pillText: { color: "#374151" },
  pillTextSelected: { color: "#ffffff", fontWeight: "600" },
  body: { color: "#374151", marginTop: 4 },
  raw: { color: "#111827", marginTop: 6, fontStyle: "italic" },
  status: { color: "#2f6fed", fontWeight: "600", marginTop: 4 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 10, minHeight: 70, marginTop: 8 },
  button: { backgroundColor: "#2f6fed", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, marginTop: 10, alignSelf: "flex-start" },
  buttonDisabled: { backgroundColor: "#c3cdf5" },
  buttonText: { color: "#ffffff", fontWeight: "600" },
  error: { color: "#b91c1c", marginTop: 8 },
  eventsBox: { marginTop: 8, backgroundColor: "#f0fdf4", borderRadius: 8, padding: 8 },
  event: { color: "#14532d" },
  record: { marginTop: 8, color: "#14532d", fontFamily: "monospace" },
  timelineRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#e5e7eb" },
  timelineEvent: { color: "#1f2937", fontWeight: "600" },
  timelineRaw: { color: "#6b7280", fontSize: 12, marginTop: 2, fontStyle: "italic" },
})
