import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts: the unit tests exercise pure
// logic (gradients, parameter mapping, repositories) and must not pay for the
// PWA plugin or the React refresh transform.
export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
