/**
 * Candidate A app shell — sign in as a known member (or not), then live in
 * the conversation surface. The journal store is shared household state; the
 * conversation controller (and its turn log) is per-member, rebuilt per sign-in.
 */
import { useState } from "react"
import { StyleSheet, View } from "react-native"

import { ConversationController } from "./src/conversation/controller"
import { createSeptemberStore } from "./src/fixtures/september"
import { anonymousPrincipal, at as septemberAt, memberPrincipal } from "./src/fixtures/household"
import { SignInScreen } from "./src/ui/SignInScreen"
import { ConversationScreen } from "./src/ui/ConversationScreen"

// One shared journal store for the demo session (synthetic September data).
const { store } = createSeptemberStore()

const DEMO_NOW = septemberAt(16, 20, 0) // Wed Sep 16 2026, 20:00 EDT

interface Session {
  readonly memberId: string
  readonly controller: ConversationController
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)

  if (session === null) {
    return (
      <View style={styles.root}>
        <SignInScreen
          onSignIn={(memberId) => {
            const principal = memberId === "mem_stranger" ? anonymousPrincipal : memberPrincipal(memberId)
            const authorId = memberId === "mem_stranger" ? "mem_stranger" : memberId
            setSession({ memberId, controller: new ConversationController(store, principal, authorId, DEMO_NOW) })
          }}
        />
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <ConversationScreen
        key={session.memberId}
        controller={session.controller}
        displayName={session.memberId === "mem_stranger" ? "nobody (anonymous)" : session.memberId === "mem_dana" ? "Dana" : session.memberId === "mem_gilbert" ? "Gilbert" : "Rosa"}
        onSignOut={() => setSession(null)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F7F5F2" },
})
