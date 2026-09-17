/**
 * QA proof surface for the PR #8 device-proof checklist (spikes/voice-photo
 * README). Rendered only when EXPO_PUBLIC_QA_PROOF=1 — the default app surface
 * is unchanged. Each probe maps to checklist items and appends timestamped
 * evidence lines meant to be read from simctl screenshots/recordings (see
 * scripts/qa-ios-sim-proof.sh).
 *
 * Evidence taxonomy: what runs here on the iOS simulator is SIMULATOR evidence
 * (items 2-8 partially); the deterministic fake adapter evidence is the spike's
 * 38 unit tests; hardware-only items (real-device chip floor, live streaming)
 * are labeled hardware-only in QA-DEVICE-PROOF.md.
 */
import { AudioModule, RecordingPresets, useAudioRecorder, type AudioRecorder } from "expo-audio"
import { File } from "expo-file-system"
import * as ImagePicker from "expo-image-picker"
import { useCallback, useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import { getLocalVoiceTranscriber } from "../../../../spikes/voice-photo/src/transcription/native"
import {
  TranscriptionError,
  transcribeToText,
} from "../../../../spikes/voice-photo/src/transcription/types"
import { storePhotoCaptureViaConvex } from "./convexTransport"

type Line = { readonly at: string; readonly text: string }

const PROOF_LOCALES = ["en-US", "en-GB", "es-ES", "fr-FR", "de-DE", "ja-JP"] as const

function now(): string {
  return new Date().toISOString()
}

/** TurboModule registration probe (checklist item 2). */
function probeTurboModule(add: (text: string) => void): void {
  const transcriber = getLocalVoiceTranscriber()
  add(`[2] factory getLocalVoiceTranscriber() -> ${transcriber === null ? "null (dev client missing pod or Expo Go)" : transcriber.name}`)
  if (transcriber !== null) {
    // The package's TurboModule registers a global on the JS runtime.
    const globalKey = "__apple__llm__transcribe__"
    const present = typeof (globalThis as Record<string, unknown>)[globalKey] !== "undefined"
    add(`[2] globalThis.${globalKey} present -> ${present}`)
  }
}

/** Locale availability matrix (checklist item 7). */
function probeLocales(add: (text: string) => void): void {
  const transcriber = getLocalVoiceTranscriber()
  if (transcriber === null) {
    add("[7] skipped: no transcriber")
    return
  }
  for (const locale of PROOF_LOCALES) {
    add(`[7] isAvailable(${locale}) -> ${transcriber.isAvailable(locale)}`)
  }
}

/** Model asset preparation (checklist item 6). */
async function probePrepare(add: (text: string) => void): Promise<void> {
  const transcriber = getLocalVoiceTranscriber()
  if (transcriber === null) {
    add("[6] skipped: no transcriber")
    return
  }
  try {
    await transcriber.prepare("en-US")
    add("[6] prepare(en-US) resolved (assets verified/downloaded)")
  } catch (error) {
    const code = error instanceof TranscriptionError ? error.code : "UNKNOWN"
    add(`[6] prepare(en-US) threw code=${code} message=${String(error)}`)
  }
}

/** Record-then-transcribe over the real hardware path (checklist items 3, 8, 1-partial). */
async function probeRecordAndTranscribe(recorder: AudioRecorder, add: (text: string) => void): Promise<void> {
  const transcriber = getLocalVoiceTranscriber()
  if (transcriber === null) {
    add("[8] skipped: no transcriber")
    return
  }
  const permission = await AudioModule.requestRecordingPermissionsAsync()
  add(`[3] requestRecordingPermissionsAsync -> ${JSON.stringify(permission)}`)
  if (!permission.granted) {
    add("[3] mic permission not granted — prompt behavior observable on screen/recording")
    return
  }
  await recorder.prepareToRecordAsync()
  recorder.record()
  add("[8] recording 4s (HIGH_QUALITY preset)...")
  await new Promise((resolve) => setTimeout(resolve, 4000))
  recorder.stop()
  const uri = recorder.uri
  add(`[8] recording stopped, uri=${uri ?? "null"}`)
  if (uri === null || uri === undefined) {
    add("[8] FAIL: recorder produced no uri")
    return
  }
  const file = new File(uri)
  const bytes = new Uint8Array(await file.arrayBuffer())
  add(`[8] read ${bytes.byteLength} bytes from recording`)
  try {
    const text = await transcribeToText(transcriber, { bytes, mimeType: "audio/mp4" }, "en-US")
    add(`[1/8] transcribe -> segments joined: "${text}"`)
  } catch (error) {
    const code = error instanceof TranscriptionError ? error.code : "UNKNOWN"
    add(`[1/8] transcribe threw code=${code} message=${String(error)}`)
  }
}

/** Photo pick + 3-request Convex upload (checklist items 4, 9). */
async function probePhotoToConvex(add: (text: string) => void): Promise<void> {
  const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  add(`[4] requestMediaLibraryPermissionsAsync -> ${JSON.stringify(permission)}`)
  if (!permission.granted) {
    add("[4] photo permission not granted — prompt behavior observable on screen/recording")
    return
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 })
  const asset = result.assets?.[0]
  if (result.canceled || asset === undefined) {
    add("[4] picker canceled")
    return
  }
  add(`[4] picked ${asset.fileName ?? "asset"} uri=${asset.uri}`)
  if (convexUrl === undefined || convexUrl.trim() === "") {
    add("[9] EXPO_PUBLIC_CONVEX_URL not set — flow stopped after pick (set apps/mobile/.env)")
    return
  }
  const bytes = new Uint8Array(await new File(asset.uri).arrayBuffer())
  add(`[9] read ${bytes.byteLength} bytes; running 3-request flow against ${convexUrl}`)
  try {
    const stored = await storePhotoCaptureViaConvex(convexUrl, {
      bytes,
      mimeType: asset.mimeType ?? "image/jpeg",
      sizeBytes: bytes.byteLength,
      assetUri: asset.uri,
      assetName: asset.fileName ?? undefined,
    })
    add(`[9] flow complete: storageId=${stored.storageId} entryId=${stored.entryId === "" ? "none (photo-only)" : stored.entryId}`)
  } catch (error) {
    add(`[9] flow failed: ${String(error)}`)
  }
}

export function VoicePhotoProof(): React.JSX.Element {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [lines, setLines] = useState<readonly Line[]>([])
  const [busy, setBusy] = useState(false)
  const add = useCallback((text: string) => {
    setLines((prev) => [...prev, { at: now(), text }])
  }, [])

  const run = useCallback(
    async (label: string, fn: (add: (t: string) => void) => void | Promise<void>) => {
      setBusy(true)
      add(`=== ${label} start ===`)
      try {
        await fn(add)
      } finally {
        add(`=== ${label} end ===`)
        setBusy(false)
      }
    },
    [add],
  )

  return (
    <View style={styles.container}>
      <Text style={styles.title}>QA voice/photo proof (checklist item surface)</Text>
      <View style={styles.buttonRow}>
        <Pressable
          style={styles.button}
          disabled={busy}
          onPress={() => run("turboModule+locales", (a) => { probeTurboModule(a); probeLocales(a) })}
        >
          <Text style={styles.buttonText}>Probe module + locales</Text>
        </Pressable>
        <Pressable style={styles.button} disabled={busy} onPress={() => run("prepare", probePrepare)}>
          <Text style={styles.buttonText}>Prepare en-US</Text>
        </Pressable>
      </View>
      <View style={styles.buttonRow}>
        <Pressable
          style={styles.button}
          disabled={busy}
          onPress={() => run("record+transcribe", (a) => probeRecordAndTranscribe(recorder, a))}
        >
          <Text style={styles.buttonText}>Record 4s + transcribe</Text>
        </Pressable>
        <Pressable style={styles.button} disabled={busy} onPress={() => run("photo->convex", probePhotoToConvex)}>
          <Text style={styles.buttonText}>{"Pick photo -> Convex"}</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.log}>
        {lines.map((line, index) => (
          <Text key={`${line.at}-${index}`} style={styles.line}>
            {line.at} {line.text}
          </Text>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  button: { backgroundColor: "#2563eb", borderRadius: 8, padding: 10 },
  buttonRow: { flexDirection: "row", gap: 8, justifyContent: "space-evenly", paddingVertical: 6 },
  buttonText: { color: "#fff", fontWeight: "600" },
  container: { flex: 1, paddingHorizontal: 12, paddingTop: 60 },
  line: { color: "#1f2937", fontFamily: "Menlo", fontSize: 11, paddingVertical: 1 },
  log: { backgroundColor: "#f3f4f6", borderRadius: 8, flex: 1, marginTop: 10, padding: 8 },
  title: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
})
