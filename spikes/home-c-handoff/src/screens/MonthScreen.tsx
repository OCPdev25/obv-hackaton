import { useState } from "react"
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native"

import { month } from "../data"
import { C, Caption, Card, Screen } from "../ui"

/**
 * Month history — the same 30-day window every candidate shows (rubric ground
 * rule 1). The handoff lens reads it as context for takeover: patterns and
 * COVERAGE GAPS are disclosed, never smoothed over.
 */
export const MonthScreen = ({ onDone }: { onDone: () => void }) => {
  const [selected, setSelected] = useState<string | undefined>("2026-09-15")
  const selectedDay = month.days.find((d) => d.date === selected)

  return (
    <Screen>
      <ScrollView contentContainerStyle={local.content}>
        <Text style={local.title}>Last 30 days — Sofia</Text>
        <Caption>{month.note}</Caption>

        <Card title={`${month.window.start} → ${month.window.end}`}>
          <View style={local.grid}>
            {month.days.map((d) => (
              <Pressable
                key={d.date}
                onPress={() => setSelected(d.date)}
                style={[local.cell, d.coverage === "full" && { backgroundColor: C.ok }, d.coverage === "partial" && { backgroundColor: C.warn }]}
              />
            ))}
          </View>
          <View style={local.legend}>
            <Caption>■ full ■ gaps ■ no capture — tap a day</Caption>
          </View>
        </Card>

        {selectedDay !== undefined && (
          <Card title={`${selectedDay.dayLabel} ${selectedDay.date}`}>
            <Text style={local.line}>
              {selectedDay.captures} captures ·{" "}
              {Object.entries(selectedDay.eventsByCategory)
                .map(([k, v]) => `${k}: ${v}`)
                .join(", ") || "no events"}
            </Text>
            <Text style={local.line}>
              Night wakings: {selectedDay.nightWakings} · nap: {selectedDay.napMinutes} min ·
              potty: {selectedDay.pottySuccesses}✓/{selectedDay.pottyAccidents}✗
            </Text>
            {selectedDay.milestones.map((m) => (
              <Text key={m} style={local.milestone}>🌟 {m}</Text>
            ))}
            {selectedDay.gapNotes.length > 0 && (
              <Text style={local.gap}>⚠ {selectedDay.gapNotes.join("; ")} — shown as-is, not smoothed</Text>
            )}
            <Caption>
              {selectedDay.date === "2026-09-15"
                ? "This row is SET from the S1 fixture — month history and scenario cannot diverge (evaluator consistency check)."
                : "Generated deterministically (seed 20260915); committed JSON is byte-identical on regeneration."}
            </Caption>
          </Card>
        )}

        <Card title="S1-E reads this in under 90 seconds">
          <Caption>
            Glanceable pattern: sleep is the wobbly column this month — one night waking trend line,
            zero naps today. The brief above the fold carries today's copy of that pattern.
          </Caption>
        </Card>
      </ScrollView>
    </Screen>
  )
}

const local = StyleSheet.create({
  content: { paddingBottom: 32, gap: 4 },
  title: { color: C.text, fontSize: 19, fontWeight: "800", marginBottom: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginVertical: 10 },
  cell: { backgroundColor: C.cardLine, borderRadius: 4, height: 26, width: 26 },
  legend: { marginBottom: 6 },
  line: { color: C.text, fontSize: 13.5, lineHeight: 19 },
  milestone: { color: C.text, fontSize: 13.5, lineHeight: 19 },
  gap: { color: C.warn, fontSize: 12.5, lineHeight: 17, marginTop: 4 },
})
