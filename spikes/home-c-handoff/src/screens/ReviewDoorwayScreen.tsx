import { ScrollView, StyleSheet, Text, View } from "react-native"

import { day, etTime } from "../data"
import { Btn, C, Caption, Card, Screen } from "../ui"

/**
 * The ONE representative review screen the rubric allows (badge or doorway —
 * ground rule 3). Shows the 07:44 draft-review state from the fixture's
 * reviewSession; the full extraction-review card flow belongs to slots 11–14.
 */
export const ReviewDoorwayScreen = ({
  onOpenEvent,
  onDone,
}: {
  onOpenEvent: (eventId: string) => void
  onDone: () => void
}) => {
  const session = day.reviewSessions[0]
  if (session === undefined) return null

  return (
    <Screen>
      <ScrollView contentContainerStyle={local.content}>
        <Text style={local.title}>Review — draft entry (07:44)</Text>
        <Card title={`Entry ${session.entryId} · state: ${session.seenState}`}>
          <Caption>
            Extraction finished server-side while Elena was on the call. She inspects BEFORE
            publishing: correct, restrict, attach — the three actions below, each previewed.
          </Caption>
          {session.actions.map((a, i) => (
            <View key={i} style={local.action}>
              <Text style={local.actionLine}>
                {etTime(a.at)} · {a.kind}
              </Text>
              <Caption>{a.detail}</Caption>
            </View>
          ))}
        </Card>
        <Card>
          <Btn label="Open the corrected sleep event" onPress={() => onOpenEvent("ev-sleep-2")} />
        </Card>
        <Card>
          <Caption>{session.caption}</Caption>
        </Card>
        <Btn label="‹ Back to home" onPress={onDone} />
      </ScrollView>
    </Screen>
  )
}

const local = StyleSheet.create({
  content: { paddingBottom: 32, gap: 8 },
  title: { color: C.text, fontSize: 19, fontWeight: "800", marginBottom: 4 },
  action: { marginTop: 8 },
  actionLine: { color: C.text, fontSize: 13.5, fontWeight: "700" },
})
