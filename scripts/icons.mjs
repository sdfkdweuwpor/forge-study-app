/**
 * Draws the app's PNG icons from `public/favicon.svg` with Playwright's Chromium (DECISIONS: no
 * `sharp`). Run `npm run icons` after the mark changes and commit the PNGs.
 *
 * - `notify-192`: the icon of browser notifications (they do not draw SVG).
 * - `pwa-192`, `pwa-512`: the manifest's `any` icons (the rounded tile on a transparent square).
 * - `maskable-512`: full-bleed tile colour with the mark pulled in (padding 0.08 per side), so the
 *   launcher's mask (a circle of 80 % of the width at its tightest) never crops it.
 * - `apple-touch-icon-180`: iOS fills transparency with black and rounds the corners itself, so it is
 *   an opaque square with the tile drawn edge to edge.
 * - `monochrome-512`: the mark alone in black on transparent, for Android's themed icons (the system
 *   tints the alpha channel).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

/** The logo tile colour (`--logo-tile` in tokens.css and the `<rect>` fills in favicon.svg). */
const TILE = '#111111'

/**
 * `size` is the square edge in px. `padding` is the share of it left empty on each side of the
 * drawing. `background` fills the square behind it; leave it out for a transparent one. `mark: true`
 * draws only the two white shapes of the mark (no tile), in `markColor`.
 *
 * @type {ReadonlyArray<{ file: string, size: number, padding: number, background?: string, mark?: boolean, markColor?: string }>}
 */
const ICONS = [
  { file: 'public/icons/notify-192.png', size: 192, padding: 0 },
  { file: 'public/icons/pwa-192.png', size: 192, padding: 0 },
  { file: 'public/icons/pwa-512.png', size: 512, padding: 0 },
  { file: 'public/icons/maskable-512.png', size: 512, padding: 0.08, background: TILE },
  { file: 'public/icons/apple-touch-icon-180.png', size: 180, padding: 0, background: TILE },
  {
    file: 'public/icons/monochrome-512.png',
    size: 512,
    padding: 0.08,
    mark: true,
    markColor: '#000000',
  },
]

const root = new URL('../', import.meta.url)
const svg = await readFile(new URL('public/favicon.svg', root), 'utf8')

/** The mark alone: the favicon's white `<path>` shapes, recoloured. */
function markOnly(color) {
  const paths = [...svg.matchAll(/<path\b[^>]*\/>/g)].map((m) =>
    m[0].replace(/fill="[^"]*"/, `fill="${color}"`),
  )
  if (paths.length === 0)
    throw new Error('favicon.svg has no <path> elements to draw the mark from')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${paths.join('')}</svg>`
}

const browser = await chromium.launch()
try {
  // A light colour scheme, so the tile is drawn without the dark-mode ring.
  const context = await browser.newContext({ colorScheme: 'light', deviceScaleFactor: 1 })
  const page = await context.newPage()
  for (const { file, size, padding, background, mark, markColor } of ICONS) {
    const inset = Math.round(size * padding)
    const inner = size - inset * 2
    const source = mark ? markOnly(markColor ?? '#000000') : svg
    const markup = source.replace(
      '<svg ',
      `<svg style="width:${inner}px;height:${inner}px;display:block" `,
    )
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${background ?? 'transparent'}}` +
        `body{width:${size}px;height:${size}px;display:grid;place-items:center}</style>${markup}`,
    )
    const png = await page.screenshot({ omitBackground: background === undefined, type: 'png' })
    await writeFile(fileURLToPath(new URL(file, root)), png)
    process.stdout.write(`wrote ${file} (${size}x${size})\n`)
  }
} finally {
  await browser.close()
}
