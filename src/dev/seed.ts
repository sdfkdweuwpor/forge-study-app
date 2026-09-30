/**
 * Sample data for screenshots, e2e specs and local development. `main.tsx` reaches this only through
 * `?seed=wgu|empty`, and only in builds compiled with `VITE_ENABLE_SEED=1` (see `app/boot.ts`); a
 * deployed build has neither the flag nor this module.
 *
 * Both kinds first wipe every table, then make sure the settings row exists. `wgu` then loads a
 * B.S. Computer Science goal with its courses, units and planned OAs, about thirty tasks around today
 * (carried over, today, upcoming, a few real deadlines, no date, and two weeks of finished work) and the
 * XP those finished tasks earned.
 */
import { buildStarterData } from '@/data/sample/starterTasks'
import { buildWguBsCs } from '@/data/sample/wguBsCs'
import { db } from '@/db/db'
import { ensureSettings, updateSettings } from '@/db/repos/settings'
import { dayOf } from '@/logic/dates'

export type SeedKind = 'wgu' | 'empty'

async function clearAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
}

export async function applySeed(kind: SeedKind): Promise<void> {
  await clearAll()
  await ensureSettings()
  if (kind === 'empty') return

  const now = Date.now()
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
    onboardedAt: now,
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
}
