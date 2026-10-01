/**
 * Draws the extension's toolbar/store PNGs (16, 32, 48, 128) from `extension/icons/icon.svg` with
 * Playwright's Chromium, the same way `scripts/icons.mjs` does for the app. Run it by hand after the
 * mark changes and commit the PNGs: `node scripts/extension-icons.mjs`. `build-extension.mjs` only
 * copies them, because the release workflow has no browser installed.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const SIZES = [16, 32, 48, 128]

const root = new URL('../', import.meta.url)
const svg = await readFile(new URL('extension/icons/icon.svg', root), 'utf8')

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ colorScheme: 'light', deviceScaleFactor: 1 })
  const page = await context.newPage()
  for (const size of SIZES) {
    const markup = svg.replace(
      '<svg ',
      `<svg style="width:${size}px;height:${size}px;display:block" `,
    )
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style>${markup}`,
    )
    const png = await page.screenshot({ omitBackground: true, type: 'png' })
    const file = `extension/icons/${size}.png`
    await writeFile(fileURLToPath(new URL(file, root)), png)
    process.stdout.write(`wrote ${file} (${size}x${size})\n`)
  }
} finally {
  await browser.close()
}
