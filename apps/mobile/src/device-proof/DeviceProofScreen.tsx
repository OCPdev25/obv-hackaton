import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text as RNText, View } from 'react-native'
import { RecordingPresets, useAudioRecorder } from 'expo-audio'

import { Text } from '@journal/ui'

import {
  BOGUS_LOCALE,
  checkConvexUpload,
  checkLocaleMatrix,
  checkPhotoPick,
  checkPrepare,
  checkRecordAndTranscribe,
  checkTurboModuleProbe,
  PROOF_LOCALES,
} from './checks'
import type { EvidenceClass, EvidenceRow, EvidenceStatus } from './evidence'
import { nextRowId, toRow, type EvidenceEntry, type EvidenceLog } from './evidence'

/**
 * DeviceProof debug screen — the on-device vehicle for the PR #8 10-item
 * device-proof checklist. Runs checks (a)-(f) and logs timestamped evidence
 * rows on-screen, each labeled simulator / fake / hardware-only-blocked so a
 * reviewer can tell mechanically-produced evidence from hardware-pending
 * evidence at a glance.
 */

const STATUS_STYLES: Record<EvidenceStatus, { color: string; tag: string }> = {
  pass: { color: '#1a7f37', tag: 'PASS' },
  fail: { color: '#cf222e', tag: 'FAIL' },
  skipped: { color: '#9a6700', tag: 'SKIP' },
  info: { color: '#0969da', tag: 'INFO' },
}

const CLASS_TAGS: Record<EvidenceClass, string> = {
  simulator: '[simulator]',
  fake: '[fake]',
  'hardware-only-blocked': '[hardware-only-blocked]',
}

interface DeviceProofScreenProps {
  readonly onBack: () => void
}

export default function DeviceProofScreen({ onBack }: DeviceProofScreenProps) {
  const [rows, setRows] = useState<readonly EvidenceRow[]>([])
  const [running, setRunning] = useState(false)
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)

  const append = useCallback((entry: EvidenceEntry) => {
    setRows((previous) => [toRow(entry, nextRowId(previous), new Date().toISOString()), ...previous])
  }, [])

  const runCheck = useCallback(
    async (run: (log: EvidenceLog) => Promise<void>) => {
      if (running) return
      setRunning(true)
      try {
        await run(append)
      } finally {
        setRunning(false)
      }
    },
    [append, running],
  )

  const runAll = useCallback(() => {
    void runCheck(async (log) => {
      checkTurboModuleProbe(log)
      checkLocaleMatrix(log)
      await checkPrepare(log)
      await checkRecordAndTranscribe(recorder, log)
      const picked = await checkPhotoPick(log)
      await checkConvexUpload(picked, log)
    })
  }, [recorder, runCheck])

  const buttons: readonly { readonly title: string; readonly run: () => void }[] = [
    {
      title: 'Run all (a-f)',
      run: runAll,
    },
    {
      title: 'a) TurboModule probe',
      run: () => void runCheck(async (log) => checkTurboModuleProbe(log)),
    },
    {
      title: 'b) Locale matrix',
      run: () => void runCheck(async (log) => checkLocaleMatrix(log)),
    },
    {
      title: "c) prepare('en-US')",
      run: () => void runCheck(async (log) => checkPrepare(log)),
    },
    {
      title: 'd) Record ~5s + transcribe',
      run: () => void runCheck(async (log) => checkRecordAndTranscribe(recorder, log)),
    },
    {
      title: 'e) Pick photo',
      run: () => void runCheck(async (log) => void (await checkPhotoPick(log))),
    },
    {
      title: 'f) Convex upload (no pick)',
      run: () => void runCheck(async (log) => checkConvexUpload(null, log)),
    },
  ]

  return (
    <View style={styles.container}>
      <Text>Device proof — PR #8 checklist harness</Text>
      <RNText style={styles.hint}>
        Checks (a)-(f) with {PROOF_LOCALES.length}+1 locales (incl. bogus {BOGUS_LOCALE}). Rows carry a
        class label: [simulator] = mechanically verifiable here, [fake] = deterministic in-memory
        double, [hardware-only-blocked] = needs an iOS 26 device / dev-client build.
      </RNText>

      <View style={styles.buttonGrid}>
        {buttons.map((button) => (
          <Pressable
            key={button.title}
            style={[styles.button, running && styles.buttonDisabled]}
            disabled={running}
            onPress={button.run}
          >
            <RNText style={styles.buttonText}>{running ? 'Running…' : button.title}</RNText>
          </Pressable>
        ))}
      </View>

      <Pressable style={[styles.button, styles.backButton]} onPress={onBack}>
        <RNText style={styles.buttonText}>← Back to home</RNText>
      </Pressable>

      <ScrollView style={styles.log}>
        {rows.length === 0 ? (
          <RNText style={styles.empty}>No evidence rows yet — run a check.</RNText>
        ) : (
          rows.map((row) => (
            <View key={row.id} style={styles.row}>
              <RNText style={styles.rowHeader}>
                #{row.id} · {row.at}
              </RNText>
              <RNText style={styles.rowLabel}>
                <RNText style={{ color: STATUS_STYLES[row.status].color }}>{STATUS_STYLES[row.status].tag}</RNText>
                {'  '}
                <RNText style={styles.classTag}>{CLASS_TAGS[row.evidenceClass]}</RNText>
                {'  '}
                {row.label}
              </RNText>
              <RNText style={styles.rowDetail}>{row.detail}</RNText>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  backButton: {
    backgroundColor: '#444c56',
  },
  button: {
    backgroundColor: '#0969da',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  container: {
    flex: 1,
    padding: 16,
    paddingTop: 48,
  },
  classTag: {
    color: '#57606a',
    fontWeight: '700',
  },
  empty: {
    color: '#57606a',
    fontSize: 13,
    marginTop: 12,
  },
  hint: {
    color: '#57606a',
    fontSize: 12,
    marginBottom: 12,
  },
  log: {
    flex: 1,
    marginTop: 8,
  },
  row: {
    borderBottomColor: '#d0d7de',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
  },
  rowDetail: {
    color: '#333b42',
    fontSize: 11,
  },
  rowHeader: {
    color: '#8c959f',
    fontSize: 10,
  },
  rowLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
})
