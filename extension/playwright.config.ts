import { defineConfig } from '@playwright/test'

// Runs only e2e/extension.spec.ts, without the app's webServer (the spec builds extension/dist itself
// and serves its own localhost page): `npx playwright test --config extension/playwright.config.ts`.
// `npm run e2e` runs the same spec as part of the full suite.
export default defineConfig({
  testDir: '../e2e',
  testMatch: 'extension.spec.ts',
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: '../test-results',
})
