import type { Page } from '@playwright/test'
import type { ShotList } from '../shot-types'

/** Every live query has answered: no skeleton or busy region is left on the page. */
async function loaded(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(0, 0)
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  )
}

const LANE = '[data-testid="lane-bar"]'

/** Moves the sample goal's projected finish 9 days after its target (a raw write; reload after). */
async function projectAfterTarget(page: Page): Promise<void> {
  await page.evaluate(
    () =>
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
            end.setUTCDate(end.getUTCDate() + 9)
            goal.projection.end = end.toISOString().slice(0, 10)
            goal.projection.slipDays = 9
            store.put(goal)
          }
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
  )
}

// Roadmap. Sample data comes from `?seed=wgu` (dated around the fixed clock, Tue 2026-09-29).
const list: ShotList = {
  feature: 'roadmap',
  shots: [
    { name: 'wgu', path: '/roadmap?seed=wgu', waitFor: LANE, prepare: loaded },
    {
      // Projected after the target: the hatched span and the sentence.
      name: 'after-target',
      path: '/roadmap?seed=wgu',
      waitFor: LANE,
      prepare: async (page) => {
        await projectAfterTarget(page)
        await page.goto('/roadmap')
        await page.locator(LANE).waitFor()
        await loaded(page)
      },
    },
    {
      name: 'three-months',
      path: '/roadmap?seed=wgu',
      waitFor: LANE,
      prepare: async (page) => {
        await page.getByRole('radio', { name: '3 months' }).click()
        await loaded(page)
      },
    },
    {
      name: 'tooltip',
      path: '/roadmap?seed=wgu',
      waitFor: LANE,
      prepare: async (page) => {
        await page.getByTestId('lane-course').filter({ hasText: 'C779' }).hover()
        await page.getByRole('tooltip').waitFor()
      },
    },
    { name: 'empty', path: '/roadmap?seed=empty', waitFor: 'main h1', prepare: loaded },
  ],
}

export default list
