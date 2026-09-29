import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

// Node environment on purpose (see DECISIONS: no jsdom). Dexie tests use fake-indexeddb.
export default defineConfig({
  resolve: {
    alias: {
      '@ext': resolve(root, 'extension/src/shared'),
      '@': resolve(root, 'src'),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'extension/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    restoreMocks: true,
  },
})
