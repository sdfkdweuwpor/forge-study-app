/**
 * Draws the app's PNG icons from `public/favicon.svg` with Playwright's Chromium (DECISIONS: no
 * `sharp`). Run `npm run icons` after the mark changes and commit the PNGs.
 *
 * Today: `public/icons/notify-192.png`, the icon of browser notifications (they do not draw SVG).
 * Phase 10C adds the PWA sizes (`pwa-192`, `pwa-512`, `maskable-512`) to the `ICONS` list.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

/** `size` is the square edge in px; `padding` is the share of it left empty around the mark (maskable icons need some). */
const ICONS = [{ file: 'public/icons/notify-192.png', size: 192, padding: 0 }]

const root = new URL('../', import.meta.url)
const svg = await readFile(new URL('public/favicon.svg', root), 'utf8')

const browser = await chromium.launch()
try {
  // A light colour scheme, so the tile is drawn without the dark-mode ring.
  const context = await browser.newContext({ colorScheme: 'light', deviceScaleFactor: 1 })
  const page = await context.newPage()
  for (const { file, size, padding } of ICONS) {
    const inset = Math.round(size * padding)
    const inner = size - inset * 2
    const markup = svg.replace('<svg ', `<svg style="width:${inner}px;height:${inner}px;display:block" `)
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}` +
        `body{width:${size}px;height:${size}px;display:grid;place-items:center}</style>${markup}`,
    )
    const png = await page.screenshot({ omitBackground: true, type: 'png' })
    await writeFile(fileURLToPath(new URL(file, root)), png)
    process.stdout.write(`wrote ${file} (${size}x${size})\n`)
  }
} finally {
  await browser.close()
}
