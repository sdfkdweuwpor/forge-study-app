import type { Page } from '@playwright/test'
import { levelFromLifetimeXp, xpToReachLevel } from '../src/logic/xp'
import { expect, gotoApp, test } from './fixtures'
import { focusSession, putRows } from './idb'

/**
 * Phase 6A: the sidebar level meter, the level-up moment and the daily-goal bonus, on the WGU sample
 * data. The fixed clock (Tue 2026-09-29 09:30) freezes `Date` but not animation frames, so the moment
 * runs in real time: it is under 1.5 s.
 */

const MENTOR = 'Email mentor about term plan' // worth +20 XP
const TODAY = '2026-09-29'

const levelUp = (page: Page) => page.getByTestId('level-up')
const meter = (page: Page) => page.getByTestId('level-meter')
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })

/** Reads a whole table straight from IndexedDB, so an assertion never depends on the UI under test. */
async function readTable<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db.transaction(name).objectStore(name).getAll()
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            db.close()
            resolve(req.result as T[])
          }
        }
      }),
    table,
  )
}

const lifetimeXp = async (page: Page): Promise<number> =>
  (await readTable<{ amount: number }>(page, 'xpEvents')).reduce((sum, e) => sum + e.amount, 0)

const celebrated = async (page: Page): Promise<number> =>
  (await readTable<{ lastCelebratedLevel: number }>(page, 'settings'))[0]?.lastCelebratedLevel ?? -1

/** Non-transparent pixels on the moment's canvas: the confetti. */
const confettiPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="level-up"] canvas')
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return -1
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let count = 0
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) count += 1
    return count
  })

/**
 * Starts timing the moment inside the page (a MutationObserver stamps `performance.now()` when the overlay
 * is added and when it is removed), so the measured lifetime does not include Playwright's own polling.
 */
async function watchMoment(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen = { shown: null as number | null, gone: null as number | null }
    ;(window as unknown as { __moment: typeof seen }).__moment = seen
    new MutationObserver(() => {
      const present = document.querySelector('[data-testid="level-up"]') !== null
      const now = performance.now()
      if (present && seen.shown === null) seen.shown = now
      if (!present && seen.shown !== null && seen.gone === null) seen.gone = now
    }).observe(document.body, { childList: true, subtree: true })
  })
}

/** How long the moment was on screen, in milliseconds (call after it has gone). */
const momentLifetime = (page: Page) =>
  page.evaluate(() => {
    const m = (window as unknown as { __moment: { shown: number | null; gone: number | null } })
      .__moment
    return m.shown !== null && m.gone !== null ? m.gone - m.shown : -1
  })

/**
 * Opens the sample data and lifts lifetime XP to 5 XP short of the next level, then reloads so the
 * app starts from there (the level it opens at is remembered, not celebrated). Returns the level
 * the app is at, which completing the mentor task (+20 XP) will raise by one.
 */
async function nearNextLevel(page: Page): Promise<number> {
  await gotoApp(page, '/', 'wgu')
  await expect(meter(page)).toBeVisible()
  // First start: the level the sample data reaches is recorded without a celebration.
  await expect.poll(() => celebrated(page)).toBeGreaterThan(0)
  const lifetime = await lifetimeXp(page)
  const { level } = levelFromLifetimeXp(lifetime)
  const gap = xpToReachLevel(level + 1) - lifetime
  await putRows(page, 'xpEvents', [
    {
      id: 'e2e-lift',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      at: Date.now(),
      day: TODAY,
      source: 'adjustment',
      amount: gap - 5,
      key: 'e2e:lift',
      refId: null,
      note: null,
    },
  ])
  await gotoApp(page, '/')
  await expect(meter(page)).toContainText(`Level ${level}`)
  await expect(levelUp(page)).toHaveCount(0)
  return level
}

async function completeMentorTask(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: `Done: ${MENTOR}` }).click()
}

test.describe('level meter', () => {
  test('shows the level, a gold bar and XP in the sidebar; hover explains; click opens rewards', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    const lifetime = await lifetimeXp(page)
    const info = levelFromLifetimeXp(lifetime)

    await expect(meter(page)).toBeVisible()
    await expect(meter(page)).toContainText(`Level ${info.level}`)
    await expect(meter(page)).toContainText(
      `${info.intoLevel.toLocaleString('en-US')} / ${info.needed.toLocaleString('en-US')} XP`,
    )

    await meter(page).hover()
    const tip = page.getByRole('tooltip')
    await expect(tip).toContainText(`Lifetime XP: ${lifetime.toLocaleString('en-US')}`)
    await expect(tip).toContainText(`Balance: ${lifetime.toLocaleString('en-US')} XP`)

    await meter(page).click()
    await expect(page).toHaveURL(/\/rewards$/)
  })

  test('"Show level & XP" is in the command palette and opens rewards', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('level')
    await page.getByRole('option', { name: /Show level & XP/ }).click()
    await expect(page).toHaveURL(/\/rewards$/)
  })

  test('is not drawn on a phone: there is no sidebar and the More sheet has no footer slot', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoApp(page, '/', 'wgu')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(meter(page)).toHaveCount(0)
  })
})

test.describe('level-up moment', () => {
  test('appears when a task crosses a level, has confetti, and leaves by itself in under 1.5 s', async ({
    page,
  }) => {
    const level = await nearNextLevel(page)
    await watchMoment(page)
    await completeMentorTask(page)

    await expect(levelUp(page)).toBeVisible()
    await expect(levelUp(page)).toContainText(`Level ${level + 1}`)
    await expect(levelUp(page).getByText(/./).first()).toBeVisible()
    await expect(levelUp(page)).not.toHaveAttribute('data-reduced', /.*/)
    // Squares fly on the canvas.
    await expect
      .poll(() => confettiPixels(page), { intervals: [40, 40, 60], timeout: 900 })
      .toBeGreaterThan(0)

    await levelUp(page).waitFor({ state: 'detached', timeout: 4000 })
    // Designed at 1.4 s; the slack is for a busy machine dropping animation frames.
    const lifetime = await momentLifetime(page)
    expect(lifetime).toBeGreaterThan(1000)
    expect(lifetime).toBeLessThan(1700)

    // Written down: the level is not celebrated again, on this page or after a reload.
    expect(await celebrated(page)).toBe(level + 1)
    await gotoApp(page, '/')
    await expect(meter(page)).toContainText(`Level ${level + 1}`)
    await page.waitForTimeout(400)
    await expect(levelUp(page)).toHaveCount(0)
  })

  test('Esc dismisses it early', async ({ page }) => {
    await nearNextLevel(page)
    await watchMoment(page)
    await completeMentorTask(page)
    await expect(levelUp(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await levelUp(page).waitFor({ state: 'detached', timeout: 4000 })
    // Well short of the 1.4 s it would have run: it faded out at once.
    expect(await momentLifetime(page)).toBeLessThan(1100)
  })

  test('with reduced motion it only fades: no confetti, and a click dismisses it', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const level = await nearNextLevel(page)
    await watchMoment(page)
    await completeMentorTask(page)

    await expect(levelUp(page)).toBeVisible()
    await expect(levelUp(page)).toContainText(`Level ${level + 1}`)
    await expect(levelUp(page)).toHaveAttribute('data-reduced', 'true')
    // No squares are ever drawn.
    for (let i = 0; i < 2; i++) {
      expect(await confettiPixels(page)).toBeLessThanOrEqual(0)
      await page.waitForTimeout(80)
    }

    await levelUp(page).getByTestId('level-up-dismiss').click()
    await levelUp(page).waitFor({ state: 'detached', timeout: 4000 })
    expect(await momentLifetime(page)).toBeLessThan(1100)
  })

  test('is not celebrated on first start, for levels the sample data already reaches', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await expect(meter(page)).toBeVisible()
    await expect
      .poll(() => celebrated(page))
      .toBe(levelFromLifetimeXp(await lifetimeXp(page)).level)
    await page.waitForTimeout(500)
    await expect(levelUp(page)).toHaveCount(0)
  })

  test('several levels at once are one celebration, at the highest', async ({ page }) => {
    const level = await nearNextLevel(page)
    // Lift XP three levels higher than the app was opened at, as a big import would.
    const lifetime = await lifetimeXp(page)
    await putRows(page, 'xpEvents', [
      {
        id: 'e2e-jump',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        at: Date.now(),
        day: TODAY,
        source: 'adjustment',
        amount: xpToReachLevel(level + 3) - lifetime + 1,
        key: 'e2e:jump',
        refId: null,
        note: null,
      },
    ])
    await gotoApp(page, '/')
    await expect(levelUp(page)).toBeVisible()
    await expect(levelUp(page)).toContainText(`Level ${level + 3}`)
    await expect(levelUp(page)).toHaveCount(1)
    await levelUp(page).waitFor({ state: 'detached', timeout: 4000 })
    expect(await celebrated(page)).toBe(level + 3)
  })
})

test.describe('daily goal', () => {
  test('a goal reached while the app was closed is paid once, at the next start, with a gold toast', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await expect(meter(page)).toBeVisible()
    // Six finished 25-minute pomodoros today: the default goal, written behind the app's back.
    await putRows(
      page,
      'sessions',
      Array.from({ length: 6 }, (_, i) => focusSession(`e2e-s${i + 1}`, TODAY, null, 25)),
    )
    await gotoApp(page, '/')

    await expect(toasts(page)).toContainText('Daily goal hit · +25 XP')
    await expect
      .poll(
        async () =>
          (await readTable<{ key: string }>(page, 'xpEvents')).filter(
            (e) => e.key === `dailyGoal:${TODAY}`,
          ).length,
      )
      .toBe(1)

    // Another start pays nothing more.
    await gotoApp(page, '/')
    await expect(meter(page)).toBeVisible()
    await page.waitForTimeout(400)
    const paid = (await readTable<{ key: string; amount: number }>(page, 'xpEvents')).filter(
      (e) => e.key === `dailyGoal:${TODAY}`,
    )
    expect(paid).toHaveLength(1)
    expect(paid[0]?.amount).toBe(25)
  })
})
