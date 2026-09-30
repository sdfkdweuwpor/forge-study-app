import { defineConfig, devices } from '@playwright/test'

// Temporary: screenshots from a private build on a fresh port.
export default defineConfig({
  testDir: './scripts',
  testMatch: 'shoot.spec.ts',
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  outputDir: 'test-results-roadmap',
  use: { baseURL: 'http://localhost:4391', timezoneId: 'America/New_York', locale: 'en-US' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      'VITE_ENABLE_SEED=1 npx vite build --outDir dist-roadmap --emptyOutDir && npx vite preview --outDir dist-roadmap --port 4391 --strictPort',
    url: 'http://localhost:4391',
    reuseExistingServer: false,
    timeout: 240_000,
  },
})
