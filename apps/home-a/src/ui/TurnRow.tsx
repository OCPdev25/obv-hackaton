/**
 * Renders one conversation turn. Capture turns embed the proposal review
 * cards; publish receipts embed a correction affordance (append-only).
 */
import { useState } from "react"
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native"

import type { EventEdit, ProposalRecord, Receipt, CorrectionRecord, Citation } from "../journal/store.js"
import type { Event } from "@journal/domain"
import type { Turn } from "../conversation/controller.js"
import { formatDayTime } from "./format.js"
import { colors, radius, spacing } from "./theme.js"
import { ProposalCard, type ChildOption } from "./ProposalCard.js"

/** Derived summary for a decoded Event (correction before/after lines). */
function eventSummary(event: Event, options: readonly ChildOption[]): string {
  const childName = options.find((option) => option.childId === event.childId)?.name ?? event.childId
  const minutes = event.payload?.["minutes"]
  return `${childName} · ${event.category} · ${formatDayTime(event.timestamp)}${minutes !== undefined ? ` · ${minutes} min` : ""}`
}

interface Props {
  readonly turn: Turn
  readonly children_: readonly ChildOption[]
  readonly eventText: (eventId: string) => string
  readonly onPublish: (entryId: string, edits: ReadonlyMap<string, EventEdit>) => void
  readonly onCorrect: (eventId: string, changes: EventEdit, reason: string) => void
}

function AnswerCitations({ citations }: { citations: readonly Citation[] }) {
  return (
    <View style={{ marginTop: spacing(1) }}>
      {citations.map((citation, index) => (
        <Text key={index} style={styles.citation}>
          · “{citation.excerpt}” — {citation.authorId}, {formatDayTime(citation.createdAt)}
        </Text>
      ))}
    </View>
  )
}

function CaptureTurnView({ turn, children_, onPublish }: Pick<Props, "turn" | "children_" | "onPublish"> & { turn: Extract<Turn, { kind: "capture" }> }) {
  const [edits, setEdits] = useState<Map<string, EventEdit>>(new Map())
  const proposals = turn.proposals

  return (
    <View style={[styles.bubble, styles.theirs]}>
      <Text style={styles.turnLabel}>capture · raw preserved first</Text>
      <Text style={styles.raw}>“{turn.rawTranscript}”</Text>
      {proposals.length === 0 ? (
        <Text style={styles.sub}>No typed events interpreted — this stays a raw note.</Text>
      ) : (
        proposals.map((proposal) => (
          <ProposalCard
            key={proposal.proposalId}
            proposal={proposal}
            children_={children_}
            edit={edits.get(proposal.proposalId)}
            onChange={(patch) => setEdits((current) => new Map(current).set(proposal.proposalId, { ...(current.get(proposal.proposalId) ?? {}), ...patch }))}
          />
        ))
      )}
      {turn.unstructured.length > 0 && (
        <Text style={styles.sub}>Kept as note: {turn.unstructured.map((clause) => clause.text).join(" | ")}</Text>
      )}
      <Pressable style={[styles.button, { backgroundColor: colors.ok }]} onPress={() => onPublish(turn.entryId, edits)}>
        <Text style={styles.buttonText}>Publish ({proposals.length} events + raw)</Text>
      </Pressable>
    </View>
  )
}

function ReceiptEventRow({ eventId, eventText, onCorrect }: { eventId: string; eventText: (id: string) => string; onCorrect: (eventId: string, changes: EventEdit, reason: string) => void }) {
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState("")
  const [reason, setReason] = useState("")
  const parsed = Number.parseInt(minutes, 10)

  return (
    <View style={{ marginBottom: spacing(2) }}>
      <Text style={styles.eventLine}>{eventText(eventId)}</Text>
      {open ? (
        <View style={styles.correctionBox}>
          <TextInput style={styles.input} placeholder="correct minutes" value={minutes} onChangeText={setMinutes} />
          <TextInput style={[styles.input, { flex: 1 }]} placeholder="why (required)" value={reason} onChangeText={setReason} />
          <Pressable
            style={[styles.buttonSmall, { backgroundColor: colors.warn }]}
            onPress={() => {
              if (!Number.isNaN(parsed) && parsed > 0 && reason.trim().length > 0) {
                onCorrect(eventId, { payload: { minutes: parsed } }, reason.trim())
                setOpen(false)
                setMinutes("")
                setReason("")
              }
            }}
          >
            <Text style={styles.buttonText}>Append correction</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setOpen(true)}>
          <Text style={styles.link}>Correct (appends lineage — original stays intact)</Text>
        </Pressable>
      )}
    </View>
  )
}

function ReceiptView({ receipt, eventIds, eventText, onCorrect }: { receipt: Receipt; eventIds: readonly string[]; eventText: (id: string) => string; onCorrect: Props["onCorrect"] }) {
  return (
    <View style={[styles.bubble, styles.theirs, styles.okBox]}>
      <Text style={styles.turnLabel}>publish receipt</Text>
      <Text style={styles.ink}>{receipt.summary}</Text>
      {eventIds.map((eventId) => (
        <ReceiptEventRow key={eventId} eventId={eventId} eventText={eventText} onCorrect={onCorrect} />
      ))}
    </View>
  )
}

export function TurnRow({ turn, children_, eventText, onPublish, onCorrect }: Props) {
  switch (turn.kind) {
    case "user":
      return (
        <View style={[styles.bubble, styles.mine]}>
          <Text style={[styles.ink, { color: "#FFFFFF" }]}>{turn.text}</Text>
          <Text style={styles.mineMeta}>{turn.channel === "voice-simulated" ? "voice (simulated transcription)" : "typed"} · {formatDayTime(turn.at)}</Text>
        </View>
      )
    case "capture":
      return <CaptureTurnView turn={turn} children_={children_} onPublish={onPublish} />
    case "replayed":
      return (
        <View style={[styles.bubble, styles.systemBox]}>
          <Text style={styles.sub}>Duplicate capture — replayed existing draft {turn.entryId} (captureId idempotency).</Text>
        </View>
      )
    case "publish-receipt":
      return <ReceiptView receipt={turn.receipt} eventIds={turn.eventIds} eventText={eventText} onCorrect={onCorrect} />
    case "correction":
      return (
        <View style={[styles.bubble, styles.theirs, styles.warnBox]}>
          <Text style={styles.turnLabel}>correction · append-only lineage</Text>
          <Text style={styles.sub}>before: {eventSummary(turn.record.before, children_)}</Text>
          <Text style={styles.ink}>after: {eventSummary(turn.record.after, children_)}</Text>
          <Text style={styles.sub}>reason: “{turn.record.reason}” — original event preserved</Text>
        </View>
      )
    case "answer":
      return (
        <View style={[styles.bubble, styles.theirs]}>
          <Text style={styles.turnLabel}>answer · read-only, nothing written</Text>
          <Text style={styles.ink}>{turn.answer.kind === "denied" ? turn.answer.detail : turn.answer.text}</Text>
          <AnswerCitations citations={turn.answer.kind === "denied" ? [] : turn.answer.citations} />
        </View>
      )
    case "catchup":
      return (
        <View style={[styles.bubble, styles.theirs, styles.accentBox]}>
          <Text style={styles.turnLabel}>catch-up · what happened since your last check-in</Text>
          <Text style={styles.ink}>{turn.result.kind === "denied" ? turn.result.detail : turn.result.text}</Text>
          <AnswerCitations citations={turn.result.kind === "denied" ? [] : turn.result.citations} />
        </View>
      )
    case "month-view":
      return (
        <View style={[styles.bubble, styles.theirs, styles.accentBox]}>
          <Text style={styles.turnLabel}>month view · {turn.monthKey}</Text>
          <Text style={styles.ink}>{turn.view.kind === "denied" ? turn.view.detail : turn.view.text}</Text>
        </View>
      )
    case "denied":
      return (
        <View style={[styles.bubble, styles.theirs, styles.dangerBox]}>
          <Text style={styles.turnLabel}>denied · fail-closed</Text>
          <Text style={styles.ink}>{turn.action} blocked — {turn.code}: {turn.detail}</Text>
        </View>
      )
    case "system":
      return (
        <View style={[styles.bubble, styles.systemBox]}>
          <Text style={styles.sub}>{turn.text}</Text>
        </View>
      )
  }
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: radius + 4,
    padding: spacing(3),
    marginVertical: spacing(1),
    marginHorizontal: spacing(2),
    maxWidth: "92%",
  },
  mine: { alignSelf: "flex-end", backgroundColor: colors.accent, borderBottomRightRadius: 4 },
  theirs: { alignSelf: "flex-start", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  systemBox: { alignSelf: "center", backgroundColor: "transparent", borderWidth: 0 },
  okBox: { backgroundColor: colors.okSoft, borderColor: colors.ok },
  warnBox: { backgroundColor: colors.warnSoft, borderColor: colors.warn },
  dangerBox: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  accentBox: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  turnLabel: { fontSize: 10, color: colors.sub, textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing(1) },
  raw: { color: colors.ink, fontStyle: "italic", marginBottom: spacing(2) },
  ink: { color: colors.ink },
  sub: { color: colors.sub, fontSize: 12, marginTop: spacing(1) },
  mineMeta: { color: "rgba(255,255,255,0.7)", fontSize: 10, marginTop: spacing(1) },
  citation: { color: colors.sub, fontSize: 11, marginTop: spacing(0.5), fontStyle: "italic" },
  eventLine: { color: colors.ink, fontSize: 13, marginBottom: spacing(0.5) },
  link: { color: colors.accent, fontSize: 12, marginTop: spacing(0.5) },
  correctionBox: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1), marginTop: spacing(1), alignItems: "center" },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing(2), paddingVertical: spacing(1), color: colors.ink, backgroundColor: "#FFFFFF", minWidth: 90 },
  button: { borderRadius: radius, paddingVertical: spacing(2), alignItems: "center", marginTop: spacing(1) },
  buttonSmall: { borderRadius: radius, paddingVertical: spacing(1.5), paddingHorizontal: spacing(2), alignItems: "center" },
  buttonText: { color: "#FFFFFF", fontWeight: "600" },
})
