import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import { CaptureScreen } from "./screens/CaptureScreen"
import { HomeScreen } from "./screens/HomeScreen"
import { InspectScreen } from "./screens/InspectScreen"
import { MonthScreen } from "./screens/MonthScreen"
import { ReviewDoorwayScreen } from "./screens/ReviewDoorwayScreen"
import { RosaScreen } from "./screens/RosaScreen"
import { C } from "./ui"

/**
 * Candidate C — handoff-first parent home (prototype).
 * Plain state routing: the point under test is the home LENS and the S1 beat
 * reachability, not a navigation library.
 */
type Route =
  | { name: "home" }
  | { name: "capture" }
  | { name: "inspect"; eventId: string }
  | { name: "month" }
  | { name: "review" }
  | { name: "rosa" }

export default function App() {
  const [viewer, setViewer] = useState("marco")
  const [route, setRoute] = useState<Route>({ name: "home" })
  const home = (): void => setRoute({ name: "home" })

  return (
    <View style={styles.app}>
      {route.name !== "home" && (
        <Pressable onPress={home} hitSlop={12}>
          <Text style={styles.back}>‹ Home</Text>
        </Pressable>
      )}
      {route.name === "home" && (
        <HomeScreen
          viewer={viewer}
          onSwitchViewer={setViewer}
          onOpenCapture={() => setRoute({ name: "capture" })}
          onOpenReview={() => setRoute({ name: "review" })}
          onOpenMonth={() => setRoute({ name: "month" })}
          onOpenEvent={(eventId) => setRoute({ name: "inspect", eventId })}
          onOpenRosa={() => setRoute({ name: "rosa" })}
        />
      )}
      {route.name === "capture" && <CaptureScreen onDone={home} />}
      {route.name === "inspect" && <InspectScreen eventId={route.eventId} onDone={home} />}
      {route.name === "month" && <MonthScreen onDone={home} />}
      {route.name === "review" && (
        <ReviewDoorwayScreen
          onOpenEvent={(eventId) => setRoute({ name: "inspect", eventId })}
          onDone={home}
        />
      )}
      {route.name === "rosa" && <RosaScreen onDone={home} />}
    </View>
  )
}

const styles = StyleSheet.create({
  app: { backgroundColor: C.bg, flex: 1, paddingTop: 8 },
  back: { color: C.accent, fontSize: 14, fontWeight: "700", paddingHorizontal: 16, paddingVertical: 6 },
})
