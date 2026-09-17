import { ConvexProvider, ConvexReactClient } from "convex/react"
import { useMemo } from "react"
import { StyleSheet, View } from "react-native"

import { getConvexClientUrl } from "./src/lib/convex"
import { MonthHistoryScreen } from "./src/month/MonthHistoryScreen"

export default function App() {
  const client = useMemo(() => new ConvexReactClient(getConvexClientUrl()), [])

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
