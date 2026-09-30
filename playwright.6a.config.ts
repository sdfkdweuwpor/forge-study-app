import { defineConfig, devices } from '@playwright/test'

// Temporary: an isolated build and port for 6A, because other builders share dist/ and 4173.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 3,
  reporter: [['list']],
  outputDir: 'test-results-6a',
  use: { baseURL: 'http://localhost:4196', timezoneId: 'America/New_York', locale: 'en-US' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'VITE_ENABLE_SEED=1 npx vite build --outDir dist-6a --emptyOutDir && npx vite preview --outDir dist-6a --port 4196 --strictPort',
    url: 'http://localhost:4196',
    reuseExistingServer: false,
    timeout: 240_000,
  },
})
