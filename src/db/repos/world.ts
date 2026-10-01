/**
 * My World's one stored value: the seed of its generator (BRIEF §5.6). The city itself is never stored;
 * it is rebuilt from the history every time, and the seed is what makes that rebuild the same each time.
 */
import { countedMinutes } from '@/logic/stats'
import type { WorldInput } from '@/logic/world'
import { db } from '../db'
import { SETTINGS_ID, defaultSettings } from '../defaults'
import { withDefaults } from './settings'

/** A whole number in 1..2^31 - 1, from the browser's random source. */
export function randomSeed(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return ((buf[0] ?? 1) % 0x7ffffffe) + 1
}

/**
 * The world seed, created on first use and never changed after. Runs in one transaction, so two tabs
 * opening My World at once end up with the same seed. Does not emit `settings.changed`: nothing else
 * cares about this value.
 */
export async function ensureWorldSeed(random: () => number = randomSeed): Promise<number> {
  return db.transaction('rw', db.settings, async () => {
    const row = await db.settings.get(SETTINGS_ID)
    const settings = row ? withDefaults(row) : defaultSettings(Date.now())
    if (row && settings.world.seed > 0) return settings.world.seed
    const seed = random()
    await db.settings.put({ ...settings, world: { seed }, updatedAt: Date.now() })
    return seed
  })
}

/** The stored seed, or 0 while none has been created. Read-only, so it is safe inside a live query. */
export async function readWorldSeed(): Promise<number> {
  const row = await db.settings.get(SETTINGS_ID)
  return row ? withDefaults(row).world.seed : 0
}

// ─── The history the city is built from ─────────────────────────────────────────────────────────

/** Everything `buildWorld` needs from the tables; the streak comes from `useStreak`. */
export type WorldRows = Omit<WorldInput, 'streakDays'>

const FIRST_DAY = ''
const LAST_DAY = '￿'

/**
 * Reads the history: finished tasks (not the scheduler's milestone items, which stand for a course and
 * would count twice), focus minutes per day from counted sessions, finished courses and finished goals.
 * A finished course or goal with no completion time falls back to when it was last saved, so nothing
 * the person finished is left out of the city. Read-only, so it is safe inside a live query.
 */
export async function loadWorldRows(): Promise<WorldRows> {
  const [seed, done, goals, milestones, sessions] = await Promise.all([
    readWorldSeed(),
    db.tasks.where('status').equals('done').toArray(),
    db.goals.toArray(),
    db.milestones.where('status').equals('done').toArray(),
    db.sessions.where('[kind+day]').between(['focus', FIRST_DAY], ['focus', LAST_DAY], true, true).toArray(),
  ])
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]))

  const tasks: WorldRows['tasks'][number][] = []
  for (const t of done) {
    if (t.kind === 'milestone' || t.completedAt === null) continue
    tasks.push({
      id: t.id,
      title: t.title,
      completedAt: t.completedAt,
      goalTitle: t.goalId === null ? null : (goalTitle.get(t.goalId) ?? null),
    })
  }

  const minutes = new Map<string, number>()
  for (const s of sessions) {
    const m = countedMinutes(s)
    if (m > 0) minutes.set(s.day, (minutes.get(s.day) ?? 0) + m)
  }

  return {
    seed,
    tasks,
    focusDays: [...minutes].map(([day, m]) => ({ day, minutes: m })),
    courses: milestones
      .filter((m) => m.kind === 'course')
      .map((m) => ({
        id: m.id,
        code: m.code,
        title: m.title,
        completedAt: m.completedAt ?? m.updatedAt,
        goalTitle: goalTitle.get(m.goalId) ?? '',
      })),
    goals: goals
      .filter((g) => g.status === 'done')
      .map((g) => ({ id: g.id, title: g.title, completedAt: g.completedAt ?? g.updatedAt, kind: g.kind })),
  }
}
