import type { Page } from '@playwright/test'
import type { ShotList } from '../shot-types'

/** Waits for finite animations and transitions to end so the capture is the settled state. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  )
}

/** Every live query has answered: no skeleton or busy region is left on the page. */
async function loaded(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(0, 0)
  await settle(page)
}

const NOW_CARD = '[aria-labelledby="now-title"]'

const DAY_MS = 86_400_000

/**
 * Adds finished focus sessions and qualifying streak days straight to IndexedDB, for a populated stat
 * row and heatmap. (Phase 4 and Phase 7 will write these tables for real.) Dexie's live queries do not
 * see a raw write, so the caller reloads the page afterwards.
 */
async function addFocusHistory(page: Page): Promise<void> {
  await page.evaluate(async (dayMs) => {
    const iso = (offset: number): string => {
      const d = new Date(Date.now() + offset * dayMs)
      const pad = (n: number): string => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }
    // Focused pomodoros per day, oldest to today.
    const perDay: Record<number, number> = {
      [-12]: 2,
      [-10]: 1,
      [-9]: 4,
      [-8]: 3,
      [-6]: 2,
      [-5]: 5,
      [-4]: 3,
      [-3]: 4,
      [-2]: 2,
      [-1]: 6,
      [0]: 3,
    }
    const sessions: Record<string, unknown>[] = []
    for (const [offset, count] of Object.entries(perDay)) {
      for (let i = 0; i < count; i++) {
        const startedAt = Date.now() + Number(offset) * dayMs - (9 - i) * 1_800_000
        sessions.push({
          id: `shot-session-${offset}-${i}`,
          createdAt: startedAt,
          updatedAt: startedAt,
          kind: 'focus',
          mode: 'pomodoro',
          status: 'completed',
          taskId: null,
          goalId: null,
          milestoneId: null,
          day: iso(Number(offset)),
          startedAt,
          endedAt: startedAt + 25 * 60_000,
          plannedMinutes: 25,
          pausedMs: 0,
          pausedAt: null,
          actualMinutes: 25,
          round: i + 1,
          interrupted: false,
          counted: true,
          note: null,
        })
      }
    }
    const streak = [-6, -5, -4, -3, -2, -1, 0].map((offset) => ({
      id: iso(offset),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      day: iso(offset),
      focusMinutes: 100,
      focusSessions: 4,
      pomodoros: 4,
      tasksDone: 2,
      dailyGoalTarget: 6,
      dailyGoalHit: false,
      qualified: true,
      xp: 40,
    }))
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('forge')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction(['sessions', 'streakDays'], 'readwrite')
        for (const s of sessions) tx.objectStore('sessions').put(s)
        for (const d of streak) tx.objectStore('streakDays').put(d)
        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
      }
    })
  }, DAY_MS)
}

// Today (Phase 3E). Sample data comes from `?seed=wgu` (dated around the fixed clock, Tue 2026-09-29).
const list: ShotList = {
  feature: 'today',
  shots: [
    { name: 'wgu', path: '/?seed=wgu', waitFor: NOW_CARD, prepare: loaded },
    // The whole page, to check the groups below the fold.
    { name: 'wgu-full', path: '/?seed=wgu', waitFor: NOW_CARD, prepare: loaded, fullPage: true },
    {
      // A busy day: a running streak, three pomodoros, a finished task with its XP, the group open.
      name: 'wgu-active',
      path: '/?seed=wgu',
      waitFor: NOW_CARD,
      prepare: async (page) => {
        await addFocusHistory(page)
        await page.goto('/')
        await page.locator(NOW_CARD).waitFor()
        await page.getByRole('checkbox', { name: /Mark done: Email mentor/ }).click()
        await page.getByRole('button', { name: /Completed today/ }).waitFor()
        await page.getByRole('button', { name: /Completed today/ }).click()
        await loaded(page)
      },
    },
    { name: 'empty', path: '/?seed=empty', waitFor: 'main h1', prepare: loaded },
    {
      // Everything done: the Now card's "clear" variant.
      name: 'clear',
      path: '/?seed=wgu',
      waitFor: NOW_CARD,
      prepare: async (page) => {
        // Finish every open task on Today through the Done button, waiting for each to leave.
        for (let i = 0; i < 20; i++) {
          const done = page.locator(NOW_CARD).getByRole('button', { name: 'Done' })
          if ((await done.count()) === 0) break
          const title = await page.locator('#now-title').innerText()
          await done.click()
          await page.waitForFunction(
            (was) => document.querySelector('#now-title')?.textContent !== was,
            title,
          )
        }
        await page.getByText('You’re clear for now').waitFor()
        await loaded(page)
      },
    },
  ],
}

export default list
