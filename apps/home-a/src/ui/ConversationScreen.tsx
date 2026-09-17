/**
 * The conversation surface: capture (typed + simulated-voice chips), in-thread
 * review/publish, corrections, catch-up, month view, and read-only questions
 * all live in ONE scrolling thread.
 */
import { useCallback, useState, useSyncExternalStore } from "react"
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native"

import type { EventEdit } from "../journal/store.js"
import type { ConversationController } from "../conversation/controller.js"
import { DEMO_QUESTIONS, DEMO_UTTERANCES } from "../fixtures/demoUtterances.js"
import { colors, radius, spacing } from "./theme.js"
import { TurnRow } from "./TurnRow.js"

interface Props {
  readonly controller: ConversationController
  readonly displayName: string
  readonly onSignOut: () => void
}

export function ConversationScreen({ controller, displayName, onSignOut }: Props) {
  useSyncExternalStore(controller.subscribe, controller.getVersion)
  const [draft, setDraft] = useState("")

  const send = useCallback(() => {
    const text = draft.trim()
    if (text.length === 0) return
    controller.sendText(text)
    setDraft("")
  }, [controller, draft])

  const children_ = controller.childrenRoster.map((child) => ({ childId: child.childId, name: child.name }))
  const turns = controller.getTurns()

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>The Journal</Text>
          <Text style={styles.headerSub}>Polanco Household · signed in as {displayName}</Text>
        </View>
        <Pressable onPress={onSignOut} style={styles.signOut}>
          <Text style={{ color: colors.accent }}>switch profile</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.thread} contentContainerStyle={styles.threadContent}>
        <Text style={styles.dayMarker}>September 2026 · synthetic history seeded</Text>
        {turns.map((turn) => (
          <TurnRow
            key={turn.id}
            turn={turn}
            children_={children_}
            eventText={(eventId) => {
              const event = controller.eventFor(eventId)
              if (event === undefined) return eventId
              const child = children_.find((option) => option.childId === event.childId)
              const minutes = event.payload?.["minutes"]
              return `${child?.name ?? event.childId} · ${event.category} · ${new Date(event.timestamp).toISOString()}${minutes !== undefined ? ` · ${minutes} min` : ""}`
            }}
            onPublish={controller.publish}
            onCorrect={controller.correct}
          />
        ))}
      </ScrollView>

      <View style={styles.chipsBox}>
        <Text style={styles.chipsLabel}>voice demo (simulated transcription → same pipeline):</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing(1) }}>
          {DEMO_UTTERANCES.map((utterance) => (
            <Pressable key={utterance} style={styles.chip} onPress={() => controller.sendVoiceDemo(utterance)}>
              <Text style={styles.chipText}>🎙 {utterance.length > 42 ? `${utterance.slice(0, 42)}…` : utterance}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={styles.chipsLabel}>read-only questions (never write):</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing(1) }}>
          {DEMO_QUESTIONS.map((question) => (
            <Pressable key={question} style={styles.chip} onPress={() => controller.ask(question)}>
              <Text style={styles.chipText}>{question}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.chip} onPress={() => controller.catchUp()}>
            <Text style={styles.chipText}>✨ Catch me up since last time</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={() => controller.monthView()}>
            <Text style={styles.chipText}>📅 September view</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={() => controller.markCaughtUp()}>
            <Text style={styles.chipText}>Mark caught up</Text>
          </Pressable>
        </ScrollView>
      </View>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Type an update… mixed topics welcome"
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable style={[styles.send, draft.trim().length === 0 && { opacity: 0.4 }]} onPress={send}>
          <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Send</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingTop: spacing(14), paddingBottom: spacing(2), paddingHorizontal: spacing(3), backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.ink },
  headerSub: { fontSize: 12, color: colors.sub, marginTop: 2 },
  signOut: { paddingHorizontal: spacing(2), paddingVertical: spacing(1) },
  thread: { flex: 1 },
  threadContent: { paddingVertical: spacing(3), paddingBottom: spacing(6) },
  dayMarker: { alignSelf: "center", color: colors.sub, fontSize: 11, marginBottom: spacing(2) },
  chipsBox: { paddingHorizontal: spacing(2), paddingTop: spacing(1), borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card, gap: spacing(1) },
  chipsLabel: { fontSize: 10, color: colors.sub, textTransform: "uppercase", letterSpacing: 0.5 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.chip, paddingHorizontal: spacing(2.5), paddingVertical: spacing(1.5) },
  chipText: { color: colors.ink, fontSize: 12 },
  composer: { flexDirection: "row", alignItems: "flex-end", padding: spacing(2), backgroundColor: colors.card, gap: spacing(2) },
  input: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing(2), paddingVertical: spacing(1.5), color: colors.ink, minHeight: 40, backgroundColor: "#FFFFFF" },
  send: { backgroundColor: colors.accent, borderRadius: radius, paddingVertical: spacing(2), paddingHorizontal: spacing(3) },
})
