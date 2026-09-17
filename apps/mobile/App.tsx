import { ConvexProvider, ConvexReactClient } from "convex/react"
import type { ReactNode } from "react"
import { useMemo } from "react"
import { StyleSheet, View } from "react-native"

import { Text } from "@journal/ui"
import { HomeBDemoApp } from "@journal/home-b"

import { getConvexClientUrl } from "./src/lib/convex"

/**
 * Convex-backed shell (existing behavior): requires EXPO_PUBLIC_CONVEX_URL.
 * Kept in its own component so the client is constructed only on this path.
 */
function ConvexShell({ children }: { children: ReactNode }) {
  const client = useMemo(() => new ConvexReactClient(getConvexClientUrl()), [])
  return <ConvexProvider client={client}>{children}</ConvexProvider>
}

/**
 * Parent-home candidate selection for the A/B comparison:
 * EXPO_PUBLIC_HOME_CANDIDATE=b renders candidate B (Today feed-first home
 * with the persistent conversational composer — in-memory synthetic data, no
 * live Convex required). Without the flag the shell renders unchanged.
 */
export default function App() {
  if (process.env.EXPO_PUBLIC_HOME_CANDIDATE === "b") {
    return <HomeBDemoApp />
  }

  return (
    <ConvexShell>
      <View style={styles.container}>
        <Text>Shared Child Journal</Text>
      </View>
    </ConvexShell>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
})
