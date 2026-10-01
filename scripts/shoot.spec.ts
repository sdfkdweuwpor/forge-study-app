import { readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, TIME_ZONE } from '../e2e/fixtures'
import type { ShotList } from './shot-types'

// Auto-discovers scripts/shots/*.ts (default export: ShotList) so features never edit this file.
const themes = ['light', 'dark'] as const
const viewports = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
] as const

const only = (process.env.SHOOT ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const phase = process.env.SHOOT_PHASE ?? 'current'
const shotsDir = join(import.meta.dirname, 'shots')
const outDir = join(import.meta.dirname, '..', 'screenshots', phase)

const files = readdirSync(shotsDir)
  .filter((f) => f.endsWith('.ts') && !f.startsWith('_'))
  .sort()

const lists: ShotList[] = []
for (const file of files) {
  const mod = (await import(pathToFileURL(join(shotsDir, file)).href)) as { default: ShotList }
  if (only.length === 0 || only.includes(mod.default.feature)) lists.push(mod.default)
}

for (const { feature, shots } of lists) {
  for (const shot of shots) {
    for (const colorScheme of themes) {
      for (const viewport of viewports) {
        test.describe(`${feature}/${shot.name}`, () => {
          test.use({
            colorScheme,
            viewport,
            timezoneId: TIME_ZONE,
            locale: 'en-US',
            // A close-up is taken at 2x so single pixels (a snowflake, a ring) can be judged.
            deviceScaleFactor: shot.element ? 2 : 1,
            ignoreConsoleErrors: shot.ignoreConsoleErrors ?? [],
          })

          test(`${colorScheme} ${viewport.width}`, async ({ page }) => {
            await page.goto(shot.path)
            await page
              .locator(shot.waitFor ?? '#root > *')
              .first()
              .waitFor()
            await page.evaluate(() => document.fonts.ready)
            await page.waitForLoadState('networkidle')
            await shot.prepare?.(page)
            await mkdir(outDir, { recursive: true })
            const file = join(
              outDir,
              `${feature}-${shot.name}-${colorScheme}-${viewport.width}.png`,
            )
            if (shot.element) {
              await page.locator(shot.element).first().screenshot({
                path: file,
                animations: 'disabled',
                caret: 'hide',
              })
            } else {
              await page.screenshot({
                path: file,
                fullPage: shot.fullPage ?? false,
                animations: 'disabled',
                caret: 'hide',
              })
            }
            expect(file).toBeTruthy()
          })
        })
      }
    }
  }
}
