import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { SETTINGS_ID } from '@/db/defaults'
import { ensureWorldSeed, loadWorldRows, randomSeed, readWorldSeed } from '@/db/repos/world'
import { ensureSettings, getSettings, updateSettings } from '@/db/repos/settings'
import type { Goal, Milestone, Session, Task } from '@/db/types'
import { buildWorld } from '@/logic/world'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('the world seed', () => {
  it('is not there until it is created', async () => {
    expect(await readWorldSeed()).toBe(0)
    await ensureSettings()
    expect(await readWorldSeed()).toBe(0)
    expect((await getSettings()).world.seed).toBe(0)
  })

  it('is created once and never changes', async () => {
    await ensureSettings()
    const first = await ensureWorldSeed(() => 4242)
    expect(first).toBe(4242)
    // Asking again, even with another source of randomness, returns the stored one.
    expect(await ensureWorldSeed(() => 7)).toBe(4242)
    expect(await readWorldSeed()).toBe(4242)
    // Other settings changes keep it.
    await updateSettings({ dailyGoalPomodoros: 4 })
    expect(await readWorldSeed()).toBe(4242)
  })

  it('is created even before the settings row exists, and two tabs agree', async () => {
    const [a, b] = await Promise.all([ensureWorldSeed(() => 11), ensureWorldSeed(() => 22)])
    expect(a).toBe(b)
    expect(await db.settings.count()).toBe(1)
    expect((await db.settings.get(SETTINGS_ID))?.world.seed).toBe(a)
  })

  it('backfills a settings row written before the world existed', async () => {
    await ensureSettings()
    const row = await db.settings.get(SETTINGS_ID)
    if (!row) throw new Error('no settings row')
    const legacy: Record<string, unknown> = { ...row }
    Reflect.deleteProperty(legacy, 'world')
    await db.settings.clear()
    await db.settings.add(legacy as unknown as typeof row)
    expect(await readWorldSeed()).toBe(0)
    expect(await ensureWorldSeed(() => 99)).toBe(99)
    expect((await getSettings()).world).toEqual({ seed: 99 })
  })

  it('draws random seeds in range', () => {
    for (let i = 0; i < 200; i++) {
      const s = randomSeed()
      expect(Number.isInteger(s)).toBe(true)
      expect(s).toBeGreaterThan(0)
      expect(s).toBeLessThan(0x7fffffff)
    }
  })
})

// ─── loadWorldRows ──────────────────────────────────────────────────────────────────────────────

describe('loadWorldRows', () => {
  const at = (h: number, day = '2026-09-28') => new Date(`${day}T${String(h).padStart(2, '0')}:00:00-04:00`).getTime()

  function task(id: string, over: Partial<Task> = {}): Task {
    return {
      id,
      createdAt: 1,
      updatedAt: 1,
      title: `Task ${id}`,
      notes: [],
      status: 'done',
      priority: 0,
      doDate: null,
      doTime: null,
      durationMinutes: null,
      dueDate: null,
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
      order: 1,
      boardOrder: 1,
      startedAt: null,
      completedAt: at(9),
      completedDay: '2026-09-28',
      autoSlot: false,
      kind: 'task',
      assessmentId: null,
      sync: null,
      ...over,
    }
  }

  function session(id: string, day: string, over: Partial<Session> = {}): Session {
    return {
      id,
      createdAt: 1,
      updatedAt: 1,
      kind: 'focus',
      mode: 'pomodoro',
      status: 'completed',
      taskId: null,
      goalId: null,
      milestoneId: null,
      day,
      startedAt: at(9, day),
      endedAt: at(10, day),
      plannedMinutes: 25,
      pausedMs: 0,
      pausedAt: null,
      actualMinutes: 25,
      round: 1,
      interrupted: false,
      counted: true,
      note: null,
      ...over,
    }
  }

  async function goal(id: string, over: Partial<Goal> = {}): Promise<Goal> {
    await ensureSettings()
    const g = {
      id,
      createdAt: 1,
      updatedAt: 500,
      title: `Goal ${id}`,
      icon: '🎯',
      cover: null,
      kind: 'degree',
      status: 'active',
      startDate: '2026-01-01',
      targetDate: null,
      order: 1,
      completedAt: null,
      ...over,
    } as unknown as Goal
    await db.goals.add(g)
    return g
  }

  function course(id: string, goalId: string, over: Partial<Milestone> = {}): Milestone {
    return {
      id,
      createdAt: 1,
      updatedAt: 700,
      goalId,
      kind: 'course',
      code: 'C182',
      title: 'Introduction to IT',
      status: 'done',
      order: 1,
      completedAt: at(15),
      ...over,
    } as unknown as Milestone
  }

  it('is empty for a new user', async () => {
    await ensureSettings()
    expect(await loadWorldRows()).toEqual({ seed: 0, tasks: [], focusDays: [], courses: [], goals: [] })
  })

  it('takes finished tasks with their goal, and leaves out open ones, milestone items and undated ones', async () => {
    await goal('g1', { title: 'B.S. Computer Science' })
    await db.tasks.bulkAdd([
      task('a', { goalId: 'g1' }),
      task('b'),
      task('open', { status: 'todo', completedAt: null }),
      task('ms', { kind: 'milestone', title: 'C182 milestone' }),
      task('nodate', { completedAt: null }),
    ])
    const rows = await loadWorldRows()
    expect(rows.tasks.map((t) => [t.id, t.goalTitle]).sort()).toEqual([
      ['a', 'B.S. Computer Science'],
      ['b', null],
    ])
    expect(rows.tasks.find((t) => t.id === 'a')).toMatchObject({ title: 'Task a', completedAt: at(9) })
  })

  it('adds up counted focus minutes per day and ignores everything else', async () => {
    await db.sessions.bulkAdd([
      session('s1', '2026-09-28', { actualMinutes: 25 }),
      session('s2', '2026-09-28', { actualMinutes: 50 }),
      session('s3', '2026-09-27', { actualMinutes: 30 }),
      session('short', '2026-09-27', { actualMinutes: 5, counted: false }),
      session('stopped', '2026-09-27', { status: 'abandoned' }),
      session('break', '2026-09-27', { kind: 'break', actualMinutes: 5 }),
    ])
    const rows = await loadWorldRows()
    expect([...rows.focusDays].sort((a, b) => a.day.localeCompare(b.day))).toEqual([
      { day: '2026-09-27', minutes: 30 },
      { day: '2026-09-28', minutes: 75 },
    ])
  })

  it('takes finished courses and goals, with a fallback time', async () => {
    await goal('g1', { title: 'B.S. Computer Science', status: 'done', completedAt: at(18) })
    await goal('g2', { title: 'CompTIA A+', kind: 'certification', status: 'done' })
    await goal('g3', { title: 'Still going', status: 'active' })
    await db.milestones.bulkAdd([
      course('c1', 'g1'),
      course('c2', 'g1', { code: null, title: 'Networking', completedAt: null }),
      course('c3', 'g1', { status: 'active', completedAt: null }),
      course('m1', 'g1', { kind: 'milestone', title: 'Not a course' }),
    ])
    const rows = await loadWorldRows()
    expect(rows.courses.map((c) => [c.id, c.code, c.completedAt, c.goalTitle]).sort()).toEqual([
      ['c1', 'C182', at(15), 'B.S. Computer Science'],
      ['c2', null, 700, 'B.S. Computer Science'],
    ])
    expect(rows.goals.map((g) => [g.id, g.kind, g.completedAt]).sort()).toEqual([
      ['g1', 'degree', at(18)],
      ['g2', 'certification', 500],
    ])
  })

  it('feeds buildWorld: two finished tasks and a course become two tiles and a landmark', async () => {
    await goal('g1')
    await db.tasks.bulkAdd([task('a'), task('b', { completedAt: at(10) })])
    await db.milestones.add(course('c1', 'g1'))
    const rows = await loadWorldRows()
    const world = buildWorld({ ...rows, seed: 1, streakDays: 0 })
    expect(world.stats).toMatchObject({ tiles: 2, landmarks: 1 })
  })
})
