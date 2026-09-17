import { ConvexProvider, ConvexReactClient } from "convex/react"
import { useMemo, useState } from "react"
import { Pressable, StyleSheet, View } from "react-native"

import { Text } from "@journal/ui"

import { getConvexClientUrl } from "./src/lib/convex"
import { CareQuestionsDemo } from "./src/questions/CareQuestionsDemo"

export default function App() {
  const client = useMemo(() => new ConvexReactClient(getConvexClientUrl()), [])
  const [screen, setScreen] = useState<"journal" | "questions">("questions")

  return (
    <ConvexProvider client={client}>
      <View style={styles.container}>
        <View style={styles.switchRow}>
          <Pressable
            style={[styles.switchButton, screen === "questions" && styles.switchActive]}
            onPress={() => setScreen("questions")}
          >
            <Text style={screen === "questions" ? styles.switchTextActive : styles.switchText}>Questions</Text>
          </Pressable>
          <Pressable
            style={[styles.switchButton, screen === "journal" && styles.switchActive]}
            onPress={() => setScreen("journal")}
          >
            <Text style={screen === "journal" ? styles.switchTextActive : styles.switchText}>Journal</Text>
          </Pressable>
        </View>
        {screen === "journal" ? <Text>Shared Child Journal</Text> : <CareQuestionsDemo />}
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
  switchRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
    marginTop: 48,
  },
  switchButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#bbb",
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  switchActive: {
    backgroundColor: "#333",
    borderColor: "#333",
  },
  switchText: { color: "#333" },
  switchTextActive: { color: "#fff" },
})
