import { defineConfig, devices } from '@playwright/test'

// `npm run shoot` — screenshots only; see scripts/shoot.spec.ts.
// SHOOT=<feature,…> limits features; SHOOT_PHASE=<name> sets the screenshots/<phase>/ folder.
export default defineConfig({
  testDir: './scripts',
  testMatch: 'shoot.spec.ts',
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:4173',
    timezoneId: 'America/New_York',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // VITE_ENABLE_SEED compiles in `?seed=` support; a deployed build never has it.
    command: 'VITE_ENABLE_SEED=1 npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
