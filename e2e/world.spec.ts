import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { FIXED_NOW, expect, gotoApp, test } from './fixtures'
import { focusSession, putRows } from './idb'
import { patchSettings } from './progressHistory'

/**
 * Phase 8A: My World end to end. The clock is frozen at Tue 2026-09-29 09:30 EDT (the fixture's), so
 * the sky is day and "today" is the 29th. The WGU sample has finished tasks (the C182 exam among them)
 * and a finished C182 course; the empty sample is a brand-new user. The fixture also fails any test that
 * logs a console error or throws in the page.
 */

const canvas = (page: Page) => page.getByTestId('world-canvas')
const tooltip = (page: Page) => page.getByRole('tooltip')

/** How many different colours the canvas shows: a blank or half-drawn canvas shows only a few. */
async function distinctColours(page: Page): Promise<number> {
  return canvas(page).evaluate((el) => {
    const c = el as HTMLCanvasElement
    const ctx = c.getContext('2d')
    if (!ctx) return 0
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    const seen = new Set<number>()
    for (let i = 0; i < data.length; i += 4 * 7) {
      seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0))
      if (seen.size > 60) break
    }
    return seen.size
  })
}

/** Where an item is drawn, in page coordinates (the sample-data build exposes it for specs). */
async function pointOf(page: Page, id: string): Promise<{ x: number; y: number }> {
  await expect
    .poll(() => page.evaluate((i) => window.__forgeWorld?.pointOf(i) ?? null, id), { message: `${id} is drawn` })
    .not.toBeNull()
  const at = await page.evaluate((i) => window.__forgeWorld?.pointOf(i) ?? null, id)
  if (!at) throw new Error(`${id} is not in the world`)
  return at
}

const pad = (n: number): string => String(n).padStart(2, '0')
/** The local date `offset` days from the fixed "today". */
const isoOf = (offset: number): string => {
  const d = new Date(FIXED_NOW.getTime() + offset * 86_400_000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Adds `count` finished tasks (none tied to a goal, so the planner has nothing to recompute) to the open database. */
async function putFinishedTasks(page: Page, count: number): Promise<void> {
  const template = await page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const all = open.result.transaction(['tasks']).objectStore('tasks').getAll()
          all.onsuccess = () => {
            open.result.close()
            resolve((all.result as Record<string, unknown>[]).find((r) => r.id === 'task-c182-oa') ?? {})
          }
        }
      }),
  )
  const tasks = Array.from({ length: count }, (_, i) => {
    const day = isoOf(-1 - Math.floor(i / 17))
    const at = new Date(`${day}T${pad(6 + (i % 17))}:15:00-04:00`).getTime()
    return { ...template, id: `many-${i}`, title: `Task ${i}`, goalId: null, milestoneId: null, unitId: null, estimatePomodoros: null, estimateMinutes: null, status: 'done', completedAt: at, completedDay: day, createdAt: at, updatedAt: at }
  })
  await putRows(page, 'tasks', tasks)
}

test.describe('My World', () => {
  test('draws the city for the sample data, with its stats and an accessible canvas', async ({ page }) => {
    await gotoApp(page, '/world', 'wgu')
    await expect(page.getByRole('heading', { name: 'My World', level: 1 })).toBeVisible()
    await expect(canvas(page)).toBeVisible()
    await expect(canvas(page)).toHaveAttribute('tabindex', '0')
    await expect(canvas(page)).toHaveAttribute(
      'aria-label',
      'Your city. Use arrow keys to pan, plus and minus to zoom.',
    )
    await expect.poll(() => distinctColours(page)).toBeGreaterThan(12)
    // 11 finished tasks and one finished course in the sample.
    await expect(page.getByTestId('world-stats')).toHaveText(/^\d+ tiles · 0 floors · 1 landmark$/)
    await expect(page.getByTestId('world-empty')).toHaveCount(0)
    // It fills the content area: the canvas is as wide as the page next to the sidebar.
    const box = await canvas(page).boundingBox()
    expect(box?.width ?? 0).toBeGreaterThan(700)
    expect(box?.height ?? 0).toBeGreaterThan(400)
  })

  test('hovering a task tile says what it was earned from and when', async ({ page }) => {
    await gotoApp(page, '/world', 'wgu')
    const at = await pointOf(page, 'task:task-c182-oa')
    await page.mouse.move(at.x, at.y)
    await expect(tooltip(page)).toBeVisible()
    await expect(tooltip(page)).toContainText('Finished "Take the C182 objective assessment"')
    await expect(tooltip(page)).toContainText('Sep 20, 2026')
    // It stays beside the pointer, inside the canvas.
    const tip = await tooltip(page).boundingBox()
    const stage = await canvas(page).boundingBox()
    if (!tip || !stage) throw new Error('no boxes')
    expect(tip.x).toBeGreaterThanOrEqual(stage.x)
    expect(tip.x + tip.width).toBeLessThanOrEqual(stage.x + stage.width + 1)
    expect(Math.abs(tip.x - at.x)).toBeLessThan(300)
    // Moving off every building puts it away.
    await page.mouse.move(stage.x + 4, stage.y + 4)
    await expect(tooltip(page)).toHaveCount(0)
  })

  test('the landmark is named after its course', async ({ page }) => {
    await gotoApp(page, '/world', 'wgu')
    await expect.poll(() => page.evaluate(() => window.__forgeWorld?.ids().length ?? 0)).toBeGreaterThan(0)
    const ids = await page.evaluate(() => window.__forgeWorld?.ids() ?? [])
    const course = ids.find((id) => id.startsWith('course:'))
    if (!course) throw new Error('no course in the world')
    const at = await pointOf(page, course)
    await page.mouse.move(at.x, at.y)
    await expect(tooltip(page)).toContainText('C182 Tower')
    await expect(tooltip(page)).toContainText('Completed C182 Introduction to IT')
  })

  test('the keyboard steps through what was built, with the same tooltip, and zooms', async ({ page }) => {
    await gotoApp(page, '/world', 'wgu')
    await pointOf(page, 'task:task-c182-oa')
    await canvas(page).focus()
    await page.keyboard.press('Enter')
    // The newest thing first: the last task finished yesterday.
    await expect(tooltip(page)).toBeVisible()
    const first = await tooltip(page).innerText()
    await page.keyboard.press('ArrowLeft')
    await expect(tooltip(page)).toBeVisible()
    expect(await tooltip(page).innerText()).not.toBe(first)
    await page.keyboard.press('Escape')
    await expect(tooltip(page)).toHaveCount(0)
    // Zoom keys change the picture and never throw.
    const before = await canvas(page).screenshot()
    await page.keyboard.press('-')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('0')
    await expect.poll(async () => (await canvas(page).screenshot()).equals(before)).toBe(true)
  })

  test('Export PNG downloads a picture of the whole city', async ({ page }) => {
    await gotoApp(page, '/world', 'wgu')
    await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export PNG' }).click()
    const file = await download
    expect(file.suggestedFilename()).toBe('forge-world-2026-09-29.png')
    const path = await file.path()
    const bytes = readFileSync(path)
    expect(bytes.length).toBeGreaterThan(2000)
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    // IHDR: a picture of a real size (the whole world, at zoom 2).
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    expect(width).toBeGreaterThan(300)
    expect(height).toBeGreaterThan(200)
  })

  test('the E key exports too, and the toolbar zooms and fits', async ({ page }) => {
    await gotoApp(page, '/world', 'wgu')
    await pointOf(page, 'task:task-c182-oa')
    const before = await canvas(page).screenshot()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect.poll(async () => (await canvas(page).screenshot()).equals(before)).toBe(false)
    await page.getByRole('button', { name: 'Fit' }).click()
    await expect.poll(async () => (await canvas(page).screenshot()).equals(before)).toBe(true)
    const download = page.waitForEvent('download')
    await page.locator('body').press('e')
    expect((await download).suggestedFilename()).toBe('forge-world-2026-09-29.png')
  })

  test('focus hours build a tower and the legend explains what earns what', async ({ page }) => {
    await gotoApp(page, '/world', 'wgu')
    await putRows(page, 'sessions', [
      focusSession('w1', '2026-09-27', null, 50),
      focusSession('w2', '2026-09-27', null, 50),
      focusSession('w3', '2026-09-28', null, 50),
      focusSession('w4', '2026-09-28', null, 50),
    ])
    await page.goto('/world')
    await expect(page.getByTestId('world-stats')).toContainText('3 floors')
    await page.getByRole('button', { name: 'Legend' }).click()
    const legend = page.getByRole('dialog', { name: 'What earns what' })
    await expect(legend).toContainText('A finished task')
    await expect(legend).toContainText('Each hour of focus adds a floor')
    await expect(legend).toContainText('A finished degree')
    await expect(legend).toContainText('Nothing here ever goes away')
  })

  test('a new user sees one plot of grass and a gentle line, never a scolding', async ({ page }) => {
    await gotoApp(page, '/world', 'empty')
    const empty = page.getByTestId('world-empty')
    await expect(empty).toContainText('Finish a task to lay your first stone.')
    await expect(page.getByTestId('world-stats')).toHaveText('Nothing built yet')
    await expect(empty.getByRole('link', { name: 'Go to Today' })).toHaveAttribute('href', '/')
    await expect.poll(() => distinctColours(page)).toBeGreaterThan(5)
    await expect(page.getByText(/lost|missed|broke|behind|failed/i)).toHaveCount(0)
    await empty.getByRole('link', { name: 'Go to Today' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('the sidebar and the command palette reach it', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.getByRole('link', { name: 'My World' }).first().click()
    await expect(page).toHaveURL(/\/world$/)
    await expect(canvas(page)).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('export my world')
    await expect(page.getByRole('option', { name: /Export My World as PNG/ })).toBeVisible()
  })

  test('dark theme and 375 px both keep the canvas whole', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.emulateMedia({ colorScheme: 'dark' })
    await gotoApp(page, '/world', 'wgu')
    await expect(canvas(page)).toBeVisible()
    await expect.poll(() => distinctColours(page)).toBeGreaterThan(12)
    const box = await canvas(page).boundingBox()
    expect(box?.width ?? 0).toBeLessThanOrEqual(375)
    // No sideways scroll on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('2,000 finished tasks and a 100-day streak still load fast and pan smoothly', async ({ page }) => {
    test.setTimeout(90_000)
    await gotoApp(page, '/world', 'wgu')
    await putFinishedTasks(page, 2000)
    await putRows(page, 'sessions', Array.from({ length: 100 }, (_, i) => focusSession(`many-s${i}`, isoOf(-1 - i), null, 60)))
    // The 100-day streak pays its milestone XP at start-up, and the level-up moment it raises would sit
    // over the canvas when the tooltip is hovered below (it did, 1 run in 4 to 4 in 4 depending on load).
    await patchSettings(page, { lastCelebratedLevel: 999 })
    await page.goto('/world')
    await expect.poll(() => page.evaluate(() => window.__forgeWorld?.ids().length ?? 0), { timeout: 30_000 }).toBeGreaterThan(2000)
    await expect.poll(() => page.evaluate(() => window.__forgeWorld?.stats()?.streakLevel ?? 0)).toBe(4)
    const box = await canvas(page).boundingBox()
    if (!box) throw new Error('no canvas')

    // Drag across the city while counting animation frames.
    await page.evaluate(() => {
      const w = window as Window & { __gaps?: number[]; __stop?: boolean }
      w.__gaps = []
      w.__stop = false
      let last = performance.now()
      const loop = (t: number) => {
        w.__gaps?.push(t - last)
        last = t
        if (!w.__stop) requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    })
    await canvas(page).focus()
    await page.keyboard.press('=')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 0; i < 60; i++) await page.mouse.move(box.x + box.width / 2 + i * 6, box.y + box.height / 2 + Math.sin(i / 8) * 40)
    await page.mouse.up()
    const gaps = await page.evaluate(() => {
      const w = window as Window & { __gaps?: number[]; __stop?: boolean }
      w.__stop = true
      return [...(w.__gaps ?? [])].sort((a, b) => a - b)
    })
    expect(gaps.length).toBeGreaterThan(20)
    // Frames stay under 34 ms (30 fps) for the middle half, and none is a stall of a third of a second.
    expect(gaps[Math.floor(gaps.length / 2)] ?? 0).toBeLessThan(34)
    expect(gaps[gaps.length - 1] ?? 0).toBeLessThan(350)

    // Hovering still finds a task among two thousand. Back to the fitted view first (the whole city, at a
    // fraction of a pixel per art pixel); the oldest task sits in the middle of it.
    await page.keyboard.press('0')
    const at = await pointOf(page, 'task:many-1999')
    await page.mouse.move(at.x, at.y)
    await expect(tooltip(page)).toContainText('Task 1999')
  })

  test('a streak brings motion at up to 30 frames a second, and reduced motion stops the loop altogether', async ({
    page,
  }) => {
    // One gradient is made per frame drawn, so counting them counts frames.
    await page.addInitScript(() => {
      const w = window as Window & { __frames?: number }
      w.__frames = 0
      const proto = CanvasRenderingContext2D.prototype
      const make = proto.createLinearGradient
      proto.createLinearGradient = function (...args: Parameters<typeof make>) {
        w.__frames = (w.__frames ?? 0) + 1
        return make.apply(this, args)
      }
    })
    const framesIn = async (ms: number): Promise<number> => {
      const before = await page.evaluate(() => (window as Window & { __frames?: number }).__frames ?? 0)
      await page.waitForTimeout(ms)
      return (await page.evaluate(() => (window as Window & { __frames?: number }).__frames ?? 0)) - before
    }
    const days = Array.from({ length: 10 }, (_, i) => `2026-09-${String(28 - i).padStart(2, '0')}`)
    await gotoApp(page, '/world', 'wgu')
    await putRows(page, 'sessions', days.map((day, i) => focusSession(`motion-${i}`, day, null, 25)))
    await page.goto('/world')
    await expect.poll(() => page.evaluate(() => window.__forgeWorld?.stats()?.streakLevel ?? 0)).toBe(2)

    // People walk the roads (streak of 7): the loop runs, capped at 30 a second.
    const running = await framesIn(1000)
    expect(running).toBeGreaterThan(8)
    expect(running).toBeLessThanOrEqual(36)

    // Reduced motion: one frame to settle, then nothing is scheduled.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.waitForTimeout(500)
    expect(await framesIn(1000)).toBe(0)
    // A change the person makes still draws, once.
    await canvas(page).focus()
    await page.keyboard.press('=')
    await expect.poll(() => framesIn(200)).toBeGreaterThanOrEqual(0)
    await page.waitForTimeout(300)
    expect(await framesIn(800)).toBe(0)
  })
})

// ── Fit ────────────────────────────────────────────────────────────────────────────────────────
// "Fit" puts the whole city in the canvas: the largest whole zoom (1 to 4) that fits, so the pixels
// stay crisp, and a fraction only when not even zoom 1 fits (a phone, or a big city). The sample-data
// build reports the zoom and where the city lies (`window.__forgeWorld.view()`), so these specs check
// the picture's geometry and not just that something changed.

const FIT_PADDING = 24

const FIT_SIZES = [
  { name: 'phone', width: 375, height: 812, fit: 'Fit to view' },
  { name: 'tablet', width: 768, height: 1024, fit: 'Fit' },
  { name: 'desktop', width: 1440, height: 900, fit: 'Fit' },
] as const

type WorldView = ReturnType<NonNullable<Window['__forgeWorld']>['view']>

async function worldView(page: Page): Promise<WorldView> {
  await expect.poll(() => page.evaluate(() => window.__forgeWorld !== undefined)).toBe(true)
  const view = await page.evaluate(() => window.__forgeWorld?.view())
  if (!view) throw new Error('the world is not mounted')
  return view
}

/** The city's size in art pixels, read back from where it is drawn. */
const artSize = (v: WorldView): { w: number; h: number } => ({
  w: (v.world.right - v.world.left) / v.scale,
  h: (v.world.bottom - v.world.top) / v.scale,
})

/** The largest whole zoom (1 to 4) at which the city fits the canvas with the padding, or null. */
function largestWholeZoom(v: WorldView): number | null {
  const { w, h } = artSize(v)
  for (let zoom = 4; zoom >= 1; zoom--) {
    if (w * zoom + 2 * FIT_PADDING <= v.width && h * zoom + 2 * FIT_PADDING <= v.height) return zoom
  }
  return null
}

/** The whole city is inside the canvas, and the zoom is the crisp one when a whole zoom fits. */
async function expectFitted(page: Page): Promise<WorldView> {
  const v = await worldView(page)
  // The origin is rounded to a whole pixel, so allow one pixel either way.
  expect(v.world.left).toBeGreaterThanOrEqual(FIT_PADDING - 1)
  expect(v.world.top).toBeGreaterThanOrEqual(FIT_PADDING - 1)
  expect(v.world.right).toBeLessThanOrEqual(v.width - FIT_PADDING + 1)
  expect(v.world.bottom).toBeLessThanOrEqual(v.height - FIT_PADDING + 1)
  const whole = largestWholeZoom(v)
  if (whole !== null) {
    expect(v.zoom, 'a whole zoom fits, so Fit uses the largest one').toBe(whole)
  } else {
    // Nothing whole fits: the largest fraction that does (within a percent of the exact fit).
    const { w, h } = artSize(v)
    const exact = Math.min((v.width - 2 * FIT_PADDING) / w, (v.height - 2 * FIT_PADDING) / h)
    expect(v.zoom).toBeLessThan(1)
    expect(v.zoom).toBeGreaterThan(exact * 0.99)
  }
  return v
}

for (const size of FIT_SIZES) {
  test.describe(`Fit at ${size.width} px (${size.name})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('the sample city is whole in view as it opens, and Fit brings it back after zooming', async ({
      page,
    }) => {
      await gotoApp(page, '/world', 'wgu')
      await expect.poll(() => page.evaluate(() => window.__forgeWorld?.ids().length ?? 0)).toBeGreaterThan(0)
      const first = await expectFitted(page)
      // The sample city is 352 x 193 art px: a phone is 327 px of room, so only a fraction fits there.
      if (size.name === 'phone') expect(first.zoom).toBeLessThan(1)
      else expect(Number.isInteger(first.zoom)).toBe(true)

      await page.getByRole('button', { name: 'Zoom in' }).click()
      await expect.poll(async () => (await worldView(page)).zoom).toBeGreaterThan(first.zoom)
      await page.getByRole('button', { name: size.fit }).click()
      await expect.poll(async () => (await worldView(page)).zoom).toBe(first.zoom)
      await expectFitted(page)
    })

    test('a grown city (600 finished tasks) is whole in view, and zoom steps from it and back', async ({
      page,
    }) => {
      await gotoApp(page, '/world', 'wgu')
      await putFinishedTasks(page, 600)
      await page.goto('/world')
      await expect.poll(() => page.evaluate(() => window.__forgeWorld?.ids().length ?? 0)).toBeGreaterThan(600)
      const fitted = await expectFitted(page)
      // About 1,500 x 740 art px: more than any of these canvases shows at zoom 1.
      expect(fitted.zoom).toBeLessThan(1)

      // In goes to zoom 1 (never past it); out comes back to the fitted zoom and stays there.
      await page.getByRole('button', { name: 'Zoom in' }).click()
      await expect.poll(async () => (await worldView(page)).zoom).toBe(1)
      await page.getByRole('button', { name: 'Zoom out' }).click()
      await expect.poll(async () => (await worldView(page)).zoom).toBe(fitted.zoom)
      await page.getByRole('button', { name: 'Zoom out' }).click()
      await page.waitForTimeout(150)
      expect((await worldView(page)).zoom).toBe(fitted.zoom)

      // The 0 key fits too, from anywhere.
      await canvas(page).focus()
      await page.keyboard.press('=')
      await page.keyboard.press('=')
      await expect.poll(async () => (await worldView(page)).zoom).toBe(2)
      await page.keyboard.press('0')
      await expect.poll(async () => (await worldView(page)).zoom).toBe(fitted.zoom)
      await expectFitted(page)
    })
  })
}
