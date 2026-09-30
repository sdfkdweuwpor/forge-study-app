import type { Page } from '@playwright/test'
import { FIXED_NOW } from '../../e2e/fixtures'
import { putRows } from '../../e2e/idb'
import type { ShotList } from '../shot-types'

/**
 * My World (Phase 8A). The WGU sample is a small city (a dozen tiles and one landmark). The bigger shots
 * add history through IndexedDB and reload: sixty finished tasks, weeks of focus (towers, and a streak that
 * brings the lights, people, birds and, at 30 days, the fountain), two more courses, a certification and a
 * degree. Day is the frozen 09:30; night moves the clock to 22:30 before the reload.
 */
const CANVAS = '[data-testid="world-canvas"]'
const NIGHT = new Date('2026-09-29T22:30:00-04:00')
const HOUR = 3_600_000

const pad = (n: number): string => String(n).padStart(2, '0')
const isoOf = (offset: number): string => {
  const d = new Date(FIXED_NOW.getTime() + offset * 86_400_000)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type Row = Record<string, unknown>

/** A real row of a table (the sample's), to copy: rows made up from scratch would miss fields other features read. */
async function firstRow(page: Page, table: string, key: string, value: string): Promise<Row> {
  const row = await page.evaluate(
    ([name, field, wanted]) =>
      new Promise<Row | null>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const all = open.result.transaction([name as string]).objectStore(name as string).getAll()
          all.onsuccess = () => {
            open.result.close()
            resolve((all.result as Row[]).find((r) => r[field as string] === wanted) ?? null)
          }
        }
      }),
    [table, key, value] as const,
  )
  if (!row) throw new Error(`no ${table} row with ${key} = ${value}`)
  return row
}

function task(template: Row, i: number): Row {
  const offset = -1 - Math.floor(i / 3)
  const at = new Date(`${isoOf(offset)}T${pad(8 + (i % 3) * 4)}:15:00-04:00`).getTime()
  const titles = ['Read chapter', 'Practice quiz', 'Review flashcards', 'Lab write-up', 'Watch the lecture', 'Outline the essay']
  return {
    ...template,
    id: `shot-task-${i}`,
    title: `${titles[i % titles.length] ?? 'Study'} ${1 + (i % 12)}`,
    status: 'done',
    completedAt: at,
    completedDay: isoOf(offset),
    doDate: isoOf(offset),
    createdAt: at - HOUR,
    updatedAt: at,
  }
}

function focus(offset: number, i: number): Row {
  const day = isoOf(offset)
  const startedAt = new Date(`${day}T07:00:00-04:00`).getTime() + i * 40 * 60_000
  return {
    id: `shot-focus-${offset}-${i}`,
    createdAt: startedAt,
    updatedAt: startedAt,
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    taskId: null,
    goalId: null,
    milestoneId: null,
    day,
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
  }
}

function course(template: Row, id: string, code: string, title: string, offset: number): Row {
  const at = new Date(`${isoOf(offset)}T15:00:00-04:00`).getTime()
  return { ...template, id, code, title, status: 'done', completedAt: at, createdAt: at, updatedAt: at }
}

function goal(template: Row, id: string, title: string, kind: string, offset: number): Row {
  const at = new Date(`${isoOf(offset)}T18:00:00-04:00`).getTime()
  return { ...template, id, title, kind, status: 'done', completedAt: at, createdAt: at, updatedAt: at }
}

/** Adds history for `days` days of streak, then loads the page again (optionally at another time of day). */
async function grow(page: Page, days: number, at?: Date): Promise<void> {
  const sessions: Row[] = []
  for (let d = 1; d <= days; d++) for (let i = 0; i < 3; i++) sessions.push(focus(-d, i))
  await putRows(page, 'sessions', sessions)
  const taskTemplate = await firstRow(page, 'tasks', 'id', 'task-c182-oa')
  const courseTemplate = await firstRow(page, 'milestones', 'code', 'C182')
  const goalTemplate = await firstRow(page, 'goals', 'kind', 'degree')
  await putRows(page, 'tasks', Array.from({ length: 60 }, (_, i) => task(taskTemplate, i)))
  await putRows(page, 'milestones', [
    course(courseTemplate, 'shot-c779', 'C779', 'Web Development Foundations', -6),
    course(courseTemplate, 'shot-d278', 'D278', 'Scripting and Programming Foundations', -4),
    course(courseTemplate, 'shot-c172', 'C172', 'Network and Security Foundations', -2),
  ])
  await putRows(page, 'goals', [
    goal(goalTemplate, 'shot-aplus', 'CompTIA A+ Certification', 'certification', -12),
    goal(goalTemplate, 'shot-assoc', 'A.S. Information Technology', 'degree', -3),
  ])
  if (at) await page.clock.setFixedTime(at)
  await page.goto('/world')
  await page.locator(CANVAS).waitFor()
  await page.waitForFunction(() => (window.__forgeWorld?.ids().length ?? 0) > 20)
  // The streak is rebuilt from the sessions at app start; wait until the world has it.
  await page.waitForFunction((level) => (window.__forgeWorld?.stats()?.streakLevel ?? 0) >= level, days >= 30 ? 4 : days >= 14 ? 3 : 2)
  // Crediting the streak can raise a level, and the level-up moment covers the screen for a second or two.
  await page.waitForTimeout(4000)
}

async function hoverTask(page: Page, id: string): Promise<void> {
  const at = await page.evaluate((i) => window.__forgeWorld?.pointOf(i) ?? null, id)
  if (!at) throw new Error(`no ${id}`)
  await page.mouse.move(at.x, at.y)
  await page.getByRole('tooltip').waitFor()
}

const list: ShotList = {
  feature: 'world',
  shots: [
    // The default sample: a small city, and the first thing a new user of the sample sees.
    { name: 'sample', path: '/world?seed=wgu', waitFor: CANVAS, prepare: (p) => p.waitForTimeout(500) },
    { name: 'empty', path: '/world?seed=empty', waitFor: CANVAS, prepare: (p) => p.waitForTimeout(500) },
    // A grown city by day: 14 days of streak (lights, people, birds), towers, landmarks, a monument and a castle.
    { name: 'day', path: '/world?seed=wgu', waitFor: CANVAS, prepare: (p) => grow(p, 16) },
    // The same city at 22:30: windows and lamps lit, stars.
    { name: 'night', path: '/world?seed=wgu', waitFor: CANVAS, prepare: (p) => grow(p, 16, NIGHT) },
    // Thirty-one days: the fountain, and fireworks at night.
    { name: 'night-30', path: '/world?seed=wgu', waitFor: CANVAS, prepare: (p) => grow(p, 31, NIGHT) },
    // Zoomed in on the first monument by wheel, at night with a 31-day streak: the fountain and the lit windows.
    {
      name: 'zoom',
      path: '/world?seed=wgu',
      waitFor: CANVAS,
      prepare: async (p) => {
        await grow(p, 31, NIGHT)
        const at = await p.evaluate(() => window.__forgeWorld?.pointOf('goal:shot-aplus') ?? null)
        if (!at) throw new Error('no monument')
        await p.mouse.move(at.x, at.y)
        for (let i = 0; i < 3; i++) {
          await p.mouse.wheel(0, -120)
          await p.waitForTimeout(150)
        }
        await p.mouse.move(at.x + 400, at.y - 300)
        await p.waitForTimeout(400)
      },
    },
    {
      name: 'tooltip',
      path: '/world?seed=wgu',
      waitFor: CANVAS,
      prepare: async (p) => {
        await grow(p, 16)
        await hoverTask(p, 'task:shot-task-7')
      },
    },
    // The sidebar hidden: the title moves over so the floating sidebar button does not sit on it.
    {
      name: 'collapsed',
      path: '/world?seed=wgu',
      waitFor: CANVAS,
      prepare: async (p) => {
        await p.keyboard.press('ControlOrMeta+\\')
        await p.waitForTimeout(700)
      },
    },
    {
      name: 'legend',
      path: '/world?seed=wgu',
      waitFor: CANVAS,
      prepare: async (p) => {
        await grow(p, 16)
        await p.getByRole('button', { name: 'Legend' }).click()
        await p.getByRole('dialog', { name: 'What earns what' }).waitFor()
      },
    },
  ],
}

export default list
