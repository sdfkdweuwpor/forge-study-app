import { defineConfig, devices } from '@playwright/test'

// E2E_PORT / E2E_OUT let parallel runs use their own preview server and build folder
// (e.g. `E2E_PORT=4391 E2E_OUT=dist-e2e-4391 npx playwright test e2e/focus.spec.ts`).
const port = Number(process.env.E2E_PORT ?? 4173)
const outDir = process.env.E2E_OUT
const isolated = port !== 4173 || outDir !== undefined

// Chromium comes from PLAYWRIGHT_BROWSERS_PATH (pre-installed, matches @playwright/test 1.56.1).
// Never run `playwright install` in this environment.
export default defineConfig({
  testDir: './e2e',
  // The two specs that load the built extension need their own config (`extension/playwright.config.ts`: one
  // worker, no app web server). Under this one `blocker-extension.spec.ts` fails, and `extension.spec.ts`
  // would rebuild extension/dist while other workers run. `npm run e2e` runs both configs.
  testIgnore: ['**/blocker-extension.spec.ts', '**/extension.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  outputDir: isolated ? `test-results-${port}` : 'test-results',
  use: {
    baseURL: `http://localhost:${port}`,
    timezoneId: 'America/New_York',
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Serves the production build with the production CSP/headers (vite preview).
  webServer: {
    // VITE_ENABLE_SEED compiles in `?seed=` support; a deployed build never has it.
    command: isolated
      ? `VITE_ENABLE_SEED=1 npx vite build --outDir ${outDir ?? `dist-e2e-${port}`} && npx vite preview --outDir ${outDir ?? `dist-e2e-${port}`} --port ${port} --strictPort`
      : 'VITE_ENABLE_SEED=1 npm run build && npm run preview',
    url: `http://localhost:${port}`,
    // An isolated run never reuses a server: a stale preview on that port would test an old build.
    reuseExistingServer: !process.env.CI && !isolated,
    timeout: 180_000,
  },
})
