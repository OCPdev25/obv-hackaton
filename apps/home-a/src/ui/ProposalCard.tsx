/**
 * In-thread review card for one proposed event — editable before publish
 * (type, child, time, amount, audience). Edits live in the parent capture
 * view and are applied at publish.
 */
import { useState } from "react"
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native"

import type { EventCategory } from "@journal/domain"
import type { EventEdit, ProposalRecord } from "../journal/store"
import { colors, radius, spacing } from "./theme"
import { formatDayTime } from "./format"

const CATEGORIES: readonly EventCategory[] = ["meal", "sleep", "mood", "potty", "milestone", "school"]

export interface ChildOption {
  readonly childId: string
  readonly name: string
}

interface Props {
  readonly proposal: ProposalRecord
  readonly children_: readonly ChildOption[]
  readonly edit: EventEdit | undefined
  readonly onChange: (patch: EventEdit) => void
}

/** Local EDT wall-clock parse against the proposal's day. */
function parseLocalTime(text: string, reference: number): number | undefined {
  const match = text.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (match === null) return undefined
  const hour = Number.parseInt(match[1] ?? "", 10)
  const minute = Number.parseInt(match[2] ?? "", 10)
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 23 || minute > 59) return undefined
  const dayStart = reference - ((reference / 1000) % 86400) * 1000
  return dayStart + (hour + 4) * 3_600_000 + minute * 60_000
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && { backgroundColor: colors.accent, borderColor: colors.accent }]}
    >
      <Text style={[styles.chipText, active && { color: "#FFFFFF" }]}>{label}</Text>
    </Pressable>
  )
}

export function ProposalCard({ proposal, children_, edit, onChange }: Props) {
  const [timeDraft, setTimeDraft] = useState("")
  const [amountDraft, setAmountDraft] = useState("")

  const category = edit?.category ?? proposal.category
  const childId = edit?.childId ?? proposal.childId
  const timestamp = edit?.timestamp ?? proposal.timestamp
  const payload = edit?.payload ?? proposal.payload
  const audience = edit?.audience ?? proposal.audience

  const minutes = payload?.["minutes"]
  const childName = children_.find((child) => child.childId === childId)?.name ?? childId

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        Proposed: {category} · {childName} · {formatDayTime(timestamp)}
        {minutes !== undefined ? ` · ${minutes} min` : ""}
      </Text>
      <Text style={styles.provenance}>
        from “{proposal.sourceClause}” · confidence {proposal.confidence.toFixed(2)} · attempt {proposal.attempt}
        {proposal.producedBy !== undefined ? ` · ${proposal.producedBy.extractorVersion}` : ""}
      </Text>

      <View style={styles.rowWrap}>
        {CATEGORIES.map((option) => (
          <Chip key={option} label={option} active={category === option} onPress={() => onChange({ category: option })} />
        ))}
      </View>
      <View style={styles.rowWrap}>
        {children_.map((child) => (
          <Chip key={child.childId} label={child.name} active={childId === child.childId} onPress={() => onChange({ childId: child.childId })} />
        ))}
      </View>
      <View style={styles.rowWrap}>
        <Chip label="family" active={audience === "family"} onPress={() => onChange({ audience: "family" })} />
        <Chip label="parents-only" active={audience === "parents-only"} onPress={() => onChange({ audience: "parents-only" })} />
      </View>

      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="time HH:MM"
          value={timeDraft}
          onChangeText={(text) => {
            setTimeDraft(text)
            const parsed = parseLocalTime(text, timestamp)
            if (parsed !== undefined) onChange({ timestamp: parsed })
          }}
        />
        <TextInput
          style={styles.input}
          placeholder={minutes !== undefined ? `${minutes}` : "minutes"}
          value={amountDraft}
          onChangeText={(text) => {
            setAmountDraft(text)
            const parsed = Number.parseInt(text, 10)
            if (!Number.isNaN(parsed) && parsed > 0) onChange({ payload: { minutes: parsed } })
          }}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing(3),
    marginBottom: spacing(2),
  },
  title: { color: colors.ink, fontWeight: "600", marginBottom: spacing(1) },
  provenance: { color: colors.sub, fontSize: 11, marginBottom: spacing(2), fontStyle: "italic" },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1), marginBottom: spacing(2) },
  row: { flexDirection: "row", gap: spacing(2) },
  chip: {
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.chip,
  },
  chipText: { color: colors.ink, fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    minWidth: 110,
    color: colors.ink,
  },
})
