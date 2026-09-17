import { useState } from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import { currentEvents, entryById } from "../data"
import { Btn, C, Caption, Card, Chip, Screen } from "../ui"

/**
 * S1-A replay — capture with interruption, then quiet-input completion.
 * Scripted off fixture HOME-C-S1-DAY: Elena dictates topics 1–3 by voice
 * (07:38), the preschool calls (07:41), draft is saved untouched, server
 * extraction completes during the call (envelope rule a), Elena returns at
 * 07:51 and TYPES the remaining topics while holding Sofia, answers exactly
 * one clarification, publishes at 07:55.
 */
const PHASES = [
  "intro",
  "t1",
  "t2",
  "t3",
  "interrupt",
  "draftSaved",
  "attempt0",
  "resumed",
  "t5",
  "t6",
  "clarify",
  "published",
] as const
type Phase = (typeof PHASES)[number]

const topicsShown: Record<Phase, number> = {
  intro: 0,
  t1: 1,
  t2: 2,
  t3: 3,
  interrupt: 3,
  draftSaved: 3,
  attempt0: 3,
  resumed: 4,
  t5: 5,
  t6: 6,
  clarify: 6,
  published: 6,
}

export const CaptureScreen = ({ onDone }: { onDone: () => void }) => {
  const [phase, setPhase] = useState<Phase>("intro")
  const [clarifyAnswered, setClarifyAnswered] = useState(false)
  const entry = entryById("entry-e1")
  if (entry === undefined) return null

  // Current events sorted by excerpt offset == dictation order (topics 1–6).
  const topics = currentEvents()
    .filter((e) => e.entryId === "entry-e1")
    .sort((a, b) => a.sourceExcerpt.start - b.sourceExcerpt.start)
  const shown = topics.slice(0, topicsShown[phase])
  const modeFor = (i: number): "voice" | "text" => (i < 3 ? "voice" : "text")

  const next = (): void => {
    const i = PHASES.indexOf(phase)
    const nextPhase = PHASES[i + 1]
    if (nextPhase !== undefined) setPhase(nextPhase)
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={local.content}>
        <Text style={local.title}>Speak an update — Tuesday 07:38, Elena</Text>
        <Caption>
          Scripted replay of fixture HOME-C-S1-DAY (S1-A). Each tap counts as a real user action
          (D1 is scored on taps and screens).
        </Caption>

        {phase === "intro" && (
          <Card title="Ready to dictate">
            <Caption>One hand holding Sofia. Voice is primary; the text path always exists.</Caption>
            <Btn label="🎙 Start dictation" primary onPress={next} />
          </Card>
        )}

        {shown.map((topic, i) => (
          <Card key={topic.eventId}>
            <View style={local.topicRow}>
              <Chip label={modeFor(i) === "voice" ? "🎙 voice" : "⌨️ typed (quiet input)"} tone={modeFor(i) === "voice" ? "accent" : "default"} />
              <Caption>{modeFor(i) === "voice" ? `07:3${8 + i}` : "07:5x"}</Caption>
            </View>
            <Text style={local.topicText}>
              “{entry.wire.transcript.slice(topic.sourceExcerpt.start, topic.sourceExcerpt.end)}”
            </Text>
          </Card>
        ))}

        {(phase === "interrupt" || phase === "draftSaved") && (
          <Card title="📞 Incoming call — Preschool" tone="warn">
            <Caption>
              {phase === "interrupt"
                ? "07:41 — after the third topic. Elena takes the call."
                : "Draft saved — nothing lost. The transcript so far is preserved verbatim; the call inserts no bytes into it."}
            </Caption>
            <Btn label={phase === "interrupt" ? "Answer the call (capture pauses)" : "Continue (still on the call)"} onPress={next} />
          </Card>
        )}

        {phase === "attempt0" && (
          <Card title="Extraction finished during the call" tone="ok">
            <Caption>
              Attempt 0 (07:39–07:42) ran SERVER-SIDE over the partial transcript — the client
              disconnect did not cancel it (contract v0.2 envelope rule a). Elena never waited on it.
            </Caption>
            <Btn label="Back to the draft" onPress={next} />
          </Card>
        )}

        {phase === "resumed" && (
          <Card title="07:51 — back 10 minutes later" tone="ok">
            <Caption>
              Still holding Sofia — she switches to typing (the quiet-input demonstration, S1-A).
              Remaining topics are typed, not lost.
            </Caption>
          </Card>
        )}

        {phase === "clarify" && (
          <Card title="One clarification needed" tone="warn">
            <Text style={local.topicText}>{entry.capture.clarification?.question}</Text>
            <Caption>
              Exactly one clarification round-trip (rubric target: 1). Ambiguous clause:
              “She was upset again after quiet time.”
            </Caption>
            <Text style={local.topicText}>{entry.capture.clarification?.answer}</Text>
            {clarifyAnswered ? (
              <Caption>Sent — the mood event becomes caregiver-confirmed (confidence 1.0).</Caption>
            ) : (
              <Btn label="Send this answer" primary onPress={() => setClarifyAnswered(true)} />
            )}
            {clarifyAnswered && <Btn label="Finish and publish" primary onPress={next} />}
          </Card>
        )}

        {phase === "published" && (
          <Card title="Published 07:55" tone="ok">
            <Caption>
              draft → published (per-entry lifecycle state, contract v0.2). Topics captured: 6/6,
              dropped: 0. Extraction attempt 1 re-ran over the full transcript; the stale attempt 0
              was discarded, never merged (rule 2) — and the 07:44 correction survived it because
              caregiver-confirmed events are pinned.
            </Caption>
            <Btn label="Done — back to home" primary onPress={onDone} />
          </Card>
        )}

        {phase !== "intro" && phase !== "published" && (
          <View style={local.navRow}>
            <Btn label="Next ›" onPress={next} />
          </View>
        )}
      </ScrollView>
    </Screen>
  )
}

const local = StyleSheet.create({
  content: { paddingBottom: 32, gap: 4 },
  title: { color: C.text, fontSize: 19, fontWeight: "800", marginBottom: 4 },
  topicRow: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 6 },
  topicText: { color: C.text, fontSize: 14, lineHeight: 20 },
  navRow: { marginTop: 8 },
})
