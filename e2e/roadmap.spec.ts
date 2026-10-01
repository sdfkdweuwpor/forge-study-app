import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * The Roadmap (`/roadmap`). Sample data (`?seed=wgu`) is one active goal, "B.S. Computer Science — WGU",
 * with five courses dated around the fixed clock (Tue 2026-09-29) and a projection 9 days ahead of its
 * target.
 */

const GOAL = 'B.S. Computer Science — WGU'
const lane = (page: Page) => page.getByRole('region', { name: `${GOAL} timeline` })
const paletteInput = (page: Page) => page.getByRole('combobox', { name: 'Command palette' })

/** Moves the sample goal's projected finish to `days` after its target date (raw write; reload after). */
async function projectAfterTarget(page: Page, days: number): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['goals'], 'readwrite')
          const store = tx.objectStore('goals')
          const get = store.get('goal-wgu-bscs')
          get.onsuccess = () => {
            const goal = get.result as {
              targetDate: string
              projection: { end: string; slipDays: number }
            }
            const end = new Date(`${goal.targetDate}T12:00:00Z`)
            end.setUTCDate(end.getUTCDate() + n)
            goal.projection.end = end.toISOString().slice(0, 10)
            goal.projection.slipDays = n
            store.put(goal)
          }
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    days,
  )
}

/** Opens the Roadmap at a zoom (the saved choice is device-local), with the sample data. */
async function openAt(page: Page, months: 3 | 6 | 12): Promise<void> {
  await page.addInitScript(
    (m) => window.localStorage.setItem('forge:roadmap:zoom', String(m)),
    months,
  )
  await gotoApp(page, '/roadmap', 'wgu')
}

test.describe('Roadmap', () => {
  test('draws a lane per goal with progress, courses, a today line and the projected finish', async ({
    page,
  }) => {
    await openAt(page, 12)
    await expect(page.getByRole('heading', { level: 1, name: 'Roadmap' })).toBeVisible()
    await expect(lane(page)).toBeVisible()
    await expect(lane(page).getByRole('link', { name: GOAL })).toBeVisible()
    await expect(lane(page).getByRole('progressbar', { name: `${GOAL} progress` })).toBeVisible()
    await expect(lane(page)).toContainText('% complete')
    await expect(lane(page).getByTestId('lane-finish')).toContainText(
      /Projected .* · 9 days before target/,
    )
    await expect(lane(page).getByTestId('lane-bar')).toBeVisible()
    await expect(lane(page).getByTestId('lane-target')).toBeVisible()

    // Course segments carry their codes (at six months the whole plan fits).
    const courses = lane(page).getByTestId('lane-course')
    await expect(courses.filter({ hasText: 'C779' })).toBeVisible()
    await expect(courses.filter({ hasText: 'D278' })).toBeVisible()
    expect(await courses.count()).toBeGreaterThanOrEqual(3)
    // Planned OAs show as markers.
    expect(await lane(page).getByTestId('lane-marker').count()).toBeGreaterThan(0)
  })

  test('hovering or focusing a course shows its dates and hours', async ({ page }) => {
    await gotoApp(page, '/roadmap', 'wgu')
    const c779 = lane(page).getByTestId('lane-course').filter({ hasText: 'C779' })
    await c779.hover()
    const tip = page.getByRole('tooltip')
    await expect(tip).toContainText('C779')
    await expect(tip).toContainText(/ to /)
    await expect(tip).toContainText(/ h,/)
    await page.mouse.move(0, 0)
    await expect(tip).toBeHidden()

    await c779.focus()
    await expect(page.getByRole('tooltip')).toContainText('C779')
  })

  test('a finish after the target is a quiet hatched span and a sentence, never an alarm', async ({
    page,
  }) => {
    await openAt(page, 12)
    await projectAfterTarget(page, 9)
    await gotoApp(page, '/roadmap')
    await expect(lane(page).getByTestId('lane-finish')).toContainText(
      /Projected .* · 9 days after target/,
    )
    await expect(lane(page).getByTestId('lane-overrun')).toBeVisible()
    await expect(lane(page)).not.toContainText(/overdue|late|behind/i)
  })

  test('a target beyond the visible months is noted at the edge', async ({ page }) => {
    await openAt(page, 6)
    await expect(lane(page).getByTestId('lane-target')).toHaveCount(0)
    await expect(lane(page).getByTestId('lane-target-edge')).toHaveAttribute(
      'aria-label',
      /Target Feb 2, 2027/,
    )
  })

  test('zoom switches between 3, 6 and 12 months and is remembered', async ({ page }) => {
    await gotoApp(page, '/roadmap', 'wgu')
    const zoom = page.getByRole('radiogroup', { name: 'Zoom' })
    const month = (name: string) => page.getByText(name, { exact: true })
    await expect(zoom.getByRole('radio', { name: '6 months' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(month('Dec')).toBeVisible()

    await zoom.getByRole('radio', { name: '3 months' }).click()
    await expect(month('Dec')).toHaveCount(0)
    await expect(month('Oct')).toBeVisible()

    await zoom.getByRole('radio', { name: '12 months' }).click()
    await expect(month('Jun')).toBeVisible()

    await page.reload()
    await expect(zoom.getByRole('radio', { name: '12 months' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // `z` cycles: 12 wraps to 3.
    await page.keyboard.press('z')
    await expect(zoom.getByRole('radio', { name: '3 months' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  test('clicking a lane opens the goal', async ({ page }) => {
    await gotoApp(page, '/roadmap', 'wgu')
    await lane(page).getByTestId('lane-bar').click()
    await expect(page).toHaveURL(/\/goals\/goal-wgu-bscs$/)
  })

  test('the sidebar item, g m and the palette all go to the Roadmap', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Roadmap' })
      .click()
    await expect(page).toHaveURL(/\/roadmap$/)

    await gotoApp(page, '/')
    await page.keyboard.press('g')
    await page.keyboard.press('m')
    await expect(page).toHaveURL(/\/roadmap$/)

    await gotoApp(page, '/')
    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('go to roadmap')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/roadmap$/)
  })

  test('with no goals it says so and offers Plan a goal', async ({ page }) => {
    await gotoApp(page, '/roadmap', 'empty')
    await expect(page.getByRole('heading', { name: 'Nothing on the roadmap yet' })).toBeVisible()
    await page.getByRole('button', { name: 'Plan a goal' }).click()
    await expect(page).toHaveURL(/\/goals\/new$/)
  })

  test('on a phone the goals stack and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoApp(page, '/roadmap', 'wgu')
    await expect(lane(page)).toBeVisible()
    await expect(lane(page).getByTestId('lane-bar')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    // The title sits above the mini-timeline rather than beside it.
    const [title, bar] = await Promise.all([
      lane(page).getByRole('link', { name: GOAL }).boundingBox(),
      lane(page).getByTestId('lane-bar').boundingBox(),
    ])
    expect(title && bar && bar.y > title.y).toBe(true)
  })
})
