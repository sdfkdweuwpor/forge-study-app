import { describe, expect, it } from 'vitest'
import { compareDepth } from './iso'
import { PLOT_PERIOD, SLOT_OFFSETS, buildWorld, truncate } from './layout'
import { mulberry32 } from './prng'
import { spiral } from './spiral'
import type { Placed, WorldInput } from './types'

/** Local time: months are 0-based like `Date`. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m, d, h, min).getTime()
const day = (n: number) => `2026-${String(Math.floor(n / 28) + 1).padStart(2, '0')}-${String((n % 28) + 1).padStart(2, '0')}`

const base = (over: Partial<WorldInput> = {}): WorldInput => ({
  seed: 1337,
  tasks: [],
  focusDays: [],
  courses: [],
  goals: [],
  streakDays: 0,
  ...over,
})

const tasks = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${from + i}`,
    title: `Task ${from + i}`,
    completedAt: at(2026, 0, 1, 8) + (from + i) * 3_600_000,
  }))

const cells = (p: Placed): string[] => {
  const out: string[] = []
  for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) out.push(`${p.x + dx}:${p.y + dy}`)
  return out
}
const mod = (n: number, m: number) => ((n % m) + m) % m

describe('buildWorld: the empty world', () => {
  it('is empty, with finite zero bounds', () => {
    const w = buildWorld(base())
    expect(w.earned).toEqual([])
    expect(w.scenery).toEqual([])
    expect(w.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
    expect(w.stats).toEqual({ tiles: 0, floors: 0, landmarks: 0, streakLevel: 0 })
  })

  it('lays out one plot of ground when asked to (the new-user view)', () => {
    const w = buildWorld(base(), { minPlots: 1 })
    expect(w.earned).toEqual([])
    expect(w.scenery.filter((p) => p.kind === 'grass')).toHaveLength(16)
    expect(w.scenery.filter((p) => p.kind === 'road')).toHaveLength(20)
    expect(w.bounds).toEqual({ minX: -1, minY: -1, maxX: 4, maxY: 4 })
  })

  it('ignores junk: non-finite times, bad days, empty minutes', () => {
    const w = buildWorld(
      base({
        tasks: [{ id: 'a', title: 'A', completedAt: Number.NaN }],
        courses: [{ id: 'c', code: 'C1', title: 'C', completedAt: Infinity, goalTitle: 'G' }],
        goals: [{ id: 'g', title: 'G', completedAt: Number.NaN, kind: 'degree' }],
        focusDays: [
          { day: 'not-a-day', minutes: 600 },
          { day: '2026-01-01', minutes: Number.NaN },
          { day: '2026-01-02', minutes: -5 },
        ],
      }),
    )
    expect(w.earned).toEqual([])
  })
})

describe('buildWorld: placement', () => {
  it('fills the first plot through the 8 slots in order, then takes the next plot of the spiral', () => {
    const w = buildWorld(base({ tasks: tasks(9) }))
    const byTime = [...w.earned].sort((a, b) => (a.earnedAt ?? 0) - (b.earnedAt ?? 0))
    SLOT_OFFSETS.forEach(([dx, dy], i) => {
      expect(byTime[i]).toMatchObject({ x: dx, y: dy, w: 1, h: 1 })
    })
    const next = spiral(1)
    expect(byTime[8]).toMatchObject({ x: next.x * PLOT_PERIOD, y: next.y * PLOT_PERIOD })
  })

  it('gives every large item a plot of its own', () => {
    const w = buildWorld(
      base({
        tasks: tasks(3),
        courses: [{ id: 'c1', code: 'C182', title: 'Introduction to IT', completedAt: at(2026, 0, 2), goalTitle: 'B.S.' }],
        goals: [
          { id: 'g1', title: 'A+ Certification', completedAt: at(2026, 0, 3), kind: 'certification' },
          { id: 'g2', title: 'B.S. Computer Science', completedAt: at(2026, 0, 4), kind: 'degree' },
        ],
      }),
    )
    const byId = new Map(w.earned.map((p) => [p.id, p]))
    expect(byId.get('course:c1')).toMatchObject({ kind: 'landmark', w: 2, h: 2, floors: 4, x: 5 + 1, y: 0 + 1 })
    expect(byId.get('goal:g1')).toMatchObject({ kind: 'monument', w: 2, h: 2, floors: 2 })
    expect(byId.get('goal:g2')).toMatchObject({ kind: 'castle', w: 3, h: 3, floors: 5 })
    // Plot 0 holds the tiles, plots 1-3 the large items (spiral order), one each.
    const plots = new Set(w.earned.filter((p) => p.w > 1).map((p) => `${Math.floor(p.x / 5)},${Math.floor(p.y / 5)}`))
    expect(plots.size).toBe(3)
    expect(byId.get('goal:g2')).toMatchObject({ x: spiral(3).x * 5, y: spiral(3).y * 5 })
  })

  it('chooses house, tree or lamp for a task from its own generator', () => {
    const many = buildWorld(base({ tasks: tasks(400) }))
    const count = (k: string) => many.earned.filter((p) => p.kind === k).length
    expect(count('house') + count('tree') + count('lamp')).toBe(400)
    expect(count('house')).toBeGreaterThan(200) // about 60%
    expect(count('tree')).toBeGreaterThan(70) // about 25%
    expect(count('lamp')).toBeGreaterThan(30) // about 15%
    for (const p of many.earned) {
      expect(p.variant).toBeGreaterThanOrEqual(0)
      expect(p.variant).toBeLessThanOrEqual(7)
      expect(Number.isInteger(p.variant)).toBe(true)
    }
    // A task's look depends only on the seed and its id, not on which other tasks exist.
    const alone = buildWorld(base({ tasks: [{ id: 't17', title: 'x', completedAt: 1 }] }))
    const from = many.earned.find((p) => p.id === 'task:t17')
    expect(alone.earned[0]).toMatchObject({ kind: from?.kind, variant: from?.variant })
    expect(buildWorld(base({ seed: 1, tasks: tasks(40) }))).not.toEqual(buildWorld(base({ seed: 2, tasks: tasks(40) })))
  })

  it('takes the first of two tasks with the same id, whatever the input order', () => {
    const a = { id: 'dup', title: 'Early', completedAt: 1000 }
    const b = { id: 'dup', title: 'Late', completedAt: 9000 }
    for (const list of [[a, b], [b, a]]) {
      const w = buildWorld(base({ tasks: list }))
      expect(w.earned).toHaveLength(1)
      expect(w.earned[0]?.earnedFrom).toBe('Finished "Early"')
    }
  })
})

describe('buildWorld: focus floors', () => {
  it('125 minutes is one block with two floors', () => {
    const w = buildWorld(base({ focusDays: [{ day: '2026-09-01', minutes: 125 }] }))
    const blocks = w.earned.filter((p) => p.kind === 'block')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ id: 'block:0', floors: 2, earnedFrom: '2 focus hours' })
    expect(blocks[0]?.earnedAt).toBe(at(2026, 8, 1, 12))
    expect(w.stats.floors).toBe(2)
  })

  it('under an hour builds nothing', () => {
    expect(buildWorld(base({ focusDays: [{ day: '2026-09-01', minutes: 59 }] })).earned).toEqual([])
  })

  it('one hour is "1 focus hour"', () => {
    const w = buildWorld(base({ focusDays: [{ day: '2026-09-01', minutes: 60 }] }))
    expect(w.earned[0]?.earnedFrom).toBe('1 focus hour')
  })

  it('six floors make a block and the seventh starts the next', () => {
    const w = buildWorld(
      base({
        focusDays: [
          { day: '2026-09-01', minutes: 300 },
          { day: '2026-09-02', minutes: 120 },
        ],
      }),
    )
    const blocks = w.earned.filter((p) => p.kind === 'block').sort((a, b) => a.id.localeCompare(b.id))
    expect(blocks.map((b) => [b.id, b.floors])).toEqual([
      ['block:0', 6],
      ['block:1', 1],
    ])
    // Block 0 is finished on the 2nd (its sixth floor came with the 360th minute).
    expect(blocks[0]?.earnedAt).toBe(at(2026, 8, 2, 12))
    expect(blocks[1]?.earnedAt).toBe(at(2026, 8, 2, 12))
    expect(w.stats.floors).toBe(7)
  })

  it('carries leftover minutes from day to day and sums repeated days', () => {
    const w = buildWorld(
      base({
        focusDays: [
          { day: '2026-09-02', minutes: 40 },
          { day: '2026-09-01', minutes: 40 },
          { day: '2026-09-02', minutes: 40 },
        ],
      }),
    )
    // 40 + 80 = 120 by the 2nd: two floors, both crossed on the 2nd.
    expect(w.earned[0]).toMatchObject({ floors: 2, earnedAt: at(2026, 8, 2, 12) })
  })

  it('keeps a block where it first appeared as floors are added', () => {
    const first = buildWorld(base({ focusDays: [{ day: '2026-09-01', minutes: 60 }] }))
    const later = buildWorld(base({ focusDays: [{ day: '2026-09-01', minutes: 60 }, { day: '2026-09-03', minutes: 180 }] }))
    expect(later.earned[0]).toMatchObject({ id: 'block:0', floors: 4, x: first.earned[0]?.x, y: first.earned[0]?.y })
  })
})

describe('buildWorld: labels and tooltips', () => {
  const course = (over: Partial<{ code: string | null; title: string }> = {}) => ({
    id: 'c1',
    code: 'C182' as string | null,
    title: 'Introduction to IT',
    completedAt: at(2026, 0, 2),
    goalTitle: 'B.S. Computer Science',
    ...over,
  })

  it('names a course by its code', () => {
    const w = buildWorld(base({ courses: [course()] }))
    expect(w.earned[0]).toMatchObject({
      kind: 'landmark',
      label: 'C182 Tower',
      earnedFrom: 'Completed C182 Introduction to IT',
    })
  })

  it('names a course with no code by its title, cut at 22 characters', () => {
    const title = 'Scripting and Programming Foundations'
    const w = buildWorld(base({ courses: [course({ code: null, title })] }))
    expect(w.earned[0]?.label).toBe(`${truncate(title, 22)} Hall`)
    expect(w.earned[0]?.label).toBe('Scripting and Program… Hall')
    expect(w.earned[0]?.earnedFrom).toBe(`Completed ${title}`)
  })

  it('makes a degree a castle and any other goal a monument', () => {
    const w = buildWorld(
      base({
        goals: [
          { id: 'd', title: 'B.S. Computer Science', completedAt: at(2026, 0, 5), kind: 'degree' },
          { id: 'c', title: 'CompTIA A+', completedAt: at(2026, 0, 4), kind: 'certification' },
          { id: 's', title: 'Learn SQL', completedAt: at(2026, 0, 3), kind: 'skill' },
          { id: 'x', title: 'Read 20 books', completedAt: at(2026, 0, 2), kind: 'custom' },
        ],
      }),
    )
    const byId = new Map(w.earned.map((p) => [p.id, p]))
    expect(byId.get('goal:d')).toMatchObject({ kind: 'castle', w: 3, h: 3, label: 'B.S. Computer Science', earnedFrom: 'Reached goal: B.S. Computer Science' })
    expect(byId.get('goal:c')).toMatchObject({ kind: 'monument', w: 2, h: 2, label: 'CompTIA A+' })
    expect(byId.get('goal:s')?.kind).toBe('monument')
    expect(byId.get('goal:x')?.kind).toBe('monument')
    expect(w.stats.landmarks).toBe(4)
  })

  it('cuts long goal titles at 26 characters with an ellipsis', () => {
    const title = 'Bachelor of Science in Computer Science and Engineering'
    const w = buildWorld(base({ goals: [{ id: 'd', title, completedAt: 1, kind: 'degree' }] }))
    expect(w.earned[0]?.label).toHaveLength(26)
    expect(w.earned[0]?.label?.endsWith('…')).toBe(true)
  })

  it('says what a task was, and its goal when it has one', () => {
    const w = buildWorld(
      base({
        tasks: [
          { id: 'a', title: 'Read chapter 4', completedAt: 1, goalTitle: 'B.S. Computer Science' },
          { id: 'b', title: 'Buy a mouse', completedAt: 2, goalTitle: null },
        ],
      }),
    )
    const byId = new Map(w.earned.map((p) => [p.id, p]))
    expect(byId.get('task:a')).toMatchObject({ earnedFrom: 'Finished "Read chapter 4" · B.S. Computer Science', label: null, earnedAt: 1 })
    expect(byId.get('task:b')?.earnedFrom).toBe('Finished "Buy a mouse"')
  })
})

describe('buildWorld: stats', () => {
  it('counts tiles, floors, landmarks and the streak level', () => {
    const w = buildWorld(
      base({
        tasks: tasks(5),
        focusDays: [{ day: '2026-09-01', minutes: 200 }],
        courses: [{ id: 'c', code: 'C1', title: 'T', completedAt: 5, goalTitle: 'G' }],
        streakDays: 14,
      }),
    )
    expect(w.stats).toEqual({ tiles: 5, floors: 3, landmarks: 1, streakLevel: 3 })
    for (const [days, level] of [[0, 0], [2, 0], [3, 1], [6, 1], [7, 2], [13, 2], [14, 3], [29, 3], [30, 4], [400, 4]] as const) {
      expect(buildWorld(base({ streakDays: days })).stats.streakLevel).toBe(level)
    }
  })
})

describe('buildWorld: determinism, stability, order', () => {
  const big = (): WorldInput =>
    base({
      tasks: tasks(40),
      courses: [1, 2, 3].map((i) => ({ id: `c${i}`, code: `C${i}00`, title: `Course ${i}`, completedAt: at(2026, 0, 1, 8) + i * 7_200_000, goalTitle: 'G' })),
      focusDays: Array.from({ length: 6 }, (_, i) => ({ day: day(i), minutes: 90 })),
    })

  it('is deterministic', () => {
    expect(buildWorld(big())).toEqual(buildWorld(big()))
  })

  it('is append-stable: what was earned before never moves', () => {
    const before = buildWorld(big())
    const input = big()
    const after = buildWorld({
      ...input,
      tasks: [...input.tasks, ...tasks(25, 100).map((t) => ({ ...t, completedAt: at(2026, 5, 1) + Number(t.id.slice(1)) * 60_000 }))],
      courses: [...input.courses, { id: 'c9', code: 'C999', title: 'Later', completedAt: at(2026, 5, 2), goalTitle: 'G' }],
      goals: [{ id: 'deg', title: 'B.S. Computer Science', completedAt: at(2026, 5, 3), kind: 'degree' }],
      focusDays: [...input.focusDays, { day: '2026-07-01', minutes: 400 }, { day: '2026-07-02', minutes: 400 }],
    })
    expect(after.earned.length).toBeGreaterThan(before.earned.length + 25)
    const now = new Map(after.earned.map((p) => [p.id, p]))
    for (const p of before.earned) {
      const q = now.get(p.id)
      expect(q, p.id).toBeDefined()
      expect({ x: q?.x, y: q?.y, w: q?.w, h: q?.h, kind: q?.kind, variant: q?.variant }).toEqual({
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
        kind: p.kind,
        variant: p.variant,
      })
    }
  })

  it('does not depend on the order of the input arrays', () => {
    const rng = mulberry32(99)
    const shuffle = <T,>(list: readonly T[]): T[] => {
      const out = [...list]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1))
        const a = out[i]
        const b = out[j]
        if (a !== undefined && b !== undefined) {
          out[i] = b
          out[j] = a
        }
      }
      return out
    }
    const input = { ...big(), goals: [{ id: 'g', title: 'G', completedAt: at(2026, 3, 1), kind: 'degree' as const }] }
    const expected = buildWorld(input)
    for (let i = 0; i < 5; i++) {
      const shuffled: WorldInput = {
        ...input,
        tasks: shuffle(input.tasks),
        courses: shuffle(input.courses),
        focusDays: shuffle(input.focusDays),
      }
      expect(buildWorld(shuffled)).toEqual(expected)
    }
  })

  it('sorts both lists back to front', () => {
    const w = buildWorld(big())
    for (const list of [w.earned, w.scenery]) {
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1]
        const b = list[i]
        if (a && b) expect(compareDepth(a, b)).toBeLessThanOrEqual(0)
      }
    }
  })

  it('builds 2,000 items and their scenery well within a frame budget', () => {
    const start = performance.now()
    const w = buildWorld(base({ tasks: tasks(2000) }))
    const ms = performance.now() - start
    expect(w.earned).toHaveLength(2000)
    expect(ms).toBeLessThan(1500)
  })
})

describe('buildWorld: nothing overlaps (property test)', () => {
  it('holds for 300 random histories', () => {
    const rng = mulberry32(2026)
    const int = (n: number) => Math.floor(rng() * n)
    const problems: string[] = []
    const slots = new Set(SLOT_OFFSETS.map(([x, y]) => `${x}:${y}`))
    for (let run = 0; run < 300; run++) {
      const input: WorldInput = {
        seed: int(100000),
        tasks: Array.from({ length: int(45) }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, completedAt: int(1_000_000) * 1000 })),
        courses: Array.from({ length: int(5) }, (_, i) => ({ id: `c${i}`, code: rng() < 0.5 ? `C${100 + i}` : null, title: `Course ${i}`, completedAt: int(1_000_000) * 1000, goalTitle: 'G' })),
        goals: Array.from({ length: int(4) }, (_, i) => ({ id: `g${i}`, title: `Goal ${i}`, completedAt: int(1_000_000) * 1000, kind: (['degree', 'certification', 'skill', 'custom'] as const)[int(4)] ?? 'custom' })),
        focusDays: Array.from({ length: int(30) }, () => ({ day: day(int(200)), minutes: int(400) })),
        streakDays: int(40),
      }
      const w = buildWorld(input)
      const bad = (msg: string) => problems.push(`run ${run}: ${msg}`)

      const taken = new Map<string, string>()
      for (const p of w.earned) {
        for (const c of cells(p)) {
          const other = taken.get(c)
          if (other !== undefined) bad(`${p.id} overlaps ${other} at ${c}`)
          taken.set(c, p.id)
          const [cx, cy] = c.split(':').map(Number)
          if (mod(cx ?? 0, PLOT_PERIOD) === 4 || mod(cy ?? 0, PLOT_PERIOD) === 4) bad(`${p.id} is on a road cell ${c}`)
        }
      }
      const grass = new Set(w.scenery.filter((p) => p.kind === 'grass').map((p) => `${p.x}:${p.y}`))
      for (const c of taken.keys()) if (!grass.has(c)) bad(`${c} is not on grass`)

      for (const d of w.scenery.filter((p) => p.kind === 'decor')) {
        if (taken.has(`${d.x}:${d.y}`)) bad(`decor ${d.id} is on an earned cell`)
        if (slots.has(`${mod(d.x, PLOT_PERIOD)}:${mod(d.y, PLOT_PERIOD)}`)) bad(`decor ${d.id} is on a slot`)
      }
      if (new Set(w.scenery.map((p) => p.id)).size !== w.scenery.length) bad('duplicate scenery ids')
      for (const r of w.scenery.filter((p) => p.kind === 'road')) {
        if (!(mod(r.x, PLOT_PERIOD) === 4 || mod(r.y, PLOT_PERIOD) === 4)) bad(`${r.id} is not on a road line`)
        if (grass.has(`${r.x}:${r.y}`)) bad(`${r.id} is on grass`)
      }
      for (const p of [...w.earned, ...w.scenery]) {
        if (p.x < w.bounds.minX || p.y < w.bounds.minY || p.x + p.w - 1 > w.bounds.maxX || p.y + p.h - 1 > w.bounds.maxY) {
          bad(`${p.id} is outside the bounds`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})

describe('buildWorld: scenery', () => {
  it('draws roads only next to plots, encoding their direction', () => {
    const w = buildWorld(base({ tasks: tasks(1) }))
    const roads = new Map(w.scenery.filter((p) => p.kind === 'road').map((p) => [`${p.x}:${p.y}`, p.variant]))
    expect(roads.size).toBe(20)
    expect(roads.get('4:0')).toBe(1) // beside the plot, along y
    expect(roads.get('0:4')).toBe(0) // below it, along x
    expect(roads.get('4:4')).toBe(2) // the crossing
    expect(roads.get('-1:-1')).toBe(2)
    expect(roads.has('9:0')).toBe(false) // nothing beyond the ring
    expect(roads.has('5:2')).toBe(false)
  })

  it('shares the road between neighbouring plots', () => {
    const w = buildWorld(base({ tasks: tasks(9) })) // plots (0,0) and (1,0)
    expect(w.scenery.filter((p) => p.kind === 'grass')).toHaveLength(32)
    expect(w.scenery.filter((p) => p.kind === 'road')).toHaveLength(20 + 20 - 6)
    expect(w.bounds).toEqual({ minX: -1, minY: -1, maxX: 9, maxY: 4 })
  })

  it('puts at most two shrubs on a plot', () => {
    const w = buildWorld(base({ tasks: tasks(80) }))
    const perPlot = new Map<string, number>()
    for (const d of w.scenery.filter((p) => p.kind === 'decor')) {
      const key = `${Math.floor(d.x / 5)},${Math.floor(d.y / 5)}`
      perPlot.set(key, (perPlot.get(key) ?? 0) + 1)
    }
    for (const n of perPlot.values()) expect(n).toBeLessThanOrEqual(2)
    expect(perPlot.size).toBeGreaterThan(0)
  })

  it('never marks scenery as earned', () => {
    for (const p of buildWorld(base({ tasks: tasks(12) })).scenery) {
      expect(p.earnedFrom).toBeNull()
      expect(p.earnedAt).toBeNull()
      expect(p.label).toBeNull()
    }
  })
})
