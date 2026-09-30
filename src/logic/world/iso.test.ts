import { describe, expect, it } from 'vitest'
import {
  FLOOR_PX,
  KIND_ORDER,
  boundsExtent,
  compareDepth,
  depthKey,
  footprintPolygon,
  hitsSprite,
  modelExtent,
  pointInFootprint,
  sortByDepth,
  spriteBox,
  spriteHeight,
  toGrid,
  toGridExact,
  toScreen,
} from './iso'
import { buildWorld } from './layout'
import { mulberry32 } from './prng'
import type { Kind, Placed } from './types'

const item = (id: string, kind: Kind, x: number, y: number, size = 1, floors = 0): Placed => ({
  id,
  kind,
  x,
  y,
  w: size,
  h: size,
  floors,
  variant: 0,
  label: null,
  earnedFrom: null,
  earnedAt: null,
})

describe('projection', () => {
  it('puts the top corner of cell (x, y) at ((x - y) * 16, (x + y) * 8)', () => {
    expect(toScreen(0, 0)).toEqual({ sx: 0, sy: 0 })
    expect(toScreen(1, 0)).toEqual({ sx: 16, sy: 8 })
    expect(toScreen(0, 1)).toEqual({ sx: -16, sy: 8 })
    expect(toScreen(3, 1, 2)).toEqual({ sx: 64, sy: 64 })
  })

  it('round-trips 100 random cells at every zoom', () => {
    const rng = mulberry32(5)
    for (let i = 0; i < 100; i++) {
      const x = Math.floor(rng() * 400) - 200
      const y = Math.floor(rng() * 400) - 200
      const zoom = 1 + Math.floor(rng() * 4)
      const { sx, sy } = toScreen(x, y, zoom)
      expect(toGrid(sx, sy, zoom)).toEqual({ x, y })
      // The middle of the cell maps back to the same cell.
      expect(toGrid(sx, sy + (8 * zoom), zoom)).toEqual({ x, y })
      const exact = toGridExact(sx, sy, zoom)
      expect(exact.x).toBeCloseTo(x, 9)
      expect(exact.y).toBeCloseTo(y, 9)
    }
  })

  it('has a footprint diamond of top, right, bottom, left', () => {
    const [top, right, bottom, left] = footprintPolygon(item('a', 'landmark', 1, 1, 2))
    expect(top).toEqual({ sx: 0, sy: 16 })
    expect(right).toEqual({ sx: 32, sy: 32 })
    expect(bottom).toEqual({ sx: 0, sy: 48 })
    expect(left).toEqual({ sx: -32, sy: 32 })
  })

  it('tests points against the diamond', () => {
    const p = item('a', 'house', 0, 0)
    expect(pointInFootprint(p, 0, 8)).toBe(true)
    expect(pointInFootprint(p, 15, 8)).toBe(true)
    expect(pointInFootprint(p, 15, 1)).toBe(false)
    expect(pointInFootprint(p, 0, 17)).toBe(false)
  })
})

describe('spriteBox', () => {
  it('covers the footprint and the height above it, and scales with zoom', () => {
    const block = item('b', 'block', 0, 0, 1, 3)
    const one = spriteBox(block, 1)
    expect(spriteHeight(block)).toBeGreaterThanOrEqual(3 * FLOOR_PX)
    expect(one.x).toBeLessThan(-16)
    expect(one.x + one.w).toBeGreaterThan(16)
    expect(one.y).toBeLessThan(-3 * FLOOR_PX)
    expect(one.y + one.h).toBeGreaterThan(16)
    const two = spriteBox(block, 2)
    expect(two.h).toBe(one.h * 2)
    expect(two.w).toBe(one.w * 2)
  })

  it('grows with floors, and is taller for a landmark than a house', () => {
    expect(spriteHeight(item('a', 'block', 0, 0, 1, 6))).toBeGreaterThan(spriteHeight(item('a', 'block', 0, 0, 1, 1)))
    expect(spriteHeight(item('l', 'landmark', 0, 0, 2, 4))).toBeGreaterThan(spriteHeight(item('h', 'house', 0, 0)))
  })

  it('hits the roof and the ground diamond but not the empty corners', () => {
    const house = item('h', 'house', 0, 0)
    expect(hitsSprite(house, 0, -10)).toBe(true) // above the ground: the roof
    expect(hitsSprite(house, 0, 10)).toBe(true) // on the diamond
    expect(hitsSprite(house, 14, 14)).toBe(false) // beside the diamond's lower right edge
    expect(hitsSprite(house, 0, -60)).toBe(false)
  })
})

describe('depth order', () => {
  it('draws greater x + y after an item behind it that overlaps on screen', () => {
    const rng = mulberry32(8)
    for (let i = 0; i < 200; i++) {
      const x = Math.floor(rng() * 30) - 15
      const y = Math.floor(rng() * 30) - 15
      const behind = item('b', 'block', x, y, 1, 6)
      const front = item('f', 'house', x + 1 + Math.floor(rng() * 2), y + Math.floor(rng() * 2))
      // They overlap on screen when the front one sits within the back one's tall silhouette.
      expect(compareDepth(behind, front)).toBeLessThan(0)
      expect(compareDepth(front, behind)).toBeGreaterThan(0)
    }
  })

  it('sorts a big building by its nearest cell', () => {
    const castle = item('c', 'castle', 0, 0, 3, 5)
    expect(depthKey(castle)).toBe(4)
    expect(compareDepth(castle, item('front', 'house', 3, 3))).toBeLessThan(0)
    expect(compareDepth(castle, item('behind', 'house', -3, 0))).toBeGreaterThan(0)
  })

  it('breaks ties by x + y, then kind, then id', () => {
    const a = item('a', 'house', 2, 0)
    const b = item('b', 'house', 1, 1)
    // Same depth (2), b has x + y = 2 too: same. Use a taller footprint to split them.
    expect(compareDepth(a, b)).toBeLessThan(0) // id
    const big = item('z', 'landmark', 0, 0, 2) // depth 2, x + y = 0
    expect(compareDepth(big, a)).toBeLessThan(0) // x + y first
    const grass = item('g', 'grass', 3, 3)
    const tree = item('t', 'tree', 3, 3)
    const house = item('h', 'house', 3, 3)
    const castleAlike = item('c', 'block', 3, 3)
    expect(sortByDepth([castleAlike, house, tree, grass]).map((p) => p.kind)).toEqual(['grass', 'tree', 'house', 'block'])
  })

  it('orders the kinds as specified', () => {
    expect(KIND_ORDER).toEqual(['grass', 'road', 'decor', 'lamp', 'tree', 'house', 'block', 'monument', 'landmark', 'castle'])
    const same = KIND_ORDER.map((k) => item(k, k, 0, 0))
    expect(sortByDepth([...same].reverse()).map((p) => p.kind)).toEqual([...KIND_ORDER])
  })

  it('compares ids as plain strings, not by locale', () => {
    expect(compareDepth(item('B', 'house', 0, 0), item('a', 'house', 0, 0))).toBeLessThan(0)
  })
})

describe('extents', () => {
  it('measures the ground of a range of cells and everything the model draws', () => {
    const e = boundsExtent({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
    expect(e).toMatchObject({ left: -16, right: 16, top: 0 })
    const world = buildWorld(
      { seed: 1, tasks: [{ id: 'a', title: 'A', completedAt: 1 }], focusDays: [{ day: '2026-01-01', minutes: 360 }], courses: [], goals: [], streakDays: 0 },
    )
    const all = modelExtent(world)
    const ground = boundsExtent(world.bounds)
    expect(all.left).toBeLessThanOrEqual(ground.left)
    expect(all.top).toBeLessThan(ground.top) // a tall block rises above the ground
    expect(all.right).toBeGreaterThanOrEqual(ground.right)
    expect(all.bottom).toBeGreaterThanOrEqual(ground.bottom)
  })
})
