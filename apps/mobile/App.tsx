import { ConvexProvider, ConvexReactClient } from "convex/react"
import { useCallback, useMemo, useState } from "react"
import { Pressable, StyleSheet, Text as RNText, View } from "react-native"

import { Text } from "@journal/ui"

import DeviceProofScreen from "./src/device-proof/DeviceProofScreen"
import { CONVEX_URL_ENV_KEY } from "./src/lib/convex"

type Screen = "home" | "device-proof"

export default function App() {
  const [screen, setScreen] = useState<Screen>("home")

  // The Convex client needs EXPO_PUBLIC_CONVEX_URL; when it is unset the app
  // must still boot so the DeviceProof harness can run on the fake transport.
  const convexUrl = useMemo(() => {
    const raw = process.env[CONVEX_URL_ENV_KEY]?.trim()
    return raw === undefined || raw === "" ? null : raw
  }, [])
  const client = useMemo(() => (convexUrl === null ? null : new ConvexReactClient(convexUrl)), [convexUrl])

  const openDeviceProof = useCallback(() => setScreen("device-proof"), [])
  const backToHome = useCallback(() => setScreen("home"), [])

  const content =
    screen === "device-proof" ? (
      <DeviceProofScreen onBack={backToHome} />
    ) : (
      <View style={styles.home}>
        <Text>Shared Child Journal</Text>
        <RNText style={styles.note}>
          {convexUrl === null
            ? `${CONVEX_URL_ENV_KEY} is not set — the device-proof harness runs on the fake transport.`
            : "Open the debug harness to exercise the device-proof checklist."}
        </RNText>
        <Pressable style={styles.button} onPress={openDeviceProof}>
          <RNText style={styles.buttonText}>Device proof checklist</RNText>
        </Pressable>
      </View>
    )

  if (client === null) {
    return <View style={styles.container}>{content}</View>
  }
  return (
    <ConvexProvider client={client}>
      <View style={styles.container}>{content}</View>
    </ConvexProvider>
  )
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: "#0969da",
    borderRadius: 6,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  container: {
    flex: 1,
  },
  home: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  note: {
    color: "#57606a",
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
})
