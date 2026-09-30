import type { Page } from '@playwright/test'
import type { ShotList } from '../shot-types'

/** Every live query has answered: no skeleton or busy region is left, and animations have settled. */
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

const MINUTE = 60_000

interface SeedSession {
  id: string
  kind?: 'focus' | 'break'
  status: 'running' | 'paused' | 'completed'
  /** Minutes before the frozen "now" (Tue 2026-09-29 09:30) that it started. */
  startedMinAgo: number
  plannedMinutes: number | null
  actualMinutes?: number
  round?: number
  interrupted?: boolean
  counted?: boolean
  /** A fragment of the title of the task to link. */
  task?: string
  note?: string
  pausedMin?: number
}

/**
 * Writes sessions straight into IndexedDB (dated around the frozen clock), reading the seeded tasks to
 * link them by title. Dexie's live queries do not see a raw write, so the caller reloads afterwards.
 */
async function seedSessions(page: Page, sessions: SeedSession[]): Promise<void> {
  await page.evaluate(
    async ({ list, minute }) => {
      const pad = (n: number): string => String(n).padStart(2, '0')
      const dayOf = (ms: number): string => {
        const d = new Date(ms)
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      }
      const open = indexedDB.open('forge')
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onerror = () => reject(open.error)
        open.onsuccess = () => resolve(open.result)
      })
      const tasks = await new Promise<{ id: string; title: string }[]>((resolve, reject) => {
        const req = db.transaction('tasks').objectStore('tasks').getAll()
        req.onerror = () => reject(req.error)
        req.onsuccess = () => resolve(req.result as { id: string; title: string }[])
      })
      const now = Date.now()
      const rows = list.map((s) => {
        const startedAt = now - s.startedMinAgo * minute
        const done = s.status === 'completed'
        const actual = s.actualMinutes ?? s.plannedMinutes ?? 0
        return {
          id: s.id,
          createdAt: startedAt,
          updatedAt: startedAt,
          kind: s.kind ?? 'focus',
          mode: s.plannedMinutes === null ? 'stopwatch' : 'pomodoro',
          status: s.status,
          taskId: s.task ? (tasks.find((t) => t.title.includes(s.task ?? ''))?.id ?? null) : null,
          goalId: null,
          milestoneId: null,
          day: dayOf(startedAt),
          startedAt,
          endedAt: done ? startedAt + (actual + (s.pausedMin ?? 0)) * minute : null,
          plannedMinutes: s.plannedMinutes,
          pausedMs: (s.pausedMin ?? 0) * minute,
          pausedAt: null,
          actualMinutes: done ? actual : null,
          round: s.round ?? 1,
          interrupted: s.interrupted ?? false,
          counted: s.counted ?? done,
          note: s.note ?? null,
        }
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('sessions', 'readwrite')
        for (const row of rows) tx.objectStore('sessions').put(row)
        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => resolve()
      })
      db.close()
    },
    { list: sessions, minute: MINUTE },
  )
}

const TIMER = '[data-testid="timer-display"]'
const IN_PROGRESS = 'C779 · Unit 3: CSS layout (45 min)'

/** Today's finished rounds, as they would look after a morning of work. */
const MORNING: SeedSession[] = [
  {
    id: 'shot-1',
    status: 'completed',
    startedMinAgo: 128,
    plannedMinutes: 25,
    round: 1,
    task: 'Email mentor',
  },
  {
    id: 'shot-2',
    status: 'completed',
    startedMinAgo: 92,
    plannedMinutes: 25,
    round: 2,
    task: 'CSS layout (45 min)',
    note: 'Grid areas make sense now; flexbox wrapping still fuzzy.',
  },
  {
    id: 'shot-3',
    status: 'completed',
    startedMinAgo: 60,
    plannedMinutes: 50,
    actualMinutes: 27,
    interrupted: true,
    counted: false,
    task: 'CSS layout (45 min)',
  },
  { id: 'shot-4', status: 'completed', startedMinAgo: 24, plannedMinutes: null, actualMinutes: 18 },
]

/** Focus (Phase 4A). The clock is frozen at Tue 2026-09-29 09:30, so a "running" session is seeded mid-way. */
const list: ShotList = {
  feature: 'focus',
  shots: [
    { name: 'idle', path: '/focus?seed=wgu', waitFor: TIMER, prepare: loaded },
    {
      // Ten and a half minutes into a pomodoro on the task in progress; the ring is part-way round.
      name: 'running',
      path: '/focus?seed=wgu',
      waitFor: TIMER,
      prepare: async (page) => {
        await seedSessions(page, [
          {
            id: 'shot-run',
            status: 'running',
            startedMinAgo: 10.5,
            plannedMinutes: 25,
            round: 3,
            task: IN_PROGRESS,
          },
        ])
        await page.goto('/focus')
        await page.locator(TIMER).waitFor()
        await page.getByRole('button', { name: 'Pause' }).waitFor()
        await loaded(page)
      },
    },
    {
      // The answer owed after a session ended: it survives a refresh through a pending-end marker.
      name: 'end-dialog',
      path: '/focus?seed=wgu',
      waitFor: TIMER,
      prepare: async (page) => {
        await seedSessions(page, [
          {
            id: 'shot-end',
            status: 'completed',
            startedMinAgo: 25,
            plannedMinutes: 25,
            round: 1,
            task: IN_PROGRESS,
          },
        ])
        await page.evaluate(() => localStorage.setItem('forge:focus:pending-end', 'shot-end'))
        await page.goto('/focus')
        await page.getByRole('dialog', { name: 'Done with this task?' }).waitFor()
        await loaded(page)
      },
    },
    {
      name: 'fullscreen',
      path: '/focus?seed=wgu',
      waitFor: TIMER,
      prepare: async (page) => {
        await seedSessions(page, [
          {
            id: 'shot-fs',
            status: 'running',
            startedMinAgo: 12,
            plannedMinutes: 25,
            round: 2,
            task: IN_PROGRESS,
          },
        ])
        await page.goto('/focus')
        await page.getByRole('button', { name: 'Pause' }).waitFor()
        await page.keyboard.press('f')
        await page.getByTestId('fullscreen-focus').waitFor()
        await page.mouse.move(700, 400)
        await page.evaluate(() =>
          Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
        )
      },
    },
    {
      // A break up next after a counted round, with the morning's log below.
      name: 'log',
      path: '/focus?seed=wgu',
      waitFor: TIMER,
      fullPage: true,
      prepare: async (page) => {
        await seedSessions(page, MORNING)
        await page.goto('/focus')
        await page.getByTestId('session-row').first().waitFor()
        await loaded(page)
      },
    },
    { name: 'empty', path: '/focus?seed=empty', waitFor: TIMER, fullPage: true, prepare: loaded },
    {
      // Away from the Focus page the running timer stays in the sidebar (and above the tab bar on a phone).
      name: 'today-running',
      path: '/?seed=wgu',
      prepare: async (page) => {
        await seedSessions(page, [
          {
            id: 'shot-today',
            status: 'running',
            startedMinAgo: 9,
            plannedMinutes: 25,
            round: 1,
            task: IN_PROGRESS,
          },
        ])
        await page.goto('/')
        // The stat row is the last part of Today to load its numbers.
        await page.getByText('earned today').waitFor()
        await page.getByTestId('mini-timer').or(page.getByTestId('mini-timer-pill')).first().waitFor()
        await loaded(page)
      },
    },
  ],
}

export default list
