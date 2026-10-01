import { defineConfig } from '@playwright/test'

// Runs the two specs that load the extension, without the app's webServer: `extension.spec.ts` builds
// extension/dist itself and serves its own localhost page; `blocker-extension.spec.ts` serves the built
// app from `dist/` (run `npm run build` first, or set E2E_APP_DIST to another build folder).
// `npx playwright test --config extension/playwright.config.ts`. `npm run e2e` runs both as part of the
// full suite.
export default defineConfig({
  testDir: '../e2e',
  testMatch: ['extension.spec.ts', 'blocker-extension.spec.ts'],
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: '../test-results',
})
