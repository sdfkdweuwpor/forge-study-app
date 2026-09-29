import type { Page } from '@playwright/test'
import type { RouteName } from '../src/app/router/routes'
import { expect, gotoApp, test } from './fixtures'

/**
 * Phase 1D smoke suite: every route renders, nothing logs errors (fixtures fail the test on any
 * console.error / pageerror), theme switching persists, the shell adapts at 375 and 1440, the
 * `g` sequences navigate, and no route scrolls horizontally on a phone.
 */

/**
 * Concrete URLs for every route in PLAN §5.1. Keyed by route name so a new route added to
 * `routes.ts` fails typecheck here until it is covered. Params use ids that do not exist yet, so
 * each page must degrade to its Placeholder / NotFound instead of crashing.
 */
const ROUTE_URLS: Record<RouteName, readonly string[]> = {
  today: ['/'],
  focus: ['/focus'],
  tasks: ['/tasks', '/tasks/inbox', '/tasks/upcoming', '/tasks/all', '/tasks/completed'],
  taskView: ['/tasks/views/view-missing'],
  task: ['/task/task-missing'],
  goals: ['/goals'],
  goalNew: ['/goals/new'],
  goal: ['/goals/goal-missing'],
  course: ['/goals/goal-missing/courses/C182'],
  cardReview: ['/goals/goal-missing/courses/C779/review'],
  world: ['/world'],
  progress: ['/progress'],
  weeklyReview: ['/review', '/review/2026-09-28'],
  rewards: ['/rewards', '/rewards/shop', '/rewards/badges', '/rewards/history'],
  blocker: ['/blocker'],
  settings: ['/settings', '/settings/appearance'],
  trash: ['/trash'],
  ritual: ['/rituals/morning', '/rituals/evening'],
  welcome: ['/welcome'],
  design: ['/design'],
  notFound: ['/definitely/not/a/page'],
}

const ALL_URLS: readonly string[] = Object.values(ROUTE_URLS).flat()

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 375, height: 812 }

// The Main nav exists twice in the codebase (desktop sidebar, mobile tab bar); these tell them apart.
const sidebarSearch = (page: Page) => page.getByRole('button', { name: 'Search and commands' })
const sidebarBrand = (page: Page) => page.getByRole('link', { name: 'Forge, go to Today' })
const quickAddFab = (page: Page) => page.getByRole('button', { name: 'Quick add task' })
const openSidebarButton = (page: Page) => page.getByRole('button', { name: 'Open sidebar' })
const themeSelect = (page: Page) => page.getByLabel('Theme')
const html = (page: Page) => page.locator('html')

async function pathnameOf(page: Page): Promise<string> {
  return new URL(page.url()).pathname
}

/** Waits for web fonts and layout to settle so measurements are taken on the final layout. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())))
}

/** Writes `profile.name` straight into the settings row; call `page.reload()` afterwards to pick it up. */
async function setProfileName(page: Page, name: string): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const idb = open.result
          const tx = idb.transaction('settings', 'readwrite')
          const store = tx.objectStore('settings')
          const get = store.get('app')
          get.onsuccess = () => {
            const row = get.result as { profile: { name: string } }
            row.profile.name = value
            store.put(row)
          }
          tx.oncomplete = () => {
            idb.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    name,
  )
}

/** Right-most edge of the page's scrollable overflow, and the first element that pokes past the viewport. */
async function horizontalOverflow(page: Page): Promise<{
  scrollWidth: number
  innerWidth: number
  offenders: string[]
}> {
  return page.evaluate(() => {
    const innerWidth = window.innerWidth
    const offenders: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('#root *'))) {
      const box = el.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      const style = getComputedStyle(el)
      if (style.position === 'fixed' || style.visibility === 'hidden') continue
      // Text or boxes that end past the viewport are clipped by `body { overflow-x: hidden }`,
      // so scrollWidth alone can miss them.
      if (box.right > innerWidth + 1) {
        const label = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] ?? ''}`
        const text = (el.textContent ?? '').trim().slice(0, 40)
        offenders.push(`${label} right=${Math.round(box.right)} "${text}"`)
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      offenders: offenders.slice(0, 5),
    }
  })
}

// ── 1. Every route renders, with no console errors ───────────────────────────────────────────────

test.describe('routes render (1440)', () => {
  test.use({ viewport: DESKTOP })

  for (const url of ALL_URLS) {
    test(url, async ({ page }) => {
      await gotoApp(page, url)
      await expect(page.locator('main#main')).toBeVisible()
      // Every page (real, Placeholder or NotFound) has exactly one page heading, and never the error screen.
      await expect(page.locator('main h1').first()).toBeVisible()
      await expect(page.getByRole('heading', { name: 'This page hit a problem' })).toHaveCount(0)
      await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0)
      await expect(page).toHaveTitle(/Forge$/)
      // Deep links must not be rewritten to another route.
      expect(await pathnameOf(page)).toBe(url)
    })
  }

  test('an unknown path shows Page not found with a way home', async ({ page }) => {
    await gotoApp(page, '/definitely/not/a/page')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await page.locator('main').getByRole('link', { name: 'Go to Today' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /Good (morning|afternoon|evening)/,
    )
  })
})

// ── 2. No horizontal scroll at 375 on any route ──────────────────────────────────────────────────

test.describe('no horizontal scroll (375)', () => {
  test.use({ viewport: PHONE })

  for (const url of ALL_URLS) {
    test(url, async ({ page }) => {
      await gotoApp(page, url)
      await expect(page.locator('main h1').first()).toBeVisible()
      await settle(page)
      const o = await horizontalOverflow(page)
      expect(
        o.scrollWidth,
        `scrollWidth ${o.scrollWidth} > innerWidth ${o.innerWidth}`,
      ).toBeLessThanOrEqual(o.innerWidth)
      expect(o.offenders, 'elements extend past the right edge of the viewport').toEqual([])
    })
  }

  test('Today still fits on the narrowest supported phone (320)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    await gotoApp(page, '/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await settle(page)
    const o = await horizontalOverflow(page)
    expect(o.scrollWidth).toBeLessThanOrEqual(o.innerWidth)
    expect(o.offenders).toEqual([])
  })

  test('Today greeting wraps inside the viewport, even with a long name', async ({ page }) => {
    await gotoApp(page, '/')
    await setProfileName(page, 'Maximiliano')
    await page.reload()
    const title = page.getByRole('heading', { level: 1 })
    await expect(title).toContainText('Good morning, Maximiliano')
    await settle(page)
    const box = await title.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(PHONE.width)
    // The date drops to its own line instead of squeezing the greeting.
    const greetingBottom = await title
      .locator('span')
      .first()
      .evaluate((el) => el.getBoundingClientRect().bottom)
    const dateBox = await title.locator('time').boundingBox()
    expect(dateBox?.y ?? 0).toBeGreaterThanOrEqual(greetingBottom - 1)
    const o = await horizontalOverflow(page)
    expect(o.scrollWidth).toBeLessThanOrEqual(o.innerWidth)
    expect(o.offenders).toEqual([])
  })
})

// ── 3. Theme switching ───────────────────────────────────────────────────────────────────────────

test.describe('theme', () => {
  test.use({ viewport: DESKTOP, colorScheme: 'light' })

  test('the Settings theme select changes data-theme and it survives a reload', async ({
    page,
  }) => {
    await gotoApp(page, '/settings')
    await expect(html(page)).toHaveAttribute('data-theme', 'light')

    await themeSelect(page).selectOption('dark')
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
    await expect(html(page)).toHaveCSS('color-scheme', /dark/)

    await page.reload()
    // theme-init.js sets the attribute before first paint, so it is already right on load.
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
    await expect(themeSelect(page)).toHaveValue('dark')

    await themeSelect(page).selectOption('light')
    await expect(html(page)).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await expect(html(page)).toHaveAttribute('data-theme', 'light')
    await expect(themeSelect(page)).toHaveValue('light')
  })

  test('System follows the device colour scheme', async ({ page }) => {
    await gotoApp(page, '/settings')
    await themeSelect(page).selectOption('system')
    await expect(html(page)).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(html(page)).toHaveAttribute('data-theme', 'light')
  })
})

// ── 4. Mobile shell: tab bar yes, sidebar no ─────────────────────────────────────────────────────

test.describe('mobile shell (375x812)', () => {
  test.use({ viewport: PHONE })

  test('the bottom tab bar is visible and the sidebar is not', async ({ page }) => {
    await gotoApp(page, '/')
    const tabBar = page.getByRole('navigation', { name: 'Main' })
    await expect(tabBar).toBeVisible()
    for (const name of ['Today', 'Focus', 'Goals', 'Progress']) {
      await expect(tabBar.getByRole('link', { name })).toBeVisible()
    }
    await expect(tabBar.getByRole('button', { name: 'More' })).toBeVisible()
    await expect(tabBar.getByRole('link', { name: 'Today' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    // Pinned to the bottom edge, with tappable (>= 44px) targets.
    const bar = await tabBar.boundingBox()
    expect(bar).not.toBeNull()
    expect(Math.round((bar?.y ?? 0) + (bar?.height ?? 0))).toBe(PHONE.height)
    const tab = await tabBar.getByRole('link', { name: 'Focus' }).boundingBox()
    expect(tab?.height ?? 0).toBeGreaterThanOrEqual(44)

    await expect(quickAddFab(page)).toBeVisible()
    // No sidebar chrome at all on a phone.
    await expect(sidebarSearch(page)).toHaveCount(0)
    await expect(sidebarBrand(page)).toHaveCount(0)
    await expect(openSidebarButton(page)).toHaveCount(0)
  })

  test('the tab bar navigates and More opens the rest of the destinations', async ({ page }) => {
    await gotoApp(page, '/')
    const tabBar = page.getByRole('navigation', { name: 'Main' })
    await tabBar.getByRole('link', { name: 'Goals' }).click()
    await expect(page).toHaveURL(/\/goals$/)
    await expect(tabBar.getByRole('link', { name: 'Goals' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    await tabBar.getByRole('button', { name: 'More' }).click()
    const sheet = page.getByRole('dialog', { name: 'More' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(sheet).toBeHidden()
  })

  test('mod+\\ does nothing on a phone (there is no sidebar to toggle)', async ({ page }) => {
    await gotoApp(page, '/')
    await page.keyboard.press('ControlOrMeta+\\')
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})

// ── 5. Desktop shell: sidebar toggle ─────────────────────────────────────────────────────────────

test.describe('desktop shell (1440x900)', () => {
  test.use({ viewport: DESKTOP })

  test('the sidebar is visible and there is no tab bar', async ({ page }) => {
    await gotoApp(page, '/')
    await expect(sidebarSearch(page)).toBeVisible()
    await expect(sidebarBrand(page)).toBeVisible()
    await expect(quickAddFab(page)).toHaveCount(0)
    await expect(openSidebarButton(page)).toHaveCount(0)
  })

  test('mod+\\ toggles the sidebar and the choice survives a reload', async ({ page }) => {
    await gotoApp(page, '/')
    await expect(sidebarBrand(page)).toBeVisible()

    await page.keyboard.press('ControlOrMeta+\\')
    await expect(sidebarBrand(page)).toBeHidden()
    await expect(openSidebarButton(page)).toBeVisible()

    await page.reload()
    await expect(page.locator('main#main')).toBeVisible()
    await expect(sidebarBrand(page)).toBeHidden()

    await page.keyboard.press('ControlOrMeta+\\')
    await expect(sidebarBrand(page)).toBeVisible()
    await expect(openSidebarButton(page)).toHaveCount(0)
  })

  test('mod+\\ works while a form control has focus', async ({ page }) => {
    await gotoApp(page, '/settings')
    await themeSelect(page).focus()
    await page.keyboard.press('ControlOrMeta+\\')
    await expect(sidebarBrand(page)).toBeHidden()
  })

  test('the collapse and open buttons toggle the sidebar too', async ({ page }) => {
    await gotoApp(page, '/')
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(sidebarBrand(page)).toBeHidden()
    await openSidebarButton(page).click()
    await expect(sidebarBrand(page)).toBeVisible()
  })
})

// ── 6. Keyboard: `g` sequences ───────────────────────────────────────────────────────────────────

test.describe('go-to sequences (1440)', () => {
  test.use({ viewport: DESKTOP })

  test('g then a letter navigates', async ({ page }) => {
    await gotoApp(page, '/')
    const steps: readonly [keys: readonly [string, string], path: string][] = [
      [['g', 's'], '/settings'],
      [['g', 'g'], '/goals'],
      [['g', 'f'], '/focus'],
      [['g', 'i'], '/tasks/inbox'],
      [['g', 'u'], '/tasks/upcoming'],
      [['g', 'a'], '/tasks/all'],
      [['g', 'p'], '/progress'],
      [['g', 'w'], '/world'],
      [['g', 'r'], '/rewards'],
      [['g', 'b'], '/blocker'],
      [['g', 't'], '/'],
    ]
    for (const [[first, second], path] of steps) {
      await page.keyboard.press(first)
      await page.keyboard.press(second)
      await expect.poll(() => pathnameOf(page), { message: `g ${second}` }).toBe(path)
      await expect(page.locator('main h1').first()).toBeVisible()
    }
  })

  test('the sidebar highlights the current destination after a g sequence', async ({ page }) => {
    await gotoApp(page, '/')
    await page.keyboard.press('g')
    await page.keyboard.press('g')
    await expect(page).toHaveURL(/\/goals$/)
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Goals/ }),
    ).toHaveAttribute('aria-current', 'page')
  })

  test('g sequences are ignored while a form control has focus', async ({ page }) => {
    await gotoApp(page, '/settings')
    // Keys typed into inputs, textareas and selects belong to the control, not to go-to (`t` would mean Today).
    await themeSelect(page).focus()
    await page.keyboard.press('g')
    await page.keyboard.press('t')
    expect(await pathnameOf(page)).toBe('/settings')
  })

  test('a lone g expires after one second', async ({ page }) => {
    await gotoApp(page, '/focus')
    await page.keyboard.press('g')
    // Sequences have a 1 s window (PLAN §5.2); wait it out, then the second key is just a key.
    await page.waitForTimeout(1300)
    await page.keyboard.press('s')
    expect(await pathnameOf(page)).toBe('/focus')
    // ...and a fresh sequence still works afterwards.
    await page.keyboard.press('g')
    await page.keyboard.press('s')
    await expect.poll(() => pathnameOf(page)).toBe('/settings')
  })
})
