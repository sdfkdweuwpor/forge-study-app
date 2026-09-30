import { sortByDepth } from './iso'
import { hash32, rngFor } from './hash'
import { int } from './prng'
import { spiral } from './spiral'
import type { Bounds, Kind, Placed, WorldInput, WorldModel, WorldStats } from './types'

/**
 * The layout of the city, from the history alone. Deterministic (the same input always gives the same
 * model, whatever order the arrays come in) and append-stable (items earned later never move the ones
 * before them).
 *
 * The world is a grid of 4x4-cell plots with 1-cell roads between them (period 5), handed out in
 * square-spiral order from the centre. Small items (house, tree, lamp, block) fill the current
 * "small plot" through 8 slots; a landmark, monument or castle takes a plot of its own.
 */

/** Cells along a plot's side, and the period of the plot grid (a plot plus its road). */
export const PLOT_SIZE = 4
export const PLOT_PERIOD = 5

/** Where small items go inside a plot, in the order they fill it. A checkerboard, so roofs never touch. */
export const SLOT_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [2, 0],
  [0, 2],
  [2, 2],
  [1, 3],
  [3, 1],
  [3, 3],
  [1, 1],
]

/** Where a 2x2 landmark or monument stands in its plot, and a 3x3 castle. */
export const LARGE_OFFSET = { landmark: [1, 1], monument: [1, 1], castle: [0, 0] } as const

/** Focus minutes that build one floor, and how many floors a block of flats has. */
const MINUTES_PER_FLOOR = 60
export const FLOORS_PER_BLOCK = 6

export interface BuildOptions {
  /**
   * Lays out at least this many plots of ground even when nothing has been earned (`buildWorld` with
   * no history is empty by default). The app asks for one, so a new user still sees a plot of grass.
   */
  minPlots?: number
}

// ─── Events ─────────────────────────────────────────────────────────────────────────────────

type Earn =
  | { id: string; at: number; type: 'task'; title: string; goalTitle: string | null }
  | { id: string; at: number; type: 'course'; code: string | null; title: string }
  | { id: string; at: number; type: 'goal'; title: string; kind: 'degree' | 'certification' | 'skill' | 'custom' }
  | { id: string; at: number; type: 'block' }

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Local noon of a `YYYY-MM-DD` day, or null for anything else. */
function noonOf(day: string): number | null {
  const m = ISO_DAY.exec(day)
  if (!m) return null
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime()
  return Number.isFinite(at) ? at : null
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** A stable text for tie-breaks between two events with the same time and id. */
function tieText(e: Earn): string {
  switch (e.type) {
    case 'task':
      return `${e.title}\u0000${e.goalTitle ?? ''}`
    case 'course':
      return `${e.code ?? ''}\u0000${e.title}`
    case 'goal':
      return `${e.kind}\u0000${e.title}`
    case 'block':
      return ''
  }
}

function compareEvents(a: Earn, b: Earn): number {
  return a.at - b.at || compareText(a.id, b.id) || compareText(tieText(a), tieText(b))
}

interface FloorBlock {
  firstAt: number
  lastAt: number
  floors: number
}

/**
 * Focus floors: minutes add up day by day, and every whole hour builds a floor at local noon of the day
 * it was crossed. Six floors make a block. Returns the blocks in order.
 */
function focusBlocks(days: WorldInput['focusDays']): FloorBlock[] {
  const perDay = new Map<string, number>()
  for (const d of days) {
    if (!Number.isFinite(d.minutes) || d.minutes <= 0) continue
    if (noonOf(d.day) === null) continue
    perDay.set(d.day, (perDay.get(d.day) ?? 0) + d.minutes)
  }
  const blocks: FloorBlock[] = []
  let total = 0
  let floors = 0
  for (const day of [...perDay.keys()].sort(compareText)) {
    total += perDay.get(day) ?? 0
    const at = noonOf(day)
    if (at === null) continue
    while (total + 1e-9 >= (floors + 1) * MINUTES_PER_FLOOR) {
      const b = Math.floor(floors / FLOORS_PER_BLOCK)
      const block = blocks[b]
      if (block) {
        block.floors += 1
        block.lastAt = at
      } else {
        blocks[b] = { firstAt: at, lastAt: at, floors: 1 }
      }
      floors += 1
    }
  }
  return blocks
}

function earnEvents(input: WorldInput): Earn[] {
  const all: Earn[] = []
  for (const t of input.tasks) {
    if (typeof t.id !== 'string' || !Number.isFinite(t.completedAt)) continue
    all.push({
      id: `task:${t.id}`,
      at: t.completedAt,
      type: 'task',
      title: t.title,
      goalTitle: t.goalTitle ?? null,
    })
  }
  for (const c of input.courses) {
    if (typeof c.id !== 'string' || !Number.isFinite(c.completedAt)) continue
    all.push({ id: `course:${c.id}`, at: c.completedAt, type: 'course', code: c.code, title: c.title })
  }
  for (const g of input.goals) {
    if (typeof g.id !== 'string' || !Number.isFinite(g.completedAt)) continue
    all.push({ id: `goal:${g.id}`, at: g.completedAt, type: 'goal', title: g.title, kind: g.kind })
  }
  focusBlocks(input.focusDays).forEach((block, b) => {
    all.push({ id: `block:${b}`, at: block.firstAt, type: 'block' })
  })
  all.sort(compareEvents)
  // The same id twice: the first in time order wins (the sort makes "first" independent of input order).
  const seen = new Set<string>()
  return all.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
}

// ─── Labels ─────────────────────────────────────────────────────────────────────────────────

export function truncate(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// ─── Layout ─────────────────────────────────────────────────────────────────────────────────

export function streakLevelOf(days: number): WorldStats['streakLevel'] {
  return days >= 30 ? 4 : days >= 14 ? 3 : days >= 7 ? 2 : days >= 3 ? 1 : 0
}

const mod = (n: number, m: number): number => ((n % m) + m) % m

interface Plot {
  px: number
  py: number
  /** Cells taken by a large item, relative to the plot. */
  large: { x: number; y: number; size: number } | null
}

function placed(
  id: string,
  kind: Kind,
  x: number,
  y: number,
  size: number,
  extra: Partial<Placed> = {},
): Placed {
  return {
    id,
    kind,
    x: x + 0,
    y: y + 0,
    w: size,
    h: size,
    floors: 0,
    variant: 0,
    label: null,
    earnedFrom: null,
    earnedAt: null,
    ...extra,
  }
}

/** Small tile choice for a finished task: 60% house, 25% tree, 15% lamp. */
function taskKind(roll: number): 'house' | 'tree' | 'lamp' {
  return roll < 0.6 ? 'house' : roll < 0.85 ? 'tree' : 'lamp'
}

export function buildWorld(input: WorldInput, options: BuildOptions = {}): WorldModel {
  const { seed } = input
  const events = earnEvents(input)
  const blocks = focusBlocks(input.focusDays)

  const plots: Plot[] = []
  const allocate = (): Plot => {
    const { x, y } = spiral(plots.length)
    const plot: Plot = { px: x, py: y, large: null }
    plots.push(plot)
    return plot
  }

  const earned: Placed[] = []
  let smallPlot: Plot | null = null
  let smallSlot = SLOT_OFFSETS.length

  const nextSmall = (): { x: number; y: number } => {
    if (smallPlot === null || smallSlot >= SLOT_OFFSETS.length) {
      smallPlot = allocate()
      smallSlot = 0
    }
    const off = SLOT_OFFSETS[smallSlot]
    smallSlot += 1
    if (!off) throw new Error('slot table is empty')
    return { x: smallPlot.px * PLOT_PERIOD + off[0], y: smallPlot.py * PLOT_PERIOD + off[1] }
  }

  for (const e of events) {
    const rng = rngFor(seed, e.id)
    if (e.type === 'task') {
      const kind = taskKind(rng())
      const at = nextSmall()
      earned.push(
        placed(e.id, kind, at.x, at.y, 1, {
          variant: int(rng, 0, 7),
          earnedFrom: `Finished "${e.title}"${e.goalTitle ? ` · ${e.goalTitle}` : ''}`,
          earnedAt: e.at,
        }),
      )
    } else if (e.type === 'block') {
      const at = nextSmall()
      const b = Number(e.id.slice('block:'.length))
      const block = blocks[b]
      const floors = block?.floors ?? 1
      earned.push(
        placed(e.id, 'block', at.x, at.y, 1, {
          floors,
          variant: int(rng, 0, 7),
          earnedFrom: plural(floors, 'focus hour'),
          earnedAt: block?.lastAt ?? e.at,
        }),
      )
    } else {
      const kind: Kind =
        e.type === 'course' ? 'landmark' : e.kind === 'degree' ? 'castle' : 'monument'
      const plot = allocate()
      const off = LARGE_OFFSET[kind === 'castle' ? 'castle' : 'landmark']
      const size = kind === 'castle' ? 3 : 2
      plot.large = { x: off[0], y: off[1], size }
      const floors = kind === 'castle' ? 5 : kind === 'landmark' ? 4 : 2
      const label =
        e.type === 'course'
          ? e.code
            ? `${e.code} Tower`
            : `${truncate(e.title, 22)} Hall`
          : truncate(e.title, 26)
      const earnedFrom =
        e.type === 'course'
          ? ['Completed', e.code, e.title].filter((s) => s !== null && s !== '').join(' ')
          : `Reached goal: ${e.title}`
      earned.push(
        placed(
          e.id,
          kind,
          plot.px * PLOT_PERIOD + off[0],
          plot.py * PLOT_PERIOD + off[1],
          size,
          { floors, variant: int(rng, 0, 7), label, earnedFrom, earnedAt: e.at },
        ),
      )
    }
  }

  // A brand-new world still shows the first plot of grass when the app asks for it.
  while (plots.length < (options.minPlots ?? 0)) allocate()

  const { scenery, bounds } = buildScenery(plots, seed)

  const tiles = earned.filter((p) => p.kind === 'house' || p.kind === 'tree' || p.kind === 'lamp')
  return {
    earned: sortByDepth(earned),
    scenery,
    bounds,
    stats: {
      tiles: tiles.length,
      floors: earned.reduce((sum, p) => sum + (p.kind === 'block' ? p.floors : 0), 0),
      landmarks: earned.filter(
        (p) => p.kind === 'landmark' || p.kind === 'monument' || p.kind === 'castle',
      ).length,
      streakLevel: streakLevelOf(input.streakDays),
    },
  }
}

/** Grass on every plot cell, roads around each plot, and 0-2 shrubs where no building will stand. */
function buildScenery(plots: readonly Plot[], seed: number): { scenery: Placed[]; bounds: Bounds } {
  if (plots.length === 0) {
    return { scenery: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }
  }
  const scenery: Placed[] = []
  const roads = new Map<string, Placed>()
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const slotKeys = new Set(SLOT_OFFSETS.map(([x, y]) => `${x}:${y}`))

  for (const plot of plots) {
    const ox = plot.px * PLOT_PERIOD
    const oy = plot.py * PLOT_PERIOD
    bounds.minX = Math.min(bounds.minX, ox - 1)
    bounds.minY = Math.min(bounds.minY, oy - 1)
    bounds.maxX = Math.max(bounds.maxX, ox + PLOT_SIZE)
    bounds.maxY = Math.max(bounds.maxY, oy + PLOT_SIZE)

    for (let dy = 0; dy < PLOT_SIZE; dy++) {
      for (let dx = 0; dx < PLOT_SIZE; dx++) {
        const id = `grass:${ox + dx}:${oy + dy}`
        scenery.push(placed(id, 'grass', ox + dx, oy + dy, 1, { variant: int(rngFor(seed, id), 0, 7) }))
      }
    }

    // The ring of road cells around the plot (every cell with x or y = 4 mod 5 next to a plot cell).
    for (let y = oy - 1; y <= oy + PLOT_SIZE; y++) {
      for (let x = ox - 1; x <= ox + PLOT_SIZE; x++) {
        const inside = x >= ox && x < ox + PLOT_SIZE && y >= oy && y < oy + PLOT_SIZE
        if (inside) continue
        const id = `road:${x}:${y}`
        if (roads.has(id)) continue
        const alongY = mod(x, PLOT_PERIOD) === PLOT_SIZE
        const alongX = mod(y, PLOT_PERIOD) === PLOT_SIZE
        roads.set(id, placed(id, 'road', x, y, 1, { variant: alongX && alongY ? 2 : alongY ? 1 : 0 }))
      }
    }

    // Shrubs: never on a slot and never inside a large footprint, so they cannot block a future tile.
    const free: [number, number][] = []
    for (let dy = 0; dy < PLOT_SIZE; dy++) {
      for (let dx = 0; dx < PLOT_SIZE; dx++) {
        if (slotKeys.has(`${dx}:${dy}`)) continue
        const l = plot.large
        if (l && dx >= l.x && dx < l.x + l.size && dy >= l.y && dy < l.y + l.size) continue
        free.push([dx, dy])
      }
    }
    const rng = rngFor(seed, `plot:${plot.px}:${plot.py}`)
    const count = Math.min(int(rng, 0, 2), free.length)
    for (let i = 0; i < count; i++) {
      const [dx, dy] = free.splice(int(rng, 0, free.length - 1), 1)[0] ?? [0, 0]
      scenery.push(placed(`decor:${ox + dx}:${oy + dy}`, 'decor', ox + dx, oy + dy, 1, { variant: int(rng, 0, 7) }))
    }
  }

  scenery.push(...roads.values())
  return { scenery: sortByDepth(scenery), bounds }
}

/** A stable short fingerprint of a model's layout, for change detection (not for security). */
export function layoutSignature(model: WorldModel): number {
  let h = 0
  for (const p of model.earned) {
    h = (Math.imul(h, 31) + hash32(`${p.id}|${p.x}|${p.y}|${p.kind}|${p.floors}|${p.variant}`)) | 0
  }
  return h >>> 0
}
