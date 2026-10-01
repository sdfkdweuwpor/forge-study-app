import { expect, type Page } from '@playwright/test'
import type { ShotList } from '../shot-types'

/** Every live query has answered, and finite animations and transitions have ended. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0)
  await page.mouse.move(0, 0)
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  )
}

/** Writes rows straight into an IndexedDB table (live queries do not see it: reload afterwards). */
async function putRows(page: Page, table: string, rows: readonly object[]): Promise<void> {
  await page.evaluate(
    ([name, data]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction([name as string], 'readwrite')
          for (const row of data as object[]) tx.objectStore(name as string).put(row)
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    [table, rows] as const,
  )
}

const at = (iso: string): number => new Date(iso).getTime()

/** Three redemptions in September (one refunded) and two in August, as a busy month would look. */
const REDEMPTIONS = [
  ['r1', 'gaming-1', '30 min gaming', 300, '2026-09-28T20:15:00-04:00', false],
  ['r2', 'coffee-1', 'Coffee out', 500, '2026-09-26T10:40:00-04:00', false],
  ['r3', 'movie-1', 'Movie night', 900, '2026-09-19T21:00:00-04:00', true],
  ['r4', 'takeout-1', 'Order takeout', 1500, '2026-09-05T19:30:00-04:00', false],
  ['r5', 'gaming-1', '30 min gaming', 300, '2026-08-22T21:10:00-04:00', false],
  ['r6', 'coffee-1', 'Coffee out', 500, '2026-08-08T09:45:00-04:00', false],
].map(([id, rewardId, rewardTitle, price, when, refunded]) => ({
  id,
  createdAt: at(when as string),
  updatedAt: at(when as string),
  rewardId,
  rewardTitle,
  price,
  at: at(when as string),
  day: (when as string).slice(0, 10),
  refundedAt: refunded ? at(when as string) + 86_400_000 : null,
}))

/** Points each redemption at the shop's reward of the same title (when there is one), like real ones. */
async function withRewardIds<T extends { rewardTitle: unknown; rewardId: unknown }>(
  page: Page,
  rows: readonly T[],
): Promise<T[]> {
  const rewards = await page.evaluate(
    () =>
      new Promise<{ id: string; title: string }[]>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db.transaction('rewards', 'readonly').objectStore('rewards').getAll()
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            db.close()
            resolve(req.result as { id: string; title: string }[])
          }
        }
      }),
  )
  const byTitle = new Map(rewards.map((r) => [r.title, r.id]))
  return rows.map((row) => ({
    ...row,
    rewardId: byTitle.get(String(row.rewardTitle)) ?? row.rewardId,
  }))
}

/** Enough XP for the first two starters but not for takeout, whatever the sample data holds. */
async function setBalance(page: Page, target: number): Promise<void> {
  const now = at('2026-09-29T09:00:00-04:00')
  await putRows(page, 'xpEvents', [
    {
      id: 'xp-shot-reset',
      createdAt: now,
      updatedAt: now,
      at: now,
      day: '2026-09-29',
      source: 'task',
      amount: target,
      key: 'task:shot',
      refId: null,
      note: null,
    },
  ])
}

/**
 * Opens the shop with a known balance: clear the sample XP, add `target`, reload. Every level counts as
 * already celebrated, so the level-up moment never covers the page.
 */
async function shopWith(page: Page, target: number): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['xpEvents', 'redemptions', 'settings'], 'readwrite')
          tx.objectStore('xpEvents').clear()
          tx.objectStore('redemptions').clear()
          const settings = tx.objectStore('settings')
          const get = settings.get('app')
          get.onsuccess = () => {
            settings.put({ ...(get.result as object), lastCelebratedLevel: 99 })
          }
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
  )
  await setBalance(page, target)
  await page.goto('/rewards')
  await page.getByRole('list', { name: 'Rewards' }).waitFor()
  await settle(page)
}

// Rewards shop (Phase 6B). The clock is fixed at Tue 2026-09-29 09:30; the first visit adds the starters.
const list: ShotList = {
  feature: 'rewards',
  shots: [
    {
      // 1,260 XP: gaming and coffee can be redeemed, takeout is "240 XP to go".
      name: 'shop',
      path: '/rewards?seed=empty',
      waitFor: 'main h1',
      prepare: (page) => shopWith(page, 1260),
    },
    {
      name: 'shop-rich',
      path: '/rewards?seed=empty',
      waitFor: 'main h1',
      prepare: (page) => shopWith(page, 4820),
    },
    {
      name: 'editing',
      path: '/rewards?seed=empty',
      waitFor: 'main h1',
      prepare: async (page) => {
        await shopWith(page, 1260)
        await page.getByRole('button', { name: 'Price of Coffee out: 500. Edit' }).click()
        await page.getByRole('textbox', { name: 'Price of Coffee out' }).fill('650')
        await settle(page)
      },
    },
    {
      name: 'icon-picker',
      path: '/rewards?seed=empty',
      waitFor: 'main h1',
      prepare: async (page) => {
        await shopWith(page, 1260)
        await page.getByRole('button', { name: 'Change icon for Coffee out' }).click()
        await page.getByRole('group', { name: 'Icons' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'new-reward',
      path: '/rewards?seed=empty',
      waitFor: 'main h1',
      fullPage: true,
      prepare: async (page) => {
        await shopWith(page, 1260)
        await page.getByRole('button', { name: 'New reward' }).click()
        await page.getByRole('textbox', { name: 'Reward title' }).fill('Movie night')
        await page.getByRole('textbox', { name: 'Price in XP' }).fill('900')
        await settle(page)
      },
    },
    {
      name: 'confirm',
      path: '/rewards?seed=empty',
      waitFor: 'main h1',
      prepare: async (page) => {
        await shopWith(page, 1260)
        await page.getByRole('button', { name: 'Redeem Coffee out for 500 XP' }).click()
        await page.getByRole('dialog', { name: 'Redeem Coffee out for 500 XP?' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'redeemed',
      path: '/rewards?seed=empty',
      waitFor: 'main h1',
      prepare: async (page) => {
        await shopWith(page, 1260)
        await page.getByRole('button', { name: 'Redeem Coffee out for 500 XP' }).click()
        await page
          .getByRole('dialog', { name: 'Redeem Coffee out for 500 XP?' })
          .getByRole('button', { name: 'Redeem', exact: true })
          .click()
        await page.getByRole('region', { name: 'Notifications' }).getByText('Enjoy it!').waitFor()
        await settle(page)
      },
    },
    {
      name: 'empty',
      path: '/rewards?seed=empty',
      waitFor: 'main h1',
      prepare: async (page) => {
        await shopWith(page, 1260)
        for (const title of ['30 min gaming', 'Coffee out', 'Order takeout']) {
          await page.getByRole('button', { name: `Actions for ${title}` }).click()
          await page
            .getByRole('menu', { name: `Actions for ${title}` })
            .getByRole('menuitem', { name: 'Archive' })
            .click()
        }
        await page.getByRole('heading', { name: 'Add a reward worth working for' }).waitFor()
        // Three "archived" toasts stack up; clear them so the empty state is what shows.
        const dismiss = page
          .getByRole('region', { name: 'Notifications' })
          .getByRole('button', { name: 'Dismiss' })
        await dismiss.evaluateAll((buttons) => buttons.forEach((b) => (b as HTMLElement).click()))
        await expect(dismiss).toHaveCount(0)
        await settle(page)
      },
    },
    {
      name: 'history',
      path: '/rewards?seed=empty',
      waitFor: 'main h1',
      prepare: async (page) => {
        await shopWith(page, 6000)
        await putRows(page, 'redemptions', await withRewardIds(page, REDEMPTIONS))
        await page.goto('/rewards/history')
        await page.getByRole('region', { name: 'September 2026' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'history-empty',
      path: '/rewards/history?seed=empty',
      waitFor: 'main h1',
      prepare: settle,
    },
    {
      name: 'badges',
      path: '/rewards/badges?seed=wgu',
      waitFor: 'main h1',
      prepare: settle,
    },
  ],
}

export default list
