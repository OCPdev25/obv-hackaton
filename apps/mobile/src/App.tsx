/**
 * Shared Child Journal — capture screen (candidate D vertical slice).
 *
 * The UI renders the @journal/capture state machine; every user intent is a
 * capture message, every side effect is a command the loop executes against
 * real services (deterministic extraction + the LOCAL-REAL Convex store).
 * No state logic lives here — this file only maps state → view.
 */
import { Effect, Layer } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

import { makeCaptureLoop } from "@journal/capture"
import { makeDeterministicExtractor } from "@journal/capture"
import { EntryStore, makeConvexEntryStoreLayer } from "@journal/capture"
import type { EntryStoreShape } from "@journal/capture"
import type { CaptureId, CaptureState } from "@journal/domain"
import { fixtureCaregiverAna, fixtureChild } from "@journal/domain"
import { StatusBar } from "expo-status-bar"

// Local dev backend (convex dev local mode). EXPO_PUBLIC_ vars are inlined at
// build time; the fallback targets the sandbox's anonymous local deployment.
const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3212"
const childId = fixtureChild.childId
const ana = fixtureCaregiverAna.caregiverId

export default function App() {
  const [state, setState] = useState<CaptureState>({ _tag: "Idle" })
  const [draftText, setDraftText] = useState("")
  const [timeline, setTimeline] = useState<ReadonlyArray<{ readonly captureId: string; readonly transcript: string }>>([])
  const [entryId, setEntryId] = useState<string | undefined>(undefined)
  const loopRef = useRef<ReturnType<typeof makeCaptureLoop> | undefined>(undefined)

  const refreshTimeline = useCallback(async (store: EntryStoreShape) => {
    const rows = await Effect.runPromise(Effect.orDie(store.timeline(childId)))
    setTimeline(rows.map((row) => ({ captureId: row.captureId, transcript: row.transcript })))
  }, [])

  // Build the Convex-backed store from its Layer once, then start the loop.
  useEffect(() => {
    let cancelled = false
    const program = Effect.gen(function* () {
      const store = yield* EntryStore
      const loop = makeCaptureLoop(
        { extraction: makeDeterministicExtractor(), store },
        (next) => {
          if (cancelled) return
          setState(next)
          if (next._tag === "Published") {
            setEntryId(next.entryId)
            void refreshTimeline(store)
          }
        },
      )
      return loop
    }).pipe(Effect.provide(makeConvexEntryStoreLayer(CONVEX_URL)))
    Effect.runPromise(Effect.orDie(program)).then((loop) => {
      if (!cancelled) loopRef.current = loop
    }).catch((error) => {
      console.error("failed to build capture runtime", error)
    })
    return () => {
      cancelled = true
    }
  }, [refreshTimeline])

  const dispatch = useCallback((message: Parameters<NonNullable<ReturnType<typeof makeCaptureLoop>>["dispatch"]>[0]) => {
    void loopRef.current?.dispatch(message)
  }, [])

  const startCapture = () => {
    setEntryId(undefined)
    setDraftText("")
    dispatch({ _tag: "CaptureStarted", captureId: newCaptureId(), childId, authorId: ana })
  }

  const finishTranscription = () => {
    if (draftText.trim().length === 0) return
    if (state._tag !== "Recording") return
    dispatch({ _tag: "CompletedTranscription", captureId: state.captureId, transcript: draftText })
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.title} testID="screen-title">Shared Child Journal</Text>
      <Text style={styles.subtitle}>Capture for {fixtureChild.displayName} · caregiver {fixtureCaregiverAna.displayName}</Text>

      {state._tag === "Idle" || state._tag === "Published" ? (
        <View style={styles.section}>
          {state._tag === "Published" ? (
            <Text style={styles.confirmation} testID="published-confirmation">
              Published ✓ entry {entryId ?? ""}
            </Text>
          ) : null}
          <Pressable style={styles.button} onPress={startCapture} testID="start-capture">
            <Text style={styles.buttonText}>Start capture</Text>
          </Pressable>
        </View>
      ) : null}

      {state._tag === "Recording" ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Enter what happened (synthetic dictation text)</Text>
          <TextInput
            style={styles.input}
            multiline
            placeholder="Mila used the potty today. She napped for 90 minutes."
            value={draftText}
            onChangeText={setDraftText}
            testID="draft-input"
          />
          <View style={styles.row}>
            <Pressable
              style={[styles.button, styles.primary]}
              onPress={finishTranscription}
              disabled={draftText.trim().length === 0}
              testID="finish-transcription"
            >
              <Text style={styles.buttonText}>Done transcribing</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => dispatch({ _tag: "CancelledCapture", captureId: state.captureId })} testID="cancel">
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {state._tag === "Transcribed" ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Raw transcript (retained verbatim)</Text>
          <Text style={styles.raw}>{state.rawTranscript}</Text>
          <View style={styles.row}>
            <Pressable style={[styles.button, styles.primary]} onPress={() => dispatch({ _tag: "SubmittedForExtraction", captureId: state.captureId })} testID="submit-extraction">
              <Text style={styles.buttonText}>Extract events</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => dispatch({ _tag: "CancelledCapture", captureId: state.captureId })} testID="cancel">
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {state._tag === "Extracting" ? (
        <View style={styles.section}>
          <ActivityIndicator testID="extracting-spinner" />
          <Text style={styles.sectionTitle}>Extracting events… raw input is safe.</Text>
        </View>
      ) : null}

      {state._tag === "Review" ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Review extracted events</Text>
          <Text style={styles.raw}>{state.rawTranscript}</Text>
          {state.events.map((event, index) => (
            <View key={index} style={styles.eventRow} testID={`event-${event.category}`}>
              <Text style={styles.eventCategory}>{event.category}</Text>
              <Text style={styles.eventNote}>{event.note ?? ""}</Text>
              {event.quantity ? (
                <Text style={styles.eventQuantity}>{event.quantity.value} {event.quantity.unit}</Text>
              ) : null}
            </View>
          ))}
          <View style={styles.row}>
            <Pressable style={[styles.button, styles.primary]} onPress={() => dispatch({ _tag: "ConfirmedReview", captureId: state.captureId, at: new Date() })} testID="confirm-review">
              <Text style={styles.buttonText}>Publish</Text>
            </Pressable>
            <Pressable style={styles.button} onPress={() => dispatch({ _tag: "CancelledCapture", captureId: state.captureId })} testID="cancel">
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <ScrollView style={styles.timeline} testID="timeline">
        <Text style={styles.sectionTitle}>Timeline for {fixtureChild.displayName}</Text>
        {timeline.length === 0 ? <Text style={styles.empty}>No entries yet.</Text> : null}
        {timeline.map((row, index) => (
          <View key={index} style={styles.timelineRow} testID="timeline-row">
            <Text style={styles.timelineCapture}>{row.captureId}</Text>
            <Text style={styles.timelineText}>{row.transcript}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const newCaptureId = (): CaptureId => `capture_${Date.now()}` as CaptureId

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20, backgroundColor: "#faf9f7" },
  title: { fontSize: 24, fontWeight: "700", color: "#1f2937" },
  subtitle: { fontSize: 13, color: "#6b7280", marginBottom: 16 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: "600", color: "#374151", marginBottom: 8 },
  raw: { fontSize: 14, color: "#111827", backgroundColor: "#eef2f7", padding: 10, borderRadius: 8, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 10, minHeight: 80, marginBottom: 12, textAlignVertical: "top", backgroundColor: "#fff" },
  row: { flexDirection: "row", gap: 8 },
  button: { backgroundColor: "#e5e7eb", borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, marginRight: 8, opacity: 1 },
  primary: { backgroundColor: "#2563eb" },
  buttonText: { color: "#fff", fontWeight: "600" },
  confirmation: { color: "#059669", fontWeight: "700", marginBottom: 12 },
  eventRow: { backgroundColor: "#fff", borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: "#e5e7eb" },
  eventCategory: { fontWeight: "700", color: "#2563eb", textTransform: "uppercase", fontSize: 11 },
  eventNote: { color: "#111827", marginTop: 2 },
  eventQuantity: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  timeline: { flex: 1, marginTop: 8 },
  timelineRow: { backgroundColor: "#fff", borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: "#e5e7eb" },
  timelineCapture: { fontSize: 11, color: "#9ca3af" },
  timelineText: { color: "#111827" },
  empty: { color: "#9ca3af", fontStyle: "italic" },
})
