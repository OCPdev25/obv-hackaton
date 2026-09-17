import { ConvexProvider, ConvexReactClient } from "convex/react"
import { useMemo } from "react"
import { StyleSheet, View } from "react-native"

import { getConvexClientUrl } from "./src/lib/convex"
import { MonthHistoryScreen } from "./src/month/MonthHistoryScreen"
import { VoicePhotoProof } from "./src/proof/VoicePhotoProof"

const QA_PROOF_ENABLED = process.env.EXPO_PUBLIC_QA_PROOF === "1"

export default function App() {
  const client = useMemo(() => new ConvexReactClient(getConvexClientUrl()), [])

  // QA branch: EXPO_PUBLIC_QA_PROOF=1 swaps the home surface for the PR #8
  // device-proof checklist screen (see apps/mobile/src/proof/).
  if (QA_PROOF_ENABLED) {
    return <VoicePhotoProof />
  }

  return (
    <ConvexProvider client={client}>
      <View style={styles.container}>
        <MonthHistoryScreen />
      </View>
    </ConvexProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
})
