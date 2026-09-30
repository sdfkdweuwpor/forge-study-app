import { defineConfig, devices } from '@playwright/test'
// Temporary: the architect's isolated e2e run (fresh port, never reuses a server). Deleted after use.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  outputDir: '/tmp/claude-0/-home-user-forge-study-app/37c45e23-70d5-52b0-8a01-75a3e8d32e47/scratchpad/test-results',
  use: {
    baseURL: 'http://localhost:4191',
    timezoneId: 'America/New_York',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'VITE_ENABLE_SEED=1 npx vite build --outDir /tmp/claude-0/-home-user-forge-study-app/37c45e23-70d5-52b0-8a01-75a3e8d32e47/scratchpad/dist-e2e --emptyOutDir && npx vite preview --outDir /tmp/claude-0/-home-user-forge-study-app/37c45e23-70d5-52b0-8a01-75a3e8d32e47/scratchpad/dist-e2e --port 4191 --strictPort',
    url: 'http://localhost:4191',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
