import { defineConfig, devices } from '@playwright/test'

// Temporary: a private build and a fresh port so parallel builders never share a server.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  outputDir: 'test-results-roadmap',
  use: {
    baseURL: 'http://localhost:4391',
    timezoneId: 'America/New_York',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'VITE_ENABLE_SEED=1 npx vite build --outDir dist-roadmap --emptyOutDir && npx vite preview --outDir dist-roadmap --port 4391 --strictPort',
    url: 'http://localhost:4391',
    reuseExistingServer: false,
    timeout: 240_000,
  },
})
