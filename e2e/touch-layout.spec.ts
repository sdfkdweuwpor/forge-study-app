import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/*
 * Phase 13A layout guards for touch screens and narrow board columns: segmented controls stay inside the
 * task peek and page with their 44 px tap floor, keyboard hints take no room on touch, and board card
 * titles wrap around the corner grip and … menu instead of running under them.
 */

const PEEK = '/tasks/inbox?peek=task-email-mentor'
const TASK_PAGE = '/task/task-c779-u3-2'

/** Segmented controls (by label) in a task detail that scroll sideways or end past its right edge. */
async function overflowingGroups(page: Page, variant: 'peek' | 'page'): Promise<string[]> {
  return page.evaluate((v) => {
    const root = document.querySelector<HTMLElement>(`[data-variant="${v}"]`)
    if (!root) return ['(no task detail)']
    const edge = root.getBoundingClientRect().right
    return Array.from(root.querySelectorAll<HTMLElement>('[role="radiogroup"]'))
      .filter((group) => {
        const radios = group.querySelectorAll('[role="radio"]')
        const last = radios[radios.length - 1]
        const pastEdge = last !== undefined && last.getBoundingClientRect().right > edge + 1
        return group.scrollWidth > group.clientWidth + 1 || pastEdge
      })
      .map((group) => group.getAttribute('aria-label') ?? '(unlabelled)')
  }, variant)
}

/** The narrowest option in the task detail's Length control, in px. */
async function narrowestLength(page: Page, variant: 'peek' | 'page'): Promise<number> {
  const length = page
    .locator(`[data-variant="${variant}"]`)
    .getByRole('radiogroup', { name: 'Length' })
  return length.evaluate((group) =>
    Math.min(
      ...Array.from(group.querySelectorAll('[role="radio"]')).map(
        (r) => r.getBoundingClientRect().width,
      ),
    ),
  )
}

/** Keycaps inside controls that still take room on screen (a visually hidden one is 1x1 px). */
async function shownKeycapsInControls(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        ':is(button, a, [role="menuitem"], [role="option"]) kbd',
      ),
    )
      .filter((kbd) => !kbd.parentElement?.closest('kbd'))
      .filter((kbd) => {
        const box = kbd.getBoundingClientRect()
        return box.width > 1 && box.height > 1 && kbd.checkVisibility()
      })
      .map((kbd) => (kbd.textContent ?? '').trim()),
  )
}

async function openDetail(page: Page, path: string, variant: 'peek' | 'page'): Promise<void> {
  await gotoApp(page, path, 'wgu')
  await expect(
    page.locator(`[data-variant="${variant}"]`).getByRole('radiogroup', { name: 'Length' }),
  ).toBeVisible()
}

test.describe('a touch tablet (768 px)', () => {
  test.use({ hasTouch: true, viewport: { width: 768, height: 1024 } })

  test('the task peek keeps every segmented control inside the panel', async ({ page }) => {
    await openDetail(page, PEEK, 'peek')
    await expect.poll(() => overflowingGroups(page, 'peek')).toEqual([])
    // The fit does not come from dropping the tap floor.
    expect(await narrowestLength(page, 'peek')).toBeGreaterThanOrEqual(44)
  })

  test('the task page keeps every segmented control inside the page', async ({ page }) => {
    await openDetail(page, TASK_PAGE, 'page')
    await expect.poll(() => overflowingGroups(page, 'page')).toEqual([])
    expect(await narrowestLength(page, 'page')).toBeGreaterThanOrEqual(44)
  })

  test('shortcut hints inside controls take no room', async ({ page }) => {
    for (const path of ['/', '/tasks/inbox']) {
      await gotoApp(page, path, 'wgu')
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      await expect.poll(() => shownKeycapsInControls(page)).toEqual([])
    }
  })

  test('the planner, calendar and roadmap keyboard hints are hidden', async ({ page }) => {
    await gotoApp(page, '/goals/new', 'wgu')
    const footer = page
      .locator('footer')
      .filter({ has: page.getByRole('button', { name: 'Continue' }) })
    await expect(footer).toBeVisible()
    await expect(footer.locator('kbd').first()).toBeHidden()

    await gotoApp(page, '/tasks/all?layout=calendar', 'wgu')
    await expect(page.getByRole('button', { name: /^Next / })).toBeVisible()
    await expect(page.getByText('move the selected task a day')).toBeHidden()

    await gotoApp(page, '/roadmap', 'wgu')
    const zoom = page.getByRole('radiogroup', { name: 'Zoom' })
    await expect(zoom).toBeVisible()
    await expect(zoom.locator('xpath=..').locator('kbd').first()).toBeHidden()
  })
})

test.describe('a phone (375 px, touch)', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } })

  test('the task page keeps every segmented control on screen', async ({ page }) => {
    await openDetail(page, TASK_PAGE, 'page')
    await expect.poll(() => overflowingGroups(page, 'page')).toEqual([])
  })

  test('shortcut hints inside controls take no room', async ({ page }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await expect.poll(() => shownKeycapsInControls(page)).toEqual([])
  })
})

test.describe('a mouse and keyboard (1440 px)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the calendar and roadmap keep their keyboard hints', async ({ page }) => {
    await gotoApp(page, '/tasks/all?layout=calendar', 'wgu')
    await expect(page.getByText('move the selected task a day')).toBeVisible()

    await gotoApp(page, '/roadmap', 'wgu')
    const zoom = page.getByRole('radiogroup', { name: 'Zoom' })
    await expect(zoom.locator('xpath=..').locator('kbd').first()).toBeVisible()
  })
})

/** Title text lines that run under the card's grip or … menu, per card title. */
async function titlesUnderCorner(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const clashes: string[] = []
    for (const card of Array.from(
      document.querySelectorAll<HTMLElement>('[data-variant="card"]'),
    )) {
      const title = card.querySelector<HTMLElement>('button[aria-label$=". Edit task title"]')
      const grip = card.querySelector<HTMLElement>('button[aria-label^="Move "]')
      const menu = card.querySelector<HTMLElement>('button[aria-label^="Actions for "]')
      if (!title || !grip || !menu) continue
      const corner = grip.getBoundingClientRect()
      const menuBox = menu.getBoundingClientRect()
      const left = Math.min(corner.left, menuBox.left)
      const bottom = Math.max(corner.bottom, menuBox.bottom)
      const range = document.createRange()
      range.selectNodeContents(title)
      for (const line of Array.from(range.getClientRects())) {
        if (line.width === 0) continue
        const beside = line.top < bottom && line.bottom > corner.top
        if (beside && line.right > left) clashes.push(title.getAttribute('aria-label') ?? '')
      }
    }
    return clashes
  })
}

for (const [label, touch] of [
  ['mouse', false],
  ['touch', true],
] as const) {
  test.describe(`board cards at 768 px (${label})`, () => {
    test.use({ hasTouch: touch, viewport: { width: 768, height: 1024 } })

    test('three columns fit, and titles wrap around the grip and … menu', async ({ page }) => {
      await gotoApp(page, '/tasks/all?layout=board', 'wgu')
      const board = page.getByRole('group', { name: 'Board' })
      await expect(board.locator('[data-variant="card"]').first()).toBeVisible()
      expect(await board.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
      await expect.poll(() => titlesUnderCorner(page)).toEqual([])
    })
  })
}
