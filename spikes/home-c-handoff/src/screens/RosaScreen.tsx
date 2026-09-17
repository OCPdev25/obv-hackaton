import { ScrollView, StyleSheet, Text, View } from "react-native"

import { CATEGORY_GLYPH, confidenceLabel, currentEvents, cueFor, day, entryById, eventTime, memberByUserId } from "../data"
import { Btn, C, Caption, Card, Screen, SectionTitle } from "../ui"

/**
 * S1-F — caregiver awareness. Rosa (invited grandmother, caregiver role) sees
 * what her grants allow: the parents-only meltdown event shows as a locked
 * tile (visibly locked, not silently hidden), drafts never reach her, and
 * today's plan is visible so she can actually help.
 */
export const RosaScreen = ({ onDone }: { onDone: () => void }) => {
  const rosa = memberByUserId("rosa")
  if (rosa === undefined) return null

  return (
    <Screen>
      <ScrollView contentContainerStyle={local.content}>
        <Text style={local.title}>What Rosa sees — Wednesday 14:00</Text>
        <Caption>
          Rosa's grants: caregiver role, weekday afternoons. Everything below is resolved from
          household/relationship grants — never from a per-entry audience field (contract v0.2).
        </Caption>

        <SectionTitle>Today's plan (visible)</SectionTitle>
        <Card title="Plan">
          <Text style={local.line}>{day.takeover.plan.note}</Text>
        </Card>

        <SectionTitle>Sofia's day (grants-filtered)</SectionTitle>
        {currentEvents().map((event) => {
          const cue = cueFor(rosa, event)
          const entry = entryById(event.entryId)
          if (entry === undefined) return null
          if (cue === "locked") {
            return (
              <Card key={event.eventId} tone="warn">
                <Text style={local.lock}>🔒 Parents only — locked</Text>
                <Caption>This event is restricted; Rosa sees the lock, not silence.</Caption>
              </Card>
            )
          }
          return (
            <Card key={event.eventId}>
              <View style={local.row}>
                <Text style={local.glyph}>{CATEGORY_GLYPH[event.wire.category] ?? "•"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={local.line}>{event.wire.note}</Text>
                  <Caption>
                    {eventTime(event)} · {confidenceLabel(event.wire)} · by {event.wire.authorId}
                  </Caption>
                </View>
              </View>
            </Card>
          )
        })}

        <Card title="Drafts never reach caregivers">
          <Caption>
            Prototype rule (stated, because the contract leaves draft visibility open): drafts are
            visible to their author and to parent-role members only.
          </Caption>
        </Card>
        <Btn label="‹ Back to home" onPress={onDone} />
      </ScrollView>
    </Screen>
  )
}

const local = StyleSheet.create({
  content: { paddingBottom: 32, gap: 4 },
  title: { color: C.text, fontSize: 19, fontWeight: "800", marginBottom: 4 },
  line: { color: C.text, fontSize: 14, lineHeight: 20 },
  lock: { color: C.warn, fontSize: 14, fontWeight: "700", marginBottom: 4 },
  row: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  glyph: { fontSize: 18 },
})
