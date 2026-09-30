import type { Page } from '@playwright/test'
import { expect } from './fixtures'
import { clearTable, focusSession, putRows } from './idb'
import { patchSettings } from './progressHistory'

/**
 * A week for the weekly review, seeded on top of the WGU sample: Mon Sep 21 – Sun Sep 27, 2026, reviewed
 * on the Sunday evening (the "review day"). It is written straight into IndexedDB (`seedReviewWeek`), so a
 * spec and the screenshot script see the same numbers:
 *
 * - focus: Mon 2 × 25, Tue nothing (the weekly freeze covers it ❄️), Wed 50 (no goal), Thu 25, Fri 50,
 *   Sat 100 = 4 h 35 min in 6 sessions on 5 days; the week before has one 25-minute session
 * - tasks done: Mon, Tue, Thu, Sat (4); one the week before
 * - next week (Sep 28 – Oct 4): Mon 60 + 15 min (2 items), Wed 90 min, Fri a deadline with no length
 *
 * The streak is 5 (the freeze keeps it, and adds nothing), the wins read "4 tasks done", "4 h 35 min of
 * focus", "On a 5-day streak", "You showed up on 5 days", "Longest session: 1 h 40 min" and
 * "Best day: Saturday, 1 h 40 min".
 */
export const REVIEW_WEEK = '2026-09-21'
export const PREVIOUS_WEEK = '2026-09-14'
export const REVIEW_SUNDAY = new Date('2026-09-27T20:00:00-04:00')
export const WGU_GOAL = 'goal-wgu-bscs'

const at = (day: string, time: string): number => new Date(`${day}T${time}:00-04:00`).getTime()

/** A finished, counted focus session `minutes` long that starts at `time` on `day`. */
function session(
  id: string,
  day: string,
  time: string,
  minutes: number,
  goalId: string | null,
): Record<string, unknown> {
  const startedAt = at(day, time)
  return {
    ...focusSession(id, day, goalId, minutes),
    createdAt: startedAt,
    updatedAt: startedAt,
    startedAt,
    endedAt: startedAt + minutes * 60_000,
  }
}

interface TaskSpec {
  id: string
  title: string
  doneOn?: string
  doDate?: string | null
  dueDate?: string | null
  minutes?: number | null
}

/** A complete task row (the fields `createTask` fills in), open or finished on a day. */
function task(spec: TaskSpec): Record<string, unknown> {
  const created = at('2026-09-14', '09:00')
  const completedAt = spec.doneOn ? at(spec.doneOn, '11:00') : null
  return {
    id: spec.id,
    createdAt: created,
    updatedAt: completedAt ?? created,
    title: spec.title,
    notes: [],
    status: spec.doneOn ? 'done' : 'todo',
    priority: 0,
    doDate: spec.doDate ?? null,
    doTime: null,
    durationMinutes: spec.minutes ?? null,
    dueDate: spec.dueDate ?? null,
    dueTime: null,
    estimatePomodoros: null,
    estimateMinutes: null,
    tags: [],
    goalId: null,
    milestoneId: null,
    unitId: null,
    source: 'user',
    scheduleKey: null,
    schedulePinned: false,
    skippedOn: null,
    orderInDay: 0,
    subtasks: [],
    recurrence: null,
    seriesId: null,
    order: created,
    boardOrder: created,
    startedAt: null,
    completedAt,
    completedDay: spec.doneOn ?? null,
    autoSlot: false,
    kind: 'task',
    assessmentId: null,
    sync: null,
  }
}

/**
 * Loads the WGU sample (on the fixture's Tuesday), moves the clock to the review Sunday, replaces the
 * sample's tasks with the week's and adds its sessions while the app is closed, and marks the level as
 * celebrated (the review's XP must not raise a level-up moment over the page). The next `page.goto` is
 * the start that builds the streak days from these rows.
 */
export async function seedReviewWeek(page: Page): Promise<void> {
  await page.goto('/?seed=wgu')
  await page.locator('#root > *').first().waitFor()
  // Today has rendered: the seed is in (it is applied before the first render), on any viewport.
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible()
  await page.clock.setFixedTime(REVIEW_SUNDAY)
  // Leave the app first: a start-up still running would read half of what is written next.
  await page.goto('/404.html')
  await clearTable(page, 'tasks')
  await putRows(page, 'sessions', [
    session('rw-s1', PREVIOUS_WEEK, '08:00', 25, WGU_GOAL),
    session('rw-s2', '2026-09-21', '08:00', 25, WGU_GOAL),
    session('rw-s3', '2026-09-21', '09:00', 25, WGU_GOAL),
    session('rw-s4', '2026-09-23', '08:00', 50, null),
    session('rw-s5', '2026-09-24', '08:00', 25, WGU_GOAL),
    session('rw-s6', '2026-09-25', '08:00', 50, WGU_GOAL),
    session('rw-s7', '2026-09-26', '08:00', 100, WGU_GOAL),
  ])
  await putRows(page, 'tasks', [
    task({ id: 'rw-t0', title: 'C182 · Unit 3: Networks and the internet', doneOn: '2026-09-16' }),
    task({ id: 'rw-t1', title: 'C182 · Unit 4: Security basics', doneOn: '2026-09-21' }),
    task({ id: 'rw-t2', title: 'Email mentor about term plan', doneOn: '2026-09-22' }),
    task({ id: 'rw-t3', title: 'C779 · Unit 3: Flexbox and grid', doneOn: '2026-09-24' }),
    task({ id: 'rw-t4', title: 'D278 · Unit 1: Variables and types', doneOn: '2026-09-26' }),
    task({ id: 'rw-n1', title: 'C779 · Unit 4: Forms and validation', doDate: '2026-09-28', minutes: 60 }),
    task({ id: 'rw-n2', title: 'Reply to the C182 evaluator', doDate: '2026-09-28', minutes: 15 }),
    task({ id: 'rw-n3', title: 'D278 · Practice test', doDate: '2026-09-30', minutes: 90 }),
    task({ id: 'rw-n4', title: 'Pay the phone bill', dueDate: '2026-10-02' }),
  ])
  await patchSettings(page, { lastCelebratedLevel: 999 })
}

/** Opens the review of the seeded week and waits for its numbers. */
export async function openSeededReview(page: Page, path = '/review'): Promise<void> {
  await page.goto(path)
  await expect(page.getByRole('heading', { name: 'Weekly review', level: 1 })).toBeVisible()
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
}
