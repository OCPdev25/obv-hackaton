import { useRef, useState } from 'react'
import { Button, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Effect, Layer, Schema } from 'effect'
import { CaptureId, dispatchMessage, fixtureSessionAlex, fixtureTranscript } from '@journal/domain'
import type { CaptureMessage, CaptureState } from '@journal/domain'
import { deterministicExtractorLayer } from '@journal/extraction'
import { inMemoryStoreLayer, makeInMemoryCaptureStore } from '@journal/persistence'

// Same architecture as the CLI journey: the domain machine plus service
// layers. The in-memory store keeps this screen self-contained; swapping in
// the Convex layer is a one-line change (convexStoreLayer(url)).
const env = Layer.merge(inMemoryStoreLayer(makeInMemoryCaptureStore().store), deterministicExtractorLayer)

const style = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  heading: { fontSize: 22, fontWeight: '700' },
  state: { fontSize: 16, color: '#555' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, minHeight: 80 },
  event: { fontSize: 15, paddingVertical: 4 },
})

export default function App() {
  const stateRef = useRef<CaptureState>({ _tag: 'Idle' })
  const [state, setState] = useState<CaptureState>({ _tag: 'Idle' })
  const [draft, setDraft] = useState(fixtureTranscript)

  const send = (message: CaptureMessage): void => {
    void Effect.runPromise(
      Effect.provide(dispatchMessage(fixtureSessionAlex, stateRef.current, message), env),
    ).then((next) => {
      stateRef.current = next
      setState(next)
    })
  }

  const capture = (): void => {
    const captureId = Schema.decodeSync(CaptureId)(`cap-${Date.now()}`)
    send({ _tag: 'TextCaptured', captureId, transcript: draft, at: new Date() })
  }

  return (
    <SafeAreaView style={style.container}>
      <Text style={style.heading}>Shared Child Journal</Text>
      <Text style={style.state}>capture state: {state._tag}</Text>

      {state._tag === 'Idle' && (
        <View style={{ gap: 12 }}>
          <TextInput style={style.input} multiline value={draft} onChangeText={setDraft} placeholder="Type what happened" />
          <Button title="Capture text" onPress={capture} />
        </View>
      )}

      {state._tag === 'Transcribed' && (
        <View style={{ gap: 12 }}>
          <Text>Raw transcript kept verbatim: “{state.transcript}”</Text>
          {state.lastError !== undefined && <Text>persist error: {state.lastError.code} — raw text preserved</Text>}
          <Button title="Extract events" onPress={() => send({ _tag: 'SubmittedForExtraction' })} />
        </View>
      )}

      {state._tag === 'Extracting' && <Text>Extracting…</Text>}

      {state._tag === 'Review' && (
        <View style={{ gap: 12 }}>
          <ScrollView>
            {state.events.map((event, index) => (
              <Text key={index} style={style.event}>
                • {event.category} (confidence {event.confidence})
              </Text>
            ))}
          </ScrollView>
          <Button title="Confirm & publish" onPress={() => send({ _tag: 'ConfirmedReview' })} />
        </View>
      )}

      {state._tag === 'Published' && (
        <View style={{ gap: 12 }}>
          <Text>Published as {state.entryId}</Text>
          <Button
            title="New capture"
            onPress={() => {
              stateRef.current = { _tag: 'Idle' }
              setState({ _tag: 'Idle' })
            }}
          />
        </View>
      )}
    </SafeAreaView>
  )
}
