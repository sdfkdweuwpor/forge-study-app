import { defineConfig, devices } from '@playwright/test'

// `npm run shoot` — screenshots only; see scripts/shoot.spec.ts.
// SHOOT=<feature or feature/shot,…> limits what is shot; SHOOT_PHASE=<name> sets the screenshots/<phase>/ folder.
// E2E_PORT / E2E_OUT give a run its own preview server and build folder, like playwright.config.ts
// (e.g. `E2E_PORT=4521 SHOOT=world npx playwright test --config playwright.shoot.config.ts`).
const port = Number(process.env.E2E_PORT ?? 4173)
const outDir = process.env.E2E_OUT
const isolated = port !== 4173 || outDir !== undefined

export default defineConfig({
  testDir: './scripts',
  testMatch: 'shoot.spec.ts',
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  outputDir: isolated ? `test-results-${port}` : 'test-results',
  use: {
    baseURL: `http://localhost:${port}`,
    timezoneId: 'America/New_York',
    locale: 'en-US',
    // As in e2e: the PWA worker would fetch site icons past `page.route`, and a real 404 fails the shot.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // VITE_ENABLE_SEED compiles in `?seed=` support; a deployed build never has it.
    command: isolated
      ? `VITE_ENABLE_SEED=1 npx vite build --outDir ${outDir ?? `dist-e2e-${port}`} && npx vite preview --outDir ${outDir ?? `dist-e2e-${port}`} --port ${port} --strictPort`
      : 'VITE_ENABLE_SEED=1 npm run build && npm run preview',
    url: `http://localhost:${port}`,
    // An isolated run never reuses a server: a stale preview on that port would show an old build.
    reuseExistingServer: !isolated,
    timeout: 180_000,
  },
})
