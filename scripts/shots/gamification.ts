import type { Page } from '@playwright/test'
import { FIXED_NOW } from '../../e2e/fixtures'
import { levelFromLifetimeXp, xpToReachLevel } from '../../src/logic/xp'
import type { ShotList } from '../shot-types'

const MENTOR = 'Email mentor about term plan' // worth +20 XP
const TODAY = '2026-09-29'

/** Every live query has answered: no skeleton or busy region is left on the page. */
async function loaded(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0)
  await page.mouse.move(0, 0)
}

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

/**
 * From the seeded sample data to the moment a task is about to raise the level: waits for the first
 * start to record the level it opened at (no celebration), lifts lifetime XP to 5 XP short of the next
 * level with a raw write, and reloads without `?seed=` so the app starts from there.
 */
async function nearNextLevel(page: Page): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const [settings] = await readTable<{ lastCelebratedLevel: number }>(page, 'settings')
    if ((settings?.lastCelebratedLevel ?? 0) > 0) break
    await page.waitForTimeout(100)
  }
  const events = await readTable<{ amount: number }>(page, 'xpEvents')
  const lifetime = events.reduce((sum, e) => sum + e.amount, 0)
  const { level } = levelFromLifetimeXp(lifetime)
  const gap = xpToReachLevel(level + 1) - lifetime
  await page.evaluate(
    ([amount, day]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['xpEvents'], 'readwrite')
          const now = Date.now()
          tx.objectStore('xpEvents').put({
            id: 'shot-lift',
            createdAt: now,
            updatedAt: now,
            at: now,
            day,
            source: 'adjustment',
            amount,
            key: 'shot:lift',
            refId: null,
            note: null,
          })
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    [gap - 5, TODAY] as const,
  )
  await page.goto('/')
  await page.getByRole('checkbox', { name: `Done: ${MENTOR}` }).waitFor()
  await loaded(page)
}

/**
 * Completes the mentor task so the level rises, then holds the moment mid-animation: the clock is
 * paused as soon as the overlay is up, and run forward to about half a second in. The card and the
 * confetti are pure functions of the clock, so the frame is the same every time.
 */
async function levelUpMidAnimation(page: Page): Promise<void> {
  await nearNextLevel(page)
  await page.getByRole('checkbox', { name: `Done: ${MENTOR}` }).click()
  await page.getByTestId('level-up').waitFor()
  await page.clock.pauseAt(new Date(FIXED_NOW.getTime() + 1))
  await page.clock.runFor(480)
}

const shots: ShotList = {
  feature: 'gamification',
  shots: [
    {
      // Desktop and tablet: the meter in the sidebar footer with its tooltip. A phone has no sidebar.
      name: 'level-meter',
      widths: [1440, 375],
      path: '/?seed=wgu',
      prepare: async (page) => {
        await loaded(page)
        const meter = page.getByTestId('level-meter')
        if ((await meter.count()) === 0) return
        await meter.hover()
        await page.getByRole('tooltip').waitFor()
      },
    },
    // Where the sidebar is not: a ring beside the open button with the sidebar collapsed (1440), the last row
    // of the More sheet on a phone (375).
    {
      name: 'level-compact',
      path: '/?seed=wgu',
      prepare: async (page) => {
        await loaded(page)
        const more = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' })
        if ((await more.count()) > 0) {
          await more.click()
          await page.getByTestId('level-row').waitFor()
          await page.waitForTimeout(400)
          return
        }
        await page.keyboard.press('ControlOrMeta+\\')
        await page.getByTestId('level-badge').waitFor()
        await page.waitForTimeout(400)
      },
    },
    {
      name: 'level-up',
      path: '/?seed=wgu',
      prepare: levelUpMidAnimation,
    },
    {
      name: 'level-up-reduced-motion',
      path: '/?seed=wgu',
      prepare: async (page) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await levelUpMidAnimation(page)
      },
    },
  ],
}

export default shots
