import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Deterministic, device-free: no jsdom, no timers, no network.
    environment: 'node',
  },
})
