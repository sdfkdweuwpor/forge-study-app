import { describe, expect, it } from 'vitest'
import {
  BIRD_PERIOD_MS,
  FIREWORK_MS,
  MAX_WALKERS,
  birdsAt,
  firework,
  fountainFrame,
  planWalkers,
  sparksOf,
  walkerAt,
  walkerCount,
} from './ambient'
import { buildWorld } from './layout'
import type { WorldInput } from './types'

const input = (tasks: number, streakDays: number): WorldInput => ({
  seed: 1337,
  tasks: Array.from({ length: tasks }, (_, i) => ({ id: `t${i}`, title: `T${i}`, completedAt: i })),
  focusDays: [],
  courses: [],
  goals: [],
  streakDays,
})

describe('walkers', () => {
  it('appear from a 7-day streak, a fifth of the tiles, at most twelve', () => {
    expect(walkerCount(buildWorld(input(50, 6)))).toBe(0)
    expect(walkerCount(buildWorld(input(50, 7)))).toBe(10)
    expect(walkerCount(buildWorld(input(9, 7)))).toBe(1)
    expect(walkerCount(buildWorld(input(400, 30)))).toBe(MAX_WALKERS)
    expect(walkerCount(buildWorld(input(4, 30)))).toBe(0)
  })

  it('walk on straight stretches of road, and only there', () => {
    const world = buildWorld(input(60, 10))
    const roads = new Set(world.scenery.filter((s) => s.kind === 'road').map((s) => `${s.x}:${s.y}`))
    const walkers = planWalkers(world)
    expect(walkers.length).toBeGreaterThan(0)
    expect(walkers.length).toBeLessThanOrEqual(walkerCount(world))
    for (const w of walkers) {
      expect(w.from.x === w.to.x || w.from.y === w.to.y).toBe(true)
      for (const seconds of [0, 1, 7, 25.5, 133]) {
        const pose = walkerAt(w, seconds)
        // Every position lies on a road cell.
        expect(roads.has(`${Math.floor(pose.x)}:${Math.floor(pose.y)}`)).toBe(true)
      }
    }
  })

  it('is the same every time and moves about 6 px a second', () => {
    const world = buildWorld(input(60, 10))
    expect(planWalkers(world)).toEqual(planWalkers(world))
    const [w] = planWalkers(world)
    if (!w) throw new Error('no walker')
    const a = walkerAt(w, 10)
    const b = walkerAt(w, 11)
    // One cell along a road is about 17.9 px on screen at zoom 1.
    const cells = Math.hypot(b.x - a.x, b.y - a.y)
    expect(cells * Math.hypot(16, 8)).toBeGreaterThan(5)
    expect(cells * Math.hypot(16, 8)).toBeLessThan(7)
  })

  it('turns round at the ends of the road', () => {
    const [w] = planWalkers(buildWorld(input(60, 10)))
    if (!w) throw new Error('no walker')
    const seen = new Set<boolean>()
    for (let s = 0; s < 600; s += 3) seen.add(walkerAt(w, s).forward)
    expect(seen.size).toBe(2)
  })

  it('has nobody in a world without roads', () => {
    expect(planWalkers(buildWorld(input(0, 30)))).toEqual([])
  })
})

describe('birds', () => {
  it('cross the sky left to right every 20 seconds or so, high up', () => {
    let flights = 0
    let last = -1
    for (let ms = 0; ms < 3 * BIRD_PERIOD_MS; ms += 500) {
      const birds = birdsAt(ms)
      if (birds.length > 0) flights += 1
      for (const b of birds) {
        expect(b.x).toBeGreaterThanOrEqual(0)
        expect(b.x).toBeLessThan(1)
        expect(b.y).toBeGreaterThan(0)
        expect(b.y).toBeLessThan(0.25)
        expect([0, 1]).toContain(b.flap)
      }
      last = Math.max(last, birds.length)
    }
    expect(flights).toBeGreaterThan(20)
    expect(last).toBeGreaterThanOrEqual(1)
  })

  it('flap on a steady beat', () => {
    expect(birdsAt(0)[0]?.flap).toBe(0)
    expect(birdsAt(250)[0]?.flap).toBe(1)
  })
})

describe('fireworks', () => {
  it('fire one or two bursts a minute, each lasting under two seconds', () => {
    for (const minute of [10, 11, 12, 13]) {
      let active = 0
      for (let ms = minute * 60_000; ms < (minute + 1) * 60_000; ms += 100) {
        if (firework(ms) !== null) active += 1
      }
      // 1-2 bursts of 1.8 s each, sampled every 0.1 s (a burst that runs into the next minute counts there).
      expect(active).toBeGreaterThan(0)
      expect(active).toBeLessThanOrEqual(2 * (FIREWORK_MS / 100) + 2)
    }
  })

  it('has sparks that spread out and fade', () => {
    const early = sparksOf({ age: 0.1, colour: 0, dx: 0, dy: 0 })
    const late = sparksOf({ age: 0.9, colour: 0, dx: 0, dy: 0 })
    const spread = (s: typeof early) => Math.max(...s.map((p) => Math.hypot(p.dx, p.dy)))
    expect(spread(late)).toBeGreaterThan(spread(early))
    expect(late[0]?.alpha).toBeLessThan(early[0]?.alpha ?? 0)
    expect(early).toHaveLength(14)
  })

  it('animates the fountain in four frames', () => {
    expect([0, 250, 500, 750, 1000].map(fountainFrame)).toEqual([0, 1, 2, 3, 0])
  })
})
