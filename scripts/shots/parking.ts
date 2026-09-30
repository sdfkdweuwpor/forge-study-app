import type { Page } from '@playwright/test'
import { putRows } from '../../e2e/idb'
import { withHistory } from '../../e2e/progressHistory'
import type { ShotList } from '../shot-types'

/**
 * The parking lot and the focus check-in (Phase 11a, 11b): the popover on the Focus page and in full
 * screen, the end dialog with what was parked and the rating, the Today card and the Progress card.
 * The clock is frozen at Tue 2026-09-29 09:30, so the running and ended sessions are seeded.
 */

const MINUTE = 60_000
const TIMER = '[data-testid="timer-display"]'
const TASK = 'C779 · Unit 3: CSS layout (45 min)'
const THOUGHTS = [
  'Look up the C182 OA schedule',
  'Ask about the D278 proctoring rules',
  'Email Dr. Okafor about the C779 project',
]

/** Every live query has answered and finite animations have settled. */
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

/** A session dated around the frozen clock, linked to the seeded task `TASK`. */
async function seedSession(
  page: Page,
  id: string,
  status: 'running' | 'completed',
  startedMinAgo: number,
): Promise<void> {
  const tasks = await page.evaluate(
    () =>
      new Promise<{ id: string; title: string }[]>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const req = open.result.transaction('tasks').objectStore('tasks').getAll()
          req.onerror = () => reject(req.error)
          req.onsuccess = () => resolve(req.result as { id: string; title: string }[])
        }
      }),
  )
  const startedAt = Date.now() - startedMinAgo * MINUTE
  const done = status === 'completed'
  await putRows(page, 'sessions', [
    {
      id,
      createdAt: startedAt,
      updatedAt: startedAt,
      kind: 'focus',
      mode: 'pomodoro',
      status,
      taskId: tasks.find((t) => t.title === TASK)?.id ?? null,
      goalId: null,
      milestoneId: null,
      day: '2026-09-29',
      startedAt,
      endedAt: done ? startedAt + 25 * MINUTE : null,
      plannedMinutes: 25,
      pausedMs: 0,
      pausedAt: null,
      actualMinutes: done ? 25 : null,
      round: 1,
      interrupted: false,
      counted: done,
      note: null,
    },
  ])
}

const parkedRows = (sessionId: string | null) =>
  THOUGHTS.map((text, i) => ({
    id: `shot-park-${i}`,
    createdAt: 1000 + i,
    updatedAt: 1000 + i,
    text,
    sessionId,
    status: 'open',
    taskId: null,
  }))

/** Twenty-four check-ins: mornings and one evening rated best, dated in the weeks before the frozen day. */
function checkInRows() {
  const plan: Array<[hour: number, focus: 3 | 4 | 5, count: number]> = [
    [9, 5, 6],
    [10, 4, 5],
    [14, 3, 5],
    [20, 4, 4],
    [16, 3, 4],
  ]
  const rows: object[] = []
  let n = 0
  for (const [hour, focus, count] of plan) {
    for (let i = 0; i < count; i++) {
      const day = new Date(2026, 8, 28 - ((n * 2) % 40))
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 30).getTime()
      const pad = (v: number): string => String(v).padStart(2, '0')
      rows.push({
        id: `shot-ci-${n}`,
        createdAt: at,
        updatedAt: at,
        sessionId: null,
        at,
        day: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
        hour,
        weekday: day.getDay(),
        focus: i % 4 === 3 && focus > 3 ? ((focus - 1) as 3 | 4) : focus,
        mood: null,
      })
      n++
    }
  }
  return rows
}

const list: ShotList = {
  feature: 'parking',
  shots: [
    {
      // `p` on the Focus page with a session running, a thought half typed.
      name: 'popover',
      path: '/focus?seed=wgu',
      waitFor: TIMER,
      prepare: async (page) => {
        await seedSession(page, 'shot-run', 'running', 10)
        await page.goto('/focus')
        await page.getByRole('button', { name: 'Pause' }).waitFor()
        await loaded(page)
        await page.keyboard.press('p')
        await page
          .getByRole('textbox', { name: /Thought or urge/ })
          .fill('Look up the C182 OA schedule')
        await page.evaluate(() => document.fonts.ready)
      },
    },
    {
      name: 'fullscreen',
      path: '/focus?seed=wgu',
      waitFor: TIMER,
      prepare: async (page) => {
        await seedSession(page, 'shot-fs', 'running', 12)
        await page.goto('/focus')
        await page.getByRole('button', { name: 'Pause' }).waitFor()
        await page.keyboard.press('f')
        await page.getByTestId('fullscreen-focus').waitFor()
        await page.keyboard.press('p')
        await page.getByRole('textbox', { name: /Thought or urge/ }).fill('Buy oat milk')
        await page.evaluate(() => document.fonts.ready)
      },
    },
    {
      // The end dialog: three parked thoughts and an unanswered check-in.
      name: 'end-dialog',
      path: '/focus?seed=wgu',
      waitFor: TIMER,
      prepare: async (page) => {
        await seedSession(page, 'shot-end', 'completed', 25)
        await putRows(page, 'parkingLot', parkedRows('shot-end'))
        await page.evaluate(() => localStorage.setItem('forge:focus:pending-end', 'shot-end'))
        await page.goto('/focus')
        await page.getByRole('dialog', { name: 'Done with this task?' }).waitFor()
        await loaded(page)
      },
    },
    {
      // The same, rated 4 with a mood picked.
      name: 'end-dialog-rated',
      path: '/focus?seed=wgu',
      waitFor: TIMER,
      prepare: async (page) => {
        await seedSession(page, 'shot-end', 'completed', 25)
        await putRows(page, 'parkingLot', parkedRows('shot-end'))
        await page.evaluate(() => localStorage.setItem('forge:focus:pending-end', 'shot-end'))
        await page.goto('/focus')
        const dialog = page.getByRole('dialog', { name: 'Done with this task?' })
        await dialog.waitFor()
        await dialog.getByRole('radio', { name: '4 of 5' }).click()
        await dialog.getByRole('button', { name: 'Calm' }).click()
        await dialog.getByText('Saved.').waitFor()
        await loaded(page)
        await page.mouse.move(0, 0)
      },
    },
    {
      // Another page while a session runs: the mini timer and, under it, "Park a thought".
      name: 'sidebar-button',
      path: '/?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await seedSession(page, 'shot-side', 'running', 6)
        await page.goto('/')
        await page.locator('[data-testid^="mini-timer"]:visible').first().waitFor()
        await loaded(page)
      },
    },
    {
      name: 'today-card',
      path: '/?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await putRows(page, 'parkingLot', parkedRows(null))
        await page.goto('/')
        await page.getByTestId('parked-card').getByTestId('parked-item').first().waitFor()
        await loaded(page)
      },
    },
    {
      name: 'today-card-empty',
      path: '/?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.getByTestId('parked-card').waitFor()
        await loaded(page)
      },
    },
    {
      name: 'progress-card',
      path: '/progress?seed=wgu',
      waitFor: 'h1',
      element: '[data-testid="best-hours"]',
      prepare: async (page) => {
        await withHistory(page)
        await putRows(page, 'checkIns', checkInRows())
        await page.goto('/progress')
        await page.getByTestId('best-hours').getByRole('heading', { name: 'Best hours' }).waitFor()
        await page.addStyleTag({
          content: '[aria-label="Notifications"] { display: none !important }',
        })
        await loaded(page)
      },
    },
    {
      name: 'progress-card-empty',
      path: '/progress?seed=wgu',
      waitFor: 'h1',
      element: '[data-testid="best-hours"]',
      prepare: async (page) => {
        await withHistory(page)
        await page.getByTestId('best-hours').getByText('Rate a few sessions').waitFor()
        await loaded(page)
      },
    },
  ],
}

export default list
