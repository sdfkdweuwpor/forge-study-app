import type { Locator, Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Phase 2E: the /design page shows every component in a light and a dark column, has a working
 * table of contents and preview settings, logs no console errors (the fixtures fail the test on
 * any), and never scrolls sideways on a phone. Also checks that the app-wide toast region exists.
 */

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 375, height: 812 }

/** The 21 components of BRIEF §3.6, as the section ids the page must render. */
const REQUIRED_SECTIONS = [
  'button',
  'icon-button',
  'input',
  'textarea',
  'checkbox',
  'tag',
  'dropdown',
  'popover',
  'tooltip',
  'modal',
  'toast',
  'progress-bar',
  'progress-ring',
  'tabs',
  'segmented-control',
  'toggle',
  'date-picker',
  'empty-state',
  'skeleton',
  'kbd',
  'command-palette',
] as const

/** Every component section (not the group headings, which have no id). */
const sections = (page: Page): Locator => page.locator('section[id][aria-labelledby$="-title"]')
const toc = (page: Page): Locator => page.getByRole('navigation', { name: 'Components' })
/** The themed surface a demo renders in (demos may set data-theme on their own specimens, so match ours). */
const column = (page: Page, scheme: 'light' | 'dark'): Locator =>
  page.locator(`section[id] [data-column="${scheme}"]`)
const allColumns = (page: Page): Locator => page.locator('section[id] [data-column]')
const toolbar = (page: Page): Locator => page.getByRole('group', { name: 'Preview settings' })

/** Opens /design and waits for the (eagerly rendered) sections, so counts taken next are final. */
async function openDesign(page: Page, hash = ''): Promise<void> {
  await gotoApp(page, `/design${hash}`)
  await expect(sections(page).first()).toBeVisible()
}

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
      // Inside its own horizontal scroller (the Tabs list) is not page overflow.
      let scrolled = false
      for (let up = el.parentElement; up && up.id !== 'root'; up = up.parentElement) {
        if (getComputedStyle(up).overflowX === 'visible') continue
        if (up.getBoundingClientRect().right <= innerWidth + 1) {
          scrolled = true
          break
        }
      }
      if (scrolled) continue
      if (box.right > innerWidth + 1) {
        const label = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] ?? ''}`
        offenders.push(
          `${label} right=${Math.round(box.right)} "${(el.textContent ?? '').trim().slice(0, 40)}"`,
        )
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      offenders: offenders.slice(0, 5),
    }
  })
}

test.describe('/design (1440)', () => {
  test.use({ viewport: DESKTOP })

  test('renders every component section in a light and a dark column', async ({ page }) => {
    await gotoApp(page, '/design')
    await expect(page.getByRole('heading', { level: 1, name: 'Design system' })).toBeVisible()

    expect(await sections(page).count()).toBeGreaterThanOrEqual(21)
    // One browser round trip for the ~25 sections x 4 checks: as ~100 separate expectations this outlasted
    // the 30 s test timeout when four workers rendered this heavy page at once (it failed at HEAD too).
    const problems = await page.evaluate((ids) => {
      const found: string[] = []
      const count = (root: ParentNode, selector: string): number =>
        root.querySelectorAll(selector).length
      for (const id of ids) {
        const matches = document.querySelectorAll(`section#${id}`)
        if (matches.length !== 1) {
          found.push(`section #${id}: ${matches.length} found`)
          continue
        }
        const section = matches[0] as HTMLElement
        if (count(section, ':scope > header > h3') !== 1) found.push(`#${id} has no title`)
        if (count(section, '[data-column="light"]') !== 1) found.push(`#${id} light column`)
        if (count(section, '[data-column="dark"]') !== 1) found.push(`#${id} dark column`)
      }
      return found
    }, [...REQUIRED_SECTIONS])
    expect(problems).toEqual([])
    await expect(
      page.getByRole('alert').filter({ hasText: 'Some demos were skipped' }),
    ).toHaveCount(0)
  })

  test('groups run Primitives, Overlays, Composites and each section id is unique', async ({
    page,
  }) => {
    await openDesign(page)
    const headings = await page.locator('main h2[id^="group-"]').allTextContents()
    expect(headings).toEqual(['Primitives', 'Overlays', 'Composites'])
    const ids = await sections(page).evaluateAll((els) => els.map((el) => el.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('the light and dark columns paint different surfaces', async ({ page }) => {
    await gotoApp(page, '/design')
    const surface = (column: Locator) =>
      column.first().evaluate((el) => {
        const style = getComputedStyle(el)
        return { background: style.backgroundColor, color: style.color }
      })
    const light = await surface(column(page, 'light'))
    const dark = await surface(column(page, 'dark'))
    expect(light.background).not.toEqual(dark.background)
    expect(light.color).not.toEqual(dark.color)
  })

  test('the table of contents lists every section and jumps to it', async ({ page }) => {
    await gotoApp(page, '/design')
    await expect(toc(page)).toBeVisible()
    for (const id of REQUIRED_SECTIONS) {
      await expect(toc(page).locator(`a[href="#${id}"]`), `link to #${id}`).toHaveCount(1)
    }

    await toc(page).locator('a[href="#modal"]').click()
    await expect(page).toHaveURL(/\/design#modal$/)
    await expect(page.locator('section#modal')).toBeInViewport()
    await expect(toc(page).locator('a[href="#modal"]')).toHaveAttribute('aria-current', 'location')
  })

  test('a deep link to a section scrolls to it', async ({ page }) => {
    await gotoApp(page, '/design#command-palette')
    await expect(page.locator('section#command-palette')).toBeInViewport()
  })

  test('the toolbar and the table of contents stay in view while scrolling', async ({ page }) => {
    await openDesign(page)
    await page.locator('section#toast').scrollIntoViewIfNeeded()
    await page.mouse.wheel(0, 600)
    await expect(toolbar(page)).toBeInViewport()
    expect((await toolbar(page).boundingBox())?.y ?? 99).toBeLessThan(2)
    await expect(toc(page)).toBeInViewport()
  })

  test('the theme switch shows both, only light or only dark', async ({ page }) => {
    await openDesign(page)
    const count = await sections(page).count()
    const theme = toolbar(page).getByRole('radiogroup', { name: 'Theme' })
    await expect(column(page, 'light')).toHaveCount(count)
    await expect(column(page, 'dark')).toHaveCount(count)

    await theme.getByRole('radio', { name: 'Light' }).click()
    await expect(column(page, 'light')).toHaveCount(count)
    await expect(column(page, 'dark')).toHaveCount(0)

    await theme.getByRole('radio', { name: 'Dark' }).click()
    await expect(column(page, 'light')).toHaveCount(0)
    await expect(column(page, 'dark')).toHaveCount(count)

    await theme.getByRole('radio', { name: 'Both' }).click()
    await expect(column(page, 'light')).toHaveCount(count)
    await expect(column(page, 'dark')).toHaveCount(count)
  })

  test('the accent selector offers six presets and applies to every column', async ({ page }) => {
    await openDesign(page)
    const accents = toolbar(page).getByRole('radiogroup', { name: 'Accent' })
    await expect(accents.getByRole('radio')).toHaveCount(6)
    await accents.getByRole('radio', { name: 'Pink' }).check({ force: true })
    const total = await allColumns(page).count()
    await expect(page.locator('section[id] [data-column][data-accent="pink"]')).toHaveCount(total)
    // The accent token really changed inside the columns, not only the attribute.
    const primary = page.locator('section#button [data-column="light"] button').first()
    const before = await primary.evaluate((el) => getComputedStyle(el).backgroundColor)
    await accents.getByRole('radio', { name: 'Green' }).check({ force: true })
    const after = await primary.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(after).not.toEqual(before)
  })

  test('the reduced-motion toggle applies to every column', async ({ page }) => {
    await openDesign(page)
    const motion = toolbar(page).getByRole('switch', { name: 'Reduce motion' })
    const total = await allColumns(page).count()
    await expect(motion).not.toBeChecked()
    await expect(page.locator('section[id] [data-column][data-reduced-motion="off"]')).toHaveCount(
      total,
    )
    await motion.click()
    await expect(motion).toBeChecked()
    await expect(page.locator('section[id] [data-column][data-reduced-motion="on"]')).toHaveCount(
      total,
    )
  })

  test('a demo is interactive inside its column (toast)', async ({ page }) => {
    await gotoApp(page, '/design')
    const light = page.locator('section#toast [data-column="light"]')
    await light.getByRole('button', { name: 'Success', exact: true }).click()
    await expect(
      light.getByRole('region', { name: 'Notifications' }).getByText('Goal created'),
    ).toBeVisible()
  })

  test('a modal opened in the dark column is dark', async ({ page }) => {
    await gotoApp(page, '/design')
    await page
      .locator('section#modal [data-column="dark"]')
      .getByRole('button', { name: 'Small: confirm' })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const scope = dialog.locator('xpath=ancestor-or-self::*[@data-theme][1]')
    await expect(scope).toHaveAttribute('data-theme', 'dark')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })
})

test.describe('/design (375)', () => {
  test.use({ viewport: PHONE })

  test('does not scroll horizontally, and the columns stack', async ({ page }) => {
    await openDesign(page)
    const o = await horizontalOverflow(page)
    expect(
      o.scrollWidth,
      `scrollWidth ${o.scrollWidth} > innerWidth ${o.innerWidth}`,
    ).toBeLessThanOrEqual(o.innerWidth)
    expect(o.offenders, 'elements extend past the right edge of the viewport').toEqual([])

    const light = await page.locator('section#button [data-column="light"]').boundingBox()
    const dark = await page.locator('section#button [data-column="dark"]').boundingBox()
    expect(dark?.y ?? 0).toBeGreaterThan((light?.y ?? 0) + (light?.height ?? 0) - 1)
  })

  test('the Jump to bar opens the list, follows the reader and closes after a choice', async ({
    page,
  }) => {
    await gotoApp(page, '/design')
    const jump = toc(page).getByRole('button', { name: /Jump to/ })
    await expect(jump).toHaveAttribute('aria-expanded', 'false')
    await expect(toc(page).locator('a[href="#toast"]')).toBeHidden()

    await jump.click()
    await expect(jump).toHaveAttribute('aria-expanded', 'true')
    await toc(page).locator('a[href="#toast"]').click()
    await expect(jump).toHaveAttribute('aria-expanded', 'false')
    await expect(page).toHaveURL(/\/design#toast$/)
    await expect(page.locator('section#toast')).toBeInViewport()
    // Still pinned to the top after scrolling, and it names the section being read.
    expect((await toc(page).boundingBox())?.y ?? 99).toBeLessThan(2)
    await expect(jump).toContainText('Toast')

    await jump.click()
    await page.keyboard.press('Escape')
    await expect(jump).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('app-wide toasts', () => {
  test.use({ viewport: DESKTOP })

  test('one toast region with live regions exists on every page', async ({ page }) => {
    for (const path of ['/', '/settings']) {
      await gotoApp(page, path)
      // `exact`: the Notifications row in Settings has a region of its own whose name contains the word, and
      // the page now draws it on the first render (its chunk is fetched while the database opens).
      const region = page.getByRole('region', { name: 'Notifications', exact: true })
      await expect(region, `${path} has the toast region`).toHaveCount(1)
      await expect(region.locator('[aria-live="polite"]')).toHaveCount(1)
      await expect(region.locator('[aria-live="assertive"]')).toHaveCount(1)
    }
  })
})
