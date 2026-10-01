import type { Bounds, Kind, Placed, WorldModel } from './types'

/**
 * Isometric maths (2:1). Everything is in "art pixels" at zoom 1; pass `zoom` (or any positive scale,
 * such as device pixels per art pixel) to scale. Screen `y` grows downward; the top corner of cell
 * `(x, y)` is at `((x - y) * 16, (x + y) * 8)`. Cells with a greater `x + y` are nearer the viewer.
 */
export const TILE_W = 32
export const TILE_H = 16
/** Height of one building floor. */
export const FLOOR_PX = 10
/** How far the ground drops below the edge cells (the soil under the world). */
export const SOIL_PX = 4
/** Extra pixels around a sprite box for its outline. */
export const SPRITE_PAD = 2

export interface Point {
  x: number
  y: number
}

export interface ScreenPoint {
  sx: number
  sy: number
}

/** A rectangle in screen space: `x`/`y` is the top-left. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The screen position of a cell's top corner. */
export function toScreen(x: number, y: number, zoom = 1): ScreenPoint {
  return { sx: ((x - y) * TILE_W * zoom) / 2, sy: ((x + y) * TILE_H * zoom) / 2 }
}

/** Fractional grid coordinates under a screen point (the inverse of `toScreen`). */
export function toGridExact(sx: number, sy: number, zoom = 1): Point {
  const cx = sx / zoom / (TILE_W / 2)
  const cy = sy / zoom / (TILE_H / 2)
  return { x: (cy + cx) / 2, y: (cy - cx) / 2 }
}

/** The cell under a screen point. A cell's top corner maps back to that cell. */
export function toGrid(sx: number, sy: number, zoom = 1): Point {
  const g = toGridExact(sx, sy, zoom)
  return { x: Math.floor(g.x + 1e-9), y: Math.floor(g.y + 1e-9) }
}

type Footprint = Pick<Placed, 'x' | 'y' | 'w' | 'h'>

/** The four corners of a footprint's diamond: top, right, bottom, left. */
export function footprintPolygon(p: Footprint, zoom = 1): [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] {
  return [
    toScreen(p.x, p.y, zoom),
    toScreen(p.x + p.w, p.y, zoom),
    toScreen(p.x + p.w, p.y + p.h, zoom),
    toScreen(p.x, p.y + p.h, zoom),
  ]
}

/**
 * How far each sprite reaches above its footprint's top corner, in art pixels at zoom 1 (blocks add
 * their floors). The sprite painters keep inside these numbers (a test checks it), so hit-testing and
 * culling can trust them.
 */
const SPRITE_HEIGHT: Record<Kind, number> = {
  grass: 0,
  road: 0,
  decor: 2,
  lamp: 8,
  tree: 8,
  house: 20,
  block: 3,
  monument: 17,
  landmark: 43,
  castle: 27,
}

/** Sprite height above the footprint's top corner, at zoom 1. */
export function spriteHeight(p: Pick<Placed, 'kind' | 'floors'>): number {
  return SPRITE_HEIGHT[p.kind] + (p.kind === 'block' ? p.floors * FLOOR_PX : 0)
}

/**
 * The on-screen rectangle of an item at `zoom`, footprint and height included, with a little room
 * for its outline. Used for hit-testing and culling.
 */
export function spriteBox(p: Placed, zoom = 1): Box {
  const [top, right, bottom, left] = footprintPolygon(p, zoom)
  const pad = SPRITE_PAD * zoom
  const height = spriteHeight(p) * zoom
  return {
    x: left.sx - pad,
    y: top.sy - height - pad,
    w: right.sx - left.sx + 2 * pad,
    h: bottom.sy - top.sy + height + 2 * pad,
  }
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export function pointInBox(box: Box, sx: number, sy: number): boolean {
  return sx >= box.x && sx < box.x + box.w && sy >= box.y && sy < box.y + box.h
}

/** Whether a screen point is inside the footprint diamond of `p` (edges count). */
export function pointInFootprint(p: Footprint, sx: number, sy: number, zoom = 1): boolean {
  const [top, right, bottom, left] = footprintPolygon(p, zoom)
  const cx = top.sx
  const cy = (top.sy + bottom.sy) / 2
  const halfW = (right.sx - left.sx) / 2
  const halfH = (bottom.sy - top.sy) / 2
  if (halfW === 0 || halfH === 0) return false
  return Math.abs(sx - cx) / halfW + Math.abs(sy - cy) / halfH <= 1
}

/**
 * Whether a screen point hits the sprite of `p`: inside its box, and, in the lower half where the
 * building meets the ground, inside the footprint diamond too (so the empty corners beside a house
 * do not count).
 */
export function hitsSprite(p: Placed, sx: number, sy: number, zoom = 1): boolean {
  if (!pointInBox(spriteBox(p, zoom), sx, sy)) return false
  const [top, , bottom] = footprintPolygon(p, zoom)
  const middle = (top.sy + bottom.sy) / 2
  return sy < middle || pointInFootprint(p, sx, sy, zoom)
}

// ─── Depth ──────────────────────────────────────────────────────────────────────────────────

/** Back to front: earlier kinds are drawn first at equal depth. */
export const KIND_ORDER: readonly Kind[] = [
  'grass',
  'road',
  'decor',
  'lamp',
  'tree',
  'house',
  'block',
  'monument',
  'landmark',
  'castle',
]

const KIND_RANK: Record<Kind, number> = Object.fromEntries(
  KIND_ORDER.map((k, i) => [k, i]),
) as Record<Kind, number>

/** `(x + w - 1) + (y + h - 1)`: the depth of an item's nearest cell. */
export function depthKey(p: Footprint): number {
  return p.x + p.w - 1 + (p.y + p.h - 1)
}

/**
 * Draw order, back to front: nearest-cell depth, then `x + y`, then kind, then id (plain string
 * comparison, so the order never depends on the locale).
 */
export function compareDepth(a: Placed, b: Placed): number {
  const d = depthKey(a) - depthKey(b)
  if (d !== 0) return d
  const s = a.x + a.y - (b.x + b.y)
  if (s !== 0) return s
  const k = KIND_RANK[a.kind] - KIND_RANK[b.kind]
  if (k !== 0) return k
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortByDepth(items: readonly Placed[]): Placed[] {
  return [...items].sort(compareDepth)
}

// ─── Extent ─────────────────────────────────────────────────────────────────────────────────

/** A rectangle in art pixels (zoom 1) as edges. */
export interface Extent {
  left: number
  top: number
  right: number
  bottom: number
}

/** The screen extent of a range of cells, ground only. */
export function boundsExtent(b: Bounds): Extent {
  return {
    left: (b.minX - (b.maxY + 1)) * (TILE_W / 2),
    right: (b.maxX + 1 - b.minY) * (TILE_W / 2),
    top: (b.minX + b.minY) * (TILE_H / 2),
    bottom: (b.maxX + 1 + b.maxY + 1) * (TILE_H / 2) + SOIL_PX,
  }
}

/** Everything the model draws (ground, soil and the tallest sprites), in art pixels at zoom 1. */
export function modelExtent(model: WorldModel): Extent {
  const e = boundsExtent(model.bounds)
  for (const p of model.earned) {
    const box = spriteBox(p, 1)
    if (box.x < e.left) e.left = box.x
    if (box.y < e.top) e.top = box.y
    if (box.x + box.w > e.right) e.right = box.x + box.w
    if (box.y + box.h > e.bottom) e.bottom = box.y + box.h
  }
  return e
}
