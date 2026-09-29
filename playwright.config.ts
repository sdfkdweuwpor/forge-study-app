import { defineConfig, devices } from '@playwright/test'

// Chromium comes from PLAYWRIGHT_BROWSERS_PATH (pre-installed, matches @playwright/test 1.56.1).
// Never run `playwright install` in this environment.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:4173',
    timezoneId: 'America/New_York',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Serves the production build with the production CSP/headers (vite preview).
  webServer: {
    // VITE_ENABLE_SEED compiles in `?seed=` support; a deployed build never has it.
    command: 'VITE_ENABLE_SEED=1 npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
