/**
 * Sample data for screenshots, e2e specs and local development. `main.tsx` reaches this only through
 * `?seed=wgu|empty`, and only in builds compiled with `VITE_ENABLE_SEED=1` (see `app/boot.ts`); a
 * deployed build has neither the flag nor this module.
 *
 * Both kinds first wipe every table, make sure the settings row exists and mark onboarding as done
 * (`settings.onboardedAt`), so the first-launch flow never shows over seeded data. `wgu` then loads a
 * B.S. Computer Science goal with its courses, units and planned OAs, about thirty tasks around today
 * (carried over, today, upcoming, a few real deadlines, no date, and two weeks of finished work) and the
 * XP those finished tasks earned. `wgu-year` is `wgu` plus a year of history on the same goal (twenty
 * finished courses, 2,000 finished study sessions, two more courses to take), re-planned so it holds
 * about 300 open sessions: the size the performance budgets are measured at (`budgets.test.ts`,
 * `e2e/perf.spec.ts`).
 */
import { buildStarterData } from '@/data/sample/starterTasks'
import { buildStudyYear } from '@/data/sample/studyYear'
import { WGU_GOAL_ID, buildWguBsCs } from '@/data/sample/wguBsCs'
import { db } from '@/db/db'
import { rebalanceGoal } from '@/db/repos/goals'
import { ensureSettings, updateSettings } from '@/db/repos/settings'
import { dayOf } from '@/logic/dates'

export type SeedKind = 'wgu' | 'wgu-year' | 'empty'

async function clearAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
}

export async function applySeed(kind: SeedKind): Promise<void> {
  await clearAll()
  await ensureSettings()
  const now = Date.now()
  // Seeded data stands for someone who has already been through onboarding, so `/welcome` never
  // intercepts a screenshot or an e2e run (even `empty`, which is an app with nothing in it yet).
  await updateSettings({ onboardedAt: now })
  if (kind === 'empty') return

  const today = dayOf(now)
  const { goal, milestones, units, plannedAssessments } = buildWguBsCs(today, now)
  const { tasks, xpEvents } = buildStarterData({ today, now })

  await db.transaction(
    'rw',
    [db.goals, db.milestones, db.units, db.plannedAssessments, db.tasks, db.xpEvents],
    async () => {
      await db.goals.add(goal)
      await db.milestones.bulkAdd(milestones)
      await db.units.bulkAdd(units)
      await db.plannedAssessments.bulkAdd(plannedAssessments)
      await db.tasks.bulkAdd(tasks)
      await db.xpEvents.bulkAdd(xpEvents)
    },
  )

  await updateSettings({
    tagColors: {
      C182: 'gray',
      C779: 'blue',
      D278: 'green',
      C172: 'orange',
      C959: 'purple',
      mentor: 'purple',
      admin: 'brown',
      errands: 'orange',
      finance: 'yellow',
      reading: 'pink',
      review: 'green',
    },
  })

  if (kind === 'wgu-year') {
    const year = buildStudyYear(today, now)
    await db.transaction('rw', [db.milestones, db.units, db.tasks], async () => {
      await db.milestones.bulkAdd(year.milestones)
      await db.units.bulkAdd(year.units)
      await db.tasks.bulkAdd(year.tasks)
    })
    await rebalanceGoal(WGU_GOAL_ID, { now, reason: 'manual' })
  }
}
