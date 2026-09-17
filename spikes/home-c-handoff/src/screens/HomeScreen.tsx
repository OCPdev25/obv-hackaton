import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import {
  CATEGORY_GLYPH,
  confidenceLabel,
  currentEvents,
  day,
  eventTime,
  feedForMember,
  month,
  restrictionFor,
} from "../data"
import { Btn, C, Caption, Card, Chip, FactRow, Screen, SectionTitle, styles as ui } from "../ui"

/**
 * THE CANDIDATE-C LENS: the home leads with the TAKEOVER BRIEF — what the
 * on-duty caregiver needs to take over care right now. Capture and feed serve
 * the brief. One-handed: capture (the most frequent action) sits in the
 * bottom thumb zone; brief actions are full-width rows in the lower third.
 */
export const HomeScreen = ({
  viewer,
  onSwitchViewer,
  onOpenCapture,
  onOpenReview,
  onOpenMonth,
  onOpenEvent,
  onOpenRosa,
}: {
  viewer: string
  onSwitchViewer: (userId: string) => void
  onOpenCapture: () => void
  onOpenReview: () => void
  onOpenMonth: () => void
  onOpenEvent: (eventId: string) => void
  onOpenRosa: () => void
}) => {
  const [confirmed, setConfirmed] = useState(false)
  const [showAnswer, setShowAnswer] = useState(false)
  const question = day.readOnlyQuestions[0]
  const feed = feedForMember(viewer)

  return (
    <Screen>
      <ScrollView contentContainerStyle={local.content}>
        <View style={local.header}>
          <Text style={local.headerTitle}>
            {day.household.child.name} · {day.household.child.ageYears} · {day.household.name}
          </Text>
          <Caption>
            {day.dayLabel} Sep 15 — 18:10 · last update 08:09 · 2 captures · 7 events
          </Caption>
        </View>

        <View style={local.chips}>
          {day.household.members.map((m) => (
            <Chip
              key={m.userId}
              label={`Viewing as ${m.userId}`}
              tone={viewer === m.userId ? "accent" : "default"}
              onPress={() => onSwitchViewer(m.userId)}
            />
          ))}
        </View>

        <SectionTitle>Take over Sofia's care</SectionTitle>
        <Card title="Bedtime tonight — catch-up brief" tone="ok">
          {day.takeover.fiveFacts.map((fact, i) => {
            const eventRef = fact.refs.find((r) => r.kind === "event")
            return (
              <FactRow
                key={fact.headline}
                index={i + 1}
                headline={fact.headline}
                detail={fact.detail ?? undefined}
                onOpenSource={eventRef !== undefined ? () => onOpenEvent(eventRef.ref) : undefined}
              />
            )
          })}
          <View style={local.pendingWrap}>
            {day.takeover.pendingItems.map((p) => (
              <Text key={p.label} style={local.pendingLine}>
                ✓ {p.label} — {p.detail}
              </Text>
            ))}
          </View>
          <Text style={local.planLine}>Tonight's plan: {day.takeover.plan.note}</Text>
          <Btn
            label={confirmed ? "Taking over — confirmed 18:12 (S1-E ✓)" : "Confirm takeover"}
            primary
            tone="ok"
            onPress={() => setConfirmed(true)}
          />
        </Card>

        {question !== undefined && (
          <Card title="Ask about Sofia (read-only)">
            <Btn label={`“${question.question}”`} onPress={() => setShowAnswer(true)} />
            {showAnswer && (
              <View style={local.answerWrap}>
                <Text style={local.answerText}>{question.answer}</Text>
                {question.sources.map((s, i) => (
                  <Text key={i} style={ui.caption}>
                    • [{s.kind}] {s.ref}
                    {s.excerpt !== undefined ? ` — “${s.excerpt}”` : ""}
                  </Text>
                ))}
                <Caption>Questions never write — hard requirement (S1-E).</Caption>
              </View>
            )}
          </Card>
        )}

        <SectionTitle>Today's feed — per-event audience cues</SectionTitle>
        {feed.map(({ event, cue }) => {
          const restriction = restrictionFor(event.eventId)
          if (cue === "locked") {
            return (
              <Card key={event.eventId} tone="warn">
                <Text style={local.lockLine}>🔒 Parents only — locked for this viewer</Text>
                <Caption>{restriction?.note}</Caption>
              </Card>
            )
          }
          return (
            <Card key={event.eventId} style={local.eventCard}>
              <View style={local.eventRow}>
                <Text style={local.glyph}>{CATEGORY_GLYPH[event.wire.category] ?? "•"}</Text>
                <View style={local.eventBody}>
                  <Text style={local.eventNote}>{event.wire.note}</Text>
                  <Text style={ui.caption}>
                    {eventTime(event)} · {confidenceLabel(event.wire)}
                    {event.audienceScope === "parents" ? " · 🔒 parents only" : ""}
                    {event.corrects !== undefined ? " · corrected (original preserved)" : ""}
                  </Text>
                </View>
                <Pressable onPress={() => onOpenEvent(event.eventId)} hitSlop={8}>
                  <Text style={ui.sourceLink}>source ↗</Text>
                </Pressable>
              </View>
            </Card>
          )
        })}

        <SectionTitle>Month history (30 days)</SectionTitle>
        <Card>
          <View style={local.strip}>
            {month.days.map((d) => (
              <View
                key={d.date}
                style={[local.stripCell, d.coverage === "full" && { backgroundColor: C.ok }, d.coverage === "partial" && { backgroundColor: C.warn }]}
              />
            ))}
          </View>
          <Caption>Green = full capture, amber = gaps, dark = none. Tap for details.</Caption>
          <Btn label="Open 30-day history" onPress={onOpenMonth} />
        </Card>

        <Card title="Doorways (scope-limited)">
          <View style={local.chips}>
            <Chip label="Extraction review — one representative screen (S1-B)" tone="accent" onPress={onOpenReview} />
            <Chip label="What Rosa sees (S1-F)" tone="accent" onPress={onOpenRosa} />
          </View>
          <Caption>
            The full extraction-review card flow (slots 11–14), handoff implementation (slot 23), and
            digest flow (slot 24) are out of scope — the home lens only (rubric ground rule 3).
          </Caption>
        </Card>

        <View style={local.captureBar}>
          <Btn label="🎙 Speak an update" primary onPress={onOpenCapture} />
          <Btn label="or type (quiet-input path)" onPress={onOpenCapture} />
          <Caption>Thumb zone: capture lives in the bottom third — one-handed (S1-A).</Caption>
        </View>
      </ScrollView>
    </Screen>
  )
}

const local = StyleSheet.create({
  content: { paddingBottom: 32 },
  header: { marginBottom: 10 },
  headerTitle: { color: C.text, fontSize: 19, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pendingWrap: { marginTop: 4, marginBottom: 8 },
  pendingLine: { color: C.dim, fontSize: 12.5, lineHeight: 17 },
  planLine: { color: C.text, fontSize: 13.5, fontWeight: "600", marginBottom: 10 },
  answerWrap: { marginTop: 10, gap: 4 },
  answerText: { color: C.text, fontSize: 13.5, lineHeight: 19 },
  lockLine: { color: C.warn, fontSize: 14, fontWeight: "700", marginBottom: 4 },
  eventCard: { paddingVertical: 10 },
  eventRow: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  glyph: { fontSize: 18 },
  eventBody: { flex: 1 },
  eventNote: { color: C.text, fontSize: 14, lineHeight: 19 },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 3, marginBottom: 8 },
  stripCell: { backgroundColor: C.cardLine, borderRadius: 2, height: 14, width: 9 },
  captureBar: { gap: 8, marginTop: 4 },
})
