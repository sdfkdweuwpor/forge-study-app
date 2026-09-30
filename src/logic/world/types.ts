/**
 * Shared types of the My World engine (BRIEF §5.6). Pure data: nothing here touches the DOM,
 * a canvas or the database. `WorldInput` is what the app reads from its tables; `WorldModel` is what
 * `buildWorld` returns and the renderer draws.
 */
export type ISODate = string // 'YYYY-MM-DD' (local date)
export type Theme = 'light' | 'dark'

export interface WorldInput {
  seed: number // constant per user, e.g. 1337
  tasks: readonly { id: string; title: string; completedAt: number; goalTitle?: string | null }[]
  focusDays: readonly { day: ISODate; minutes: number }[] // counted focus minutes per local day
  courses: readonly {
    id: string
    code: string | null
    title: string
    completedAt: number
    goalTitle: string
  }[]
  goals: readonly {
    id: string
    title: string
    completedAt: number
    kind: 'degree' | 'certification' | 'skill' | 'custom'
  }[]
  streakDays: number // current streak length, 0 if none
}

export type Kind =
  | 'house'
  | 'tree'
  | 'lamp' // 1×1, earned by tasks
  | 'block' // 1×1 tall building, earned by focus hours (floors)
  | 'landmark' // 2×2, earned by a finished course
  | 'monument' // 2×2, earned by a finished non-degree goal
  | 'castle' // 3×3, earned by a finished degree goal
  | 'road'
  | 'grass'
  | 'decor' // scenery, not earned

export interface Placed {
  /** Stable: 'task:<taskId>', 'block:<n>', 'course:<id>', 'goal:<id>', 'road:<x>:<y>', 'grass:<x>:<y>', 'decor:<x>:<y>'. */
  id: string
  kind: Kind
  /** Grid cell of the footprint's top-left (integers, may be negative). */
  x: number
  y: number
  /** Footprint in cells. */
  w: number
  h: number
  /** 0 except 'block' (1..6) and landmark/castle/monument (fixed art heights: 4/5/2). */
  floors: number
  /** 0..7 seeded variety. */
  variant: number
  /** E.g. 'C182 Tower'. */
  label: string | null
  /** Tooltip text, e.g. 'Finished "Read chapter 4"'. */
  earnedFrom: string | null
  /** Epoch ms. */
  earnedAt: number | null
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface WorldStats {
  tiles: number
  floors: number
  landmarks: number
  streakLevel: 0 | 1 | 2 | 3 | 4
}

export interface WorldModel {
  /** Houses, trees, lamps, blocks, landmarks, monuments, castles (depth-sorted back to front). */
  earned: readonly Placed[]
  /** Grass, roads, decor (depth-sorted back to front). */
  scenery: readonly Placed[]
  /** In cells, inclusive, covers all allocated plots and the road ring around them. */
  bounds: Bounds
  stats: WorldStats
}

/** Kinds that a person earns (as opposed to scenery). */
export type EarnedKind = Exclude<Kind, 'road' | 'grass' | 'decor'>

export const EARNED_KINDS: readonly EarnedKind[] = [
  'house',
  'tree',
  'lamp',
  'block',
  'landmark',
  'monument',
  'castle',
]

export function isEarnedKind(kind: Kind): kind is EarnedKind {
  return kind !== 'road' && kind !== 'grass' && kind !== 'decor'
}
