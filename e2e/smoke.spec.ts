import type { Page } from '@playwright/test'
import type { RouteName } from '../src/app/router/routes'
import { expect, gotoApp, test } from './fixtures'

/**
 * Phase 1D smoke suite: every route renders, nothing logs errors (fixtures fail the test on any
 * console.error / pageerror), theme switching persists, the shell adapts at 375, 768 and 1440, the
 * `g` sequences navigate, and no route scrolls horizontally on a phone. Phase 1 review additions:
 * the tablet drawer, back/forward, focus and announcements after navigation, sidebar focus hand-off,
 * accent / reduced-motion boot mirrors and the lazy-chunk recovery screen.
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
  roadmap: ['/roadmap'],
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
const TABLET = { width: 768, height: 1024 }
const PHONE = { width: 375, height: 812 }

// The Main nav exists twice in the codebase (desktop sidebar, mobile tab bar); these tell them apart.
const sidebarSearch = (page: Page) => page.getByRole('button', { name: 'Search and commands' })
const sidebarBrand = (page: Page) => page.getByRole('link', { name: 'Forge, go to Today' })
const quickAddFab = (page: Page) => page.getByRole('button', { name: 'Quick add task' })
const openSidebarButton = (page: Page) => page.getByRole('button', { name: 'Open sidebar' })
const collapseSidebarButton = (page: Page) => page.getByRole('button', { name: 'Collapse sidebar' })
const drawer = (page: Page) => page.getByRole('dialog', { name: 'Navigation' })
const moreSheet = (page: Page) => page.getByRole('dialog', { name: 'More' })
/** The visually hidden live region that announces each new page. */
const announcer = (page: Page) => page.locator('[data-route-announcer]')
/** The page heading that receives focus after navigation. */
const pageHeading = (page: Page) => page.locator('main h1').first()
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

/** Writes `appearance` fields straight into the settings row; call `page.reload()` afterwards to pick them up. */
async function setAppearance(
  page: Page,
  patch: { accent?: string; reducedMotion?: 'system' | 'on' | 'off' },
): Promise<void> {
  await page.evaluate(
    (fields) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const idb = open.result
          const tx = idb.transaction('settings', 'readwrite')
          const store = tx.objectStore('settings')
          const get = store.get('app')
          get.onsuccess = () => {
            const row = get.result as { appearance: Record<string, unknown> }
            Object.assign(row.appearance, fields)
            store.put(row)
          }
          tx.oncomplete = () => {
            idb.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    patch,
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
      // Content inside its own horizontal scroller (the Tabs list on /design) is not page overflow,
      // as long as the scroller itself ends inside the viewport.
      let scrolled = false
      for (let up = el.parentElement; up && up.id !== 'root'; up = up.parentElement) {
        const overflowX = getComputedStyle(up).overflowX
        if (overflowX === 'visible') continue
        if (up.getBoundingClientRect().right <= innerWidth + 1) {
          scrolled = true
          break
        }
      }
      if (scrolled) continue
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

  test('the collapse and open buttons toggle the sidebar too, and hand focus to each other', async ({
    page,
  }) => {
    await gotoApp(page, '/')
    await collapseSidebarButton(page).click()
    await expect(sidebarBrand(page)).toBeHidden()
    await expect(openSidebarButton(page)).toBeFocused()
    await openSidebarButton(page).click()
    await expect(sidebarBrand(page)).toBeVisible()
    await expect(collapseSidebarButton(page)).toBeFocused()
  })

  test('a click on the sidebar edge does not resize it; only a real drag does', async ({
    page,
  }) => {
    await gotoApp(page, '/')
    const handle = page.getByRole('separator', { name: 'Resize sidebar' })
    const widthOf = async () => Number(await handle.getAttribute('aria-valuenow'))
    const stored = () => page.evaluate(() => window.localStorage.getItem('forge:sidebar:width'))
    const start = await widthOf()
    const box = await handle.boundingBox()
    if (!box) throw new Error('resize handle has no box')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2

    await page.mouse.click(x, y)
    await page.mouse.click(x, y, { button: 'right' })
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 2, y) // within the 2px click tolerance
    await page.mouse.up()
    expect(await widthOf()).toBe(start)
    expect(await stored()).toBeNull()

    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 60, y, { steps: 6 })
    await page.mouse.up()
    expect(await widthOf()).toBeGreaterThan(start + 40)
    expect(await stored()).not.toBeNull()
  })

  test('with nothing contributed to it, the Goals row has no empty sub-list', async ({ page }) => {
    await gotoApp(page, '/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: 'Goals', exact: true })).toBeVisible()
    // The goals feature contributes its tree here; with no goals it renders nothing, and the empty
    // list (`:empty`) is not shown.
    await expect(nav.locator('li', { hasText: 'Goals' }).locator('ul')).toBeHidden()
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

// ── 7. Tablet: the navigation drawer ─────────────────────────────────────────────────────────────

test.describe('tablet drawer (768x1024)', () => {
  test.use({ viewport: TABLET })

  test('opens from the header button; Esc closes it and returns focus to the button', async ({
    page,
  }) => {
    await gotoApp(page, '/')
    await expect(drawer(page)).toBeHidden()
    const open = openSidebarButton(page)
    await open.click()
    await expect(drawer(page)).toBeVisible()
    await expect(open).toHaveAttribute('aria-expanded', 'true')
    // Focus moved into the dialog.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null))
      .toBe(true)

    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()
    await expect(open).toHaveAttribute('aria-expanded', 'false')
    await expect(open).toBeFocused()
  })

  test('the scrim and mod+\\ close it too', async ({ page }) => {
    await gotoApp(page, '/')
    await openSidebarButton(page).click()
    await expect(drawer(page)).toBeVisible()
    await page.mouse.click(TABLET.width - 20, 500) // right of the 300px panel: the scrim
    await expect(drawer(page)).toBeHidden()

    await page.keyboard.press('ControlOrMeta+\\')
    await expect(drawer(page)).toBeVisible()
    await page.keyboard.press('ControlOrMeta+\\')
    await expect(drawer(page)).toBeHidden()
  })

  test('a route change closes it, focus lands on the page heading, and back does not reopen it', async ({
    page,
  }) => {
    await gotoApp(page, '/')
    await openSidebarButton(page).click()
    await drawer(page).getByRole('link', { name: 'Goals', exact: true }).click()
    await expect(page).toHaveURL(/\/goals$/)
    await expect(drawer(page)).toBeHidden()
    await expect(pageHeading(page)).toBeFocused()

    // The drawer belonged to "/" and must not come back when history returns there...
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
    await expect(drawer(page)).toBeHidden()
    await expect(openSidebarButton(page)).toHaveAttribute('aria-expanded', 'false')
    // ...nor when it moves forward again.
    await page.goForward()
    await expect(page).toHaveURL(/\/goals$/)
    await expect(drawer(page)).toBeHidden()
  })

  test('opening it, leaving and coming back to the same page finds it closed', async ({ page }) => {
    await gotoApp(page, '/focus')
    await openSidebarButton(page).click()
    await expect(drawer(page)).toBeVisible()
    await drawer(page).getByRole('link', { name: 'Today', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.goBack()
    await expect(page).toHaveURL(/\/focus$/)
    await expect(drawer(page)).toBeHidden()
  })

  test('g sequences do not fire underneath the open drawer', async ({ page }) => {
    await gotoApp(page, '/')
    await openSidebarButton(page).click()
    await expect(drawer(page)).toBeVisible()
    await page.keyboard.press('g')
    await page.keyboard.press('s')
    expect(await pathnameOf(page)).toBe('/')

    // With the drawer closed the same keys work again.
    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()
    await page.keyboard.press('g')
    await page.keyboard.press('s')
    await expect.poll(() => pathnameOf(page)).toBe('/settings')
  })

  test('the skip link and the page behind are inert while it is open', async ({ page }) => {
    await gotoApp(page, '/')
    const skip = page.locator('a[href="#main"]')
    await expect(skip).not.toHaveAttribute('inert', /.*/)
    await openSidebarButton(page).click()
    await expect(drawer(page)).toBeVisible()
    await expect(skip).toHaveAttribute('inert', '')
    const pageIsInert = () =>
      page.locator('main#main').evaluate((el) => el.closest('[inert]') !== null)
    expect(await pageIsInert()).toBe(true)
    await page.keyboard.press('Escape')
    await expect(drawer(page)).toBeHidden()
    expect(await pageIsInert()).toBe(false)
    await expect(skip).not.toHaveAttribute('inert', /.*/)
  })

  test('touch targets are at least 44px', async ({ page }) => {
    await gotoApp(page, '/')
    const height = async (loc: ReturnType<Page['locator']>) =>
      (await loc.boundingBox())?.height ?? 0
    const open = openSidebarButton(page)
    expect((await open.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(44)
    expect(await height(open)).toBeGreaterThanOrEqual(44)

    await open.click()
    const dialog = drawer(page)
    await expect(dialog).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await expect
      .poll(async () => height(dialog.getByRole('link', { name: 'Goals', exact: true })))
      .toBeGreaterThanOrEqual(44)
    expect(
      await height(dialog.getByRole('button', { name: 'Search and commands' })),
    ).toBeGreaterThanOrEqual(44)
    expect(
      await height(dialog.getByRole('link', { name: 'Forge, go to Today' })),
    ).toBeGreaterThanOrEqual(44)
  })
})

// ── 8. Mobile: More sheet state and current-page marking ─────────────────────────────────────────

test.describe('mobile More sheet (375x812)', () => {
  test.use({ viewport: PHONE })

  test('More is marked current while a page from its sheet is showing', async ({ page }) => {
    await gotoApp(page, '/settings')
    const tabBar = page.getByRole('navigation', { name: 'Main' })
    const more = tabBar.getByRole('button', { name: 'More' })
    await expect(more).toHaveAttribute('aria-current', 'true')
    for (const name of ['Today', 'Focus', 'Goals', 'Progress']) {
      await expect(tabBar.getByRole('link', { name })).not.toHaveAttribute('aria-current', 'page')
    }

    await tabBar.getByRole('link', { name: 'Goals' }).click()
    await expect(page).toHaveURL(/\/goals$/)
    await expect(more).not.toHaveAttribute('aria-current', 'true')
    await expect(tabBar.getByRole('link', { name: 'Goals' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('the sheet closes on navigation and does not reopen on back or forward', async ({
    page,
  }) => {
    await gotoApp(page, '/')
    const tabBar = page.getByRole('navigation', { name: 'Main' })
    await tabBar.getByRole('button', { name: 'More' }).click()
    await expect(moreSheet(page)).toBeVisible()
    await moreSheet(page).getByRole('link', { name: 'Settings' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(moreSheet(page)).toBeHidden()
    await expect(pageHeading(page)).toBeFocused()

    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
    await expect(moreSheet(page)).toBeHidden()
    await page.goForward()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(moreSheet(page)).toBeHidden()
  })

  test('Esc closes the sheet and returns focus to the More tab', async ({ page }) => {
    await gotoApp(page, '/')
    const more = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'More' })
    await more.click()
    await expect(moreSheet(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(moreSheet(page)).toBeHidden()
    await expect(more).toBeFocused()
  })

  // The flake behind the test above: on a slow or loaded machine the Today page's chunk arrives after
  // the sheet was opened, its `tasks` shortcut scope landed on top of the sheet's, and the page's own
  // Esc ("clear the selection") answered instead of the sheet's. Holding the chunk back makes it certain.
  test('Esc still closes the sheet when the page under it finishes loading afterwards', async ({
    page,
  }) => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(/\/assets\/TodayPage-[^/]*\.js$/, async (route) => {
      await held
      await route.continue()
    })
    await page.goto('/')
    await page.locator('#root > *').first().waitFor()
    const more = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'More' })
    await more.click()
    await expect(moreSheet(page)).toBeVisible()

    release()
    await expect(pageHeading(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(moreSheet(page)).toBeHidden()
    await expect(more).toBeFocused()
  })
})

// ── 9. History, focus and announcements ──────────────────────────────────────────────────────────

test.describe('navigation and history (1440)', () => {
  test.use({ viewport: DESKTOP })

  test('back and forward restore the URL, title and current-page marking', async ({ page }) => {
    await gotoApp(page, '/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    const link = (name: string) => nav.getByRole('link', { name, exact: true })

    await link('Goals').click()
    await link('Progress').click()
    await expect(page).toHaveURL(/\/progress$/)
    await expect(page).toHaveTitle('Progress · Forge')
    await expect(link('Progress')).toHaveAttribute('aria-current', 'page')

    await page.goBack()
    await expect(page).toHaveURL(/\/goals$/)
    await expect(page).toHaveTitle('Goals · Forge')
    await expect(link('Goals')).toHaveAttribute('aria-current', 'page')
    await expect(link('Progress')).not.toHaveAttribute('aria-current', 'page')

    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
    await expect(page).toHaveTitle('Forge')
    await expect(link('Today')).toHaveAttribute('aria-current', 'page')

    await page.goForward()
    await page.goForward()
    await expect(page).toHaveURL(/\/progress$/)
    await expect(link('Progress')).toHaveAttribute('aria-current', 'page')
    await expect(pageHeading(page)).toBeFocused()
  })

  test('navigating announces the new page and moves focus to its heading; first load does neither', async ({
    page,
  }) => {
    await gotoApp(page, '/goals')
    await settle(page)
    await expect(announcer(page)).toHaveText('')
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Rewards' })
      .click()
    await expect(page).toHaveURL(/\/rewards$/)
    await expect(announcer(page)).toHaveText('Rewards')
    await expect(announcer(page)).toHaveAttribute('aria-live', 'polite')
    await expect(pageHeading(page)).toBeFocused()
    await expect(pageHeading(page)).toHaveAttribute('tabindex', '-1')

    // Keyboard navigation announces too, including the same title twice in a row.
    await page.keyboard.press('g')
    await page.keyboard.press('i')
    await expect(page).toHaveURL(/\/tasks\/inbox$/)
    await expect(announcer(page)).toHaveText('Tasks')
    await page.keyboard.press('g')
    await page.keyboard.press('a')
    await expect(page).toHaveURL(/\/tasks\/all$/)
    await expect(announcer(page)).toHaveText('Tasks')
    await expect(pageHeading(page)).toBeFocused()
  })

  test('a page with params remounts when the param changes', async ({ page }) => {
    await gotoApp(page, '/tasks/inbox')
    await expect(pageHeading(page)).toBeVisible()
    await pageHeading(page).evaluate((el) => el.setAttribute('data-marker', 'inbox-page'))
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Upcoming' })
      .click()
    await expect(page).toHaveURL(/\/tasks\/upcoming$/)
    await expect(pageHeading(page)).toBeVisible()
    await expect(pageHeading(page)).not.toHaveAttribute('data-marker', 'inbox-page')
  })
})

// ── 10. Appearance mirrors ───────────────────────────────────────────────────────────────────────

test.describe('accent and reduced motion (1440)', () => {
  test.use({ viewport: DESKTOP, colorScheme: 'light' })

  test('are applied from settings and mirrored to localStorage for the next load', async ({
    page,
  }) => {
    await gotoApp(page, '/')
    await expect(html(page)).toHaveAttribute('data-accent', 'blue')
    await setAppearance(page, { accent: 'teal', reducedMotion: 'on' })
    await page.reload()
    await expect(html(page)).toHaveAttribute('data-accent', 'teal')
    await expect(html(page)).toHaveAttribute('data-reduced-motion', 'on')
    const mirrors = await page.evaluate(() => ({
      accent: window.localStorage.getItem('forge:accent'),
      motion: window.localStorage.getItem('forge:reduced-motion'),
    }))
    expect(mirrors).toEqual({ accent: 'teal', motion: 'on' })
  })

  test('theme-init.js applies the mirrors before the app has rendered', async ({ page }) => {
    type Snapshot = { theme: string | null; accent: string | null; motion: string | null }
    await page.addInitScript(() => {
      window.localStorage.setItem('forge:theme', 'dark')
      window.localStorage.setItem('forge:accent', 'pink')
      window.localStorage.setItem('forge:reduced-motion', 'on')
      // The first attribute mutation on <html> is theme-init.js (a synchronous script in <head>);
      // the observer callback runs right after it, before any app code.
      const log: Snapshot[] = []
      Object.assign(window, { __attributeLog: log })
      new MutationObserver(() => {
        const root = document.documentElement
        log.push({
          theme: root.getAttribute('data-theme'),
          accent: root.getAttribute('data-accent'),
          motion: root.getAttribute('data-reduced-motion'),
        })
      }).observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-theme', 'data-accent', 'data-reduced-motion'],
      })
    })
    await gotoApp(page, '/')
    const first = await page.evaluate(
      () => (window as unknown as { __attributeLog: Snapshot[] }).__attributeLog[0],
    )
    expect(first).toEqual({ theme: 'dark', accent: 'pink', motion: 'on' })
  })

  test('the theme-color meta follows the resolved theme', async ({ page }) => {
    await gotoApp(page, '/settings')
    const colors = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(
          (m) => m.getAttribute('content') ?? '',
        ),
      )
    const bg = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      )

    await themeSelect(page).selectOption('dark')
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
    const dark = await bg()
    await expect.poll(colors).toEqual([dark, dark])

    await themeSelect(page).selectOption('light')
    await expect(html(page)).toHaveAttribute('data-theme', 'light')
    const light = await bg()
    expect(light).not.toBe(dark)
    await expect.poll(colors).toEqual([light, light])
  })
})

// ── 11. A lazy page that no longer exists on the server ──────────────────────────────────────────

test.describe('lazy chunk gone after a deploy (1440)', () => {
  test.use({
    viewport: DESKTOP,
    ignoreConsoleErrors: ['Failed to load resource', 'Failed to fetch dynamically imported module'],
  })

  test('shows a Reload screen instead of a blank page, reloads once by itself, and the rest keeps working', async ({
    page,
  }) => {
    await gotoApp(page, '/')
    await page.route('**/assets/SettingsPage-*.js', (route) =>
      route.fulfill({ status: 404, body: 'Not found' }),
    )
    const reloaded = page.waitForEvent('load')
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Settings', exact: true })
      .click()
    await reloaded // the one automatic reload
    await expect(
      page.getByRole('heading', { name: 'A new version of Forge is available' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    expect(
      await page.evaluate(() => window.sessionStorage.getItem('forge:chunk-reload-at')),
    ).not.toBeNull()

    // The sidebar and every other page still work.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Goals', exact: true })
      .click()
    await expect(page).toHaveURL(/\/goals$/)
    await expect(page.getByRole('heading', { name: 'Goals' })).toBeVisible()
  })
})

// ── 12. Startup and database failures ────────────────────────────────────────────────────────────

test.describe('startup and database failures (1440)', () => {
  test.use({ viewport: DESKTOP })

  test('another tab upgrading the database gives this tab a Reload screen', async ({ page }) => {
    await gotoApp(page, '/')
    // What a newer build in another tab does: open the same database at a higher version.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('forge', 10_000)
          request.onsuccess = () => {
            request.result.close()
            resolve()
          }
          request.onerror = () => reject(request.error)
        }),
    )
    await expect(
      page.getByRole('heading', { name: 'Forge was updated in another tab' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export my data' })).toHaveCount(0)
  })

  test('a database that cannot be opened shows the recovery screen instead of a blank page', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      indexedDB.open = () => {
        throw new DOMException('Access to storage was denied', 'SecurityError')
      }
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Forge could not start' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export my data' })).toBeVisible()
  })

  test('a database that never answers shows the recovery screen after 10 seconds', async ({
    page,
  }) => {
    test.setTimeout(45_000)
    await page.addInitScript(() => {
      // A request that never fires: what an open blocked by an old tab looks like.
      indexedDB.open = () => new EventTarget() as IDBOpenDBRequest
    })
    await page.goto('/')
    await expect(
      page.getByRole('heading', { name: 'Forge is taking a while to start' }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export my data' })).toBeVisible()
  })
})
