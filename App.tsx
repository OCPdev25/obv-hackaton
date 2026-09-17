/**
 * App root — Convex provider pointing at the LOCAL dev backend by default
 * (override with EXPO_PUBLIC_CONVEX_URL). No cloud deployment is used in this
 * candidate (labeled absence — see EVIDENCE.md).
 */
import { ConvexProvider, ConvexReactClient } from "convex/react"
import { CaptureScreen } from "./src/app/CaptureScreen"

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210"

export default function App() {
  return (
    <ConvexProvider client={new ConvexReactClient(convexUrl)}>
      <CaptureScreen convexUrl={convexUrl} />
    </ConvexProvider>
  )
}
