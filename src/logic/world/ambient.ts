import { hash32 } from './hash'
import { int, mulberry32 } from './prng'
import type { WorldModel } from './types'

/**
 * The small things that move: people on the roads (streak of 7 days), birds (14 days) and, at 30 days,
 * a fountain and the odd firework. All of it is a pure function of time, so the renderer only asks
 * "where is everyone at time t" and nothing needs to be stored or stepped.
 */

/** A person's speed along the road, in art pixels per second at zoom 1. */
export const WALK_SPEED_PX = 6
/** Screen length of one cell step along a road (the 2:1 diagonal). */
const CELL_STEP_PX = Math.hypot(16, 8)
const CELLS_PER_SECOND = WALK_SPEED_PX / CELL_STEP_PX

export const MAX_WALKERS = 12

export interface Walker {
  index: number
  /** Centre of the first and last road cell of the run, in cell coordinates. */
  from: { x: number; y: number }
  to: { x: number; y: number }
  /** Seconds into the walk they start at, so people are not in step. */
  offset: number
  /** A hue name from the palette. */
  hue: 'gray' | 'brown' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink' | 'red'
}

const WALKER_HUES: readonly Walker['hue'][] = ['blue', 'brown', 'green', 'pink', 'purple', 'orange', 'gray', 'red']

/** How many people walk: none before a 7-day streak, then a fifth of the tiles, at most twelve. */
export function walkerCount(model: WorldModel): number {
  if (model.stats.streakLevel < 2) return 0
  return Math.min(MAX_WALKERS, Math.floor(model.stats.tiles / 5))
}

/** The longest straight run of road cells through `(x, y)` along one axis, as its two end cells. */
function runThrough(
  roads: ReadonlySet<string>,
  x: number,
  y: number,
  dx: number,
  dy: number,
): { a: { x: number; y: number }; b: { x: number; y: number } } {
  const has = (cx: number, cy: number) => roads.has(`${cx}:${cy}`)
  let a = { x, y }
  let b = { x, y }
  while (has(a.x - dx, a.y - dy)) a = { x: a.x - dx, y: a.y - dy }
  while (has(b.x + dx, b.y + dy)) b = { x: b.x + dx, y: b.y + dy }
  return { a, b }
}

const runLength = (r: { a: { x: number; y: number }; b: { x: number; y: number } }): number =>
  Math.abs(r.b.x - r.a.x) + Math.abs(r.b.y - r.a.y) + 1

/** The walkers of a model: seeded routes along straight stretches of road. */
export function planWalkers(model: WorldModel): Walker[] {
  const count = walkerCount(model)
  if (count === 0) return []
  const roads = model.scenery.filter((p) => p.kind === 'road')
  if (roads.length === 0) return []
  const set = new Set(roads.map((r) => `${r.x}:${r.y}`))
  const walkers: Walker[] = []
  for (let i = 0; i < count; i++) {
    const rng = mulberry32(hash32(`walker:${i}`))
    const start = roads[int(rng, 0, roads.length - 1)]
    if (!start) continue
    const alongX = runThrough(set, start.x, start.y, 1, 0)
    const alongY = runThrough(set, start.x, start.y, 0, 1)
    const run = runLength(alongX) >= runLength(alongY) ? alongX : alongY
    if (runLength(run) < 3) continue
    walkers.push({
      index: i,
      from: { x: run.a.x + 0.5, y: run.a.y + 0.5 },
      to: { x: run.b.x + 0.5, y: run.b.y + 0.5 },
      offset: rng() * 100,
      hue: WALKER_HUES[i % WALKER_HUES.length] ?? 'blue',
    })
  }
  return walkers
}

export interface WalkerPose {
  /** Position in cell coordinates. */
  x: number
  y: number
  /** True while walking towards `to`. */
  forward: boolean
}

/** Where a walker is `seconds` into the animation: back and forth along the run. */
export function walkerAt(w: Walker, seconds: number): WalkerPose {
  const length = Math.hypot(w.to.x - w.from.x, w.to.y - w.from.y)
  if (length === 0) return { x: w.from.x, y: w.from.y, forward: true }
  const travelled = ((w.offset + seconds) * CELLS_PER_SECOND) % (2 * length)
  const forward = travelled < length
  const along = forward ? travelled : 2 * length - travelled
  const t = along / length
  return { x: w.from.x + (w.to.x - w.from.x) * t, y: w.from.y + (w.to.y - w.from.y) * t, forward }
}

// ─── Birds ──────────────────────────────────────────────────────────────────────────────────

export const BIRD_PERIOD_MS = 20_000
const BIRD_FLIGHT_MS = 14_000
const BIRDS = 2

export interface BirdPose {
  /** 0 at the left edge of the view, 1 at the right. */
  x: number
  /** 0 at the top of the view. Birds stay in the top fifth. */
  y: number
  /** Wings up or down: swaps every quarter second. */
  flap: 0 | 1
}

/** The birds in flight at `ms` (a bird crosses the sky about every 20 seconds). */
export function birdsAt(ms: number): BirdPose[] {
  const out: BirdPose[] = []
  for (let i = 0; i < BIRDS; i++) {
    const shifted = ms + i * 9_000
    const cycle = Math.floor(shifted / BIRD_PERIOD_MS)
    const local = shifted - cycle * BIRD_PERIOD_MS
    if (local >= BIRD_FLIGHT_MS) continue
    const rng = mulberry32(hash32(`bird:${i}:${cycle}`))
    const y = 0.05 + rng() * 0.15 + Math.sin((local / BIRD_FLIGHT_MS) * Math.PI * 2) * 0.01
    out.push({ x: local / BIRD_FLIGHT_MS, y, flap: Math.floor(ms / 250) % 2 === 0 ? 0 : 1 })
  }
  return out
}

// ─── Fireworks ──────────────────────────────────────────────────────────────────────────────

export const FIREWORK_MS = 1800
const SPARKS = 14

export interface FireworkBurst {
  /** 0 at the start, 1 at the end. */
  age: number
  /** Which colour of a small list to use. */
  colour: number
  /** Sideways and upward offset from the launch point, in art pixels, up to +-24. */
  dx: number
  dy: number
}

export interface Spark {
  dx: number
  dy: number
  alpha: number
}

/** One or two bursts a minute, at times that are the same for everyone at the same clock. */
export function firework(ms: number): FireworkBurst | null {
  const minute = Math.floor(ms / 60_000)
  for (const m of [minute, minute - 1]) {
    const rng = mulberry32(hash32(`firework:${m}`))
    const bursts = 1 + int(rng, 0, 1)
    for (let j = 0; j < bursts; j++) {
      const start = m * 60_000 + int(rng, 0, 60_000 - FIREWORK_MS - 1)
      const colour = int(rng, 0, 3)
      const dx = int(rng, -24, 24)
      const dy = int(rng, -16, 0)
      const age = (ms - start) / FIREWORK_MS
      if (age >= 0 && age < 1) return { age, colour, dx, dy }
    }
  }
  return null
}

/** The sparks of a burst at its age: an expanding ring that slows, sinks a little and fades. */
export function sparksOf(burst: FireworkBurst): Spark[] {
  const ease = 1 - (1 - burst.age) ** 2
  const radius = 26 * ease
  const sag = 10 * burst.age * burst.age
  const alpha = Math.max(0, 1 - burst.age ** 2)
  const sparks: Spark[] = []
  for (let k = 0; k < SPARKS; k++) {
    const angle = (k / SPARKS) * Math.PI * 2 + burst.colour * 0.2
    sparks.push({ dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius * 0.85 + sag, alpha })
  }
  return sparks
}

/** Frame of the fountain's water (0..3), four a second. */
export function fountainFrame(ms: number): number {
  return Math.floor(ms / 250) % 4
}
