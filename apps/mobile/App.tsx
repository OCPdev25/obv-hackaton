import { ConvexProvider, ConvexReactClient } from "convex/react"
import { useMemo } from "react"
import { StyleSheet, View } from "react-native"

import { Text } from "@journal/ui"

import { getConvexClientUrl } from "./src/lib/convex"

export default function App() {
  const client = useMemo(() => new ConvexReactClient(getConvexClientUrl()), [])

  return (
    <ConvexProvider client={client}>
      <View style={styles.container}>
        <Text>Shared Child Journal</Text>
      </View>
    </ConvexProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
})
