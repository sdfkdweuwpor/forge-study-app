import { describe, expect, it } from 'vitest'
import { FLOOR_PX, KIND_ORDER, isHex, spriteBox, type Kind, type Placed, type Theme } from '@/logic/world'
import { paintFountain, paintSprite, spriteKey, type Painter, type Rect, type SpriteSpec } from './sprites'
import { paletteFor } from '@/logic/world'

const COLOUR = /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, [\d.]+\))$/

const spec = (kind: Kind, over: Partial<SpriteSpec> = {}): SpriteSpec => ({
  kind,
  id: 'block:0',
  variant: 0,
  floors: kind === 'block' ? 3 : kind === 'landmark' ? 4 : kind === 'castle' ? 5 : kind === 'monument' ? 2 : 0,
  theme: 'light',
  streakLevel: 0,
  lit: false,
  parity: 0,
  ...over,
})

const size = (kind: Kind): number => (kind === 'castle' ? 3 : kind === 'landmark' || kind === 'monument' ? 2 : 1)

const asItem = (s: SpriteSpec): Placed => ({
  id: s.id,
  kind: s.kind,
  x: 0,
  y: 0,
  w: size(s.kind),
  h: size(s.kind),
  floors: s.floors,
  variant: s.variant,
  label: null,
  earnedFrom: null,
  earnedAt: null,
})

const all = (rects: readonly Rect[]) => rects.every((r) => Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w) && Number.isInteger(r.h))

describe('every sprite', () => {
  for (const kind of KIND_ORDER) {
    it(`${kind}: whole-pixel rects with valid colours, in both themes and every variant`, () => {
      for (const theme of ['light', 'dark'] as const) {
        for (let variant = 0; variant < 8; variant++) {
          const r = paintSprite(spec(kind, { theme, variant, lit: true, streakLevel: 2, parity: variant % 2 }))
          expect(r.base.length).toBeGreaterThan(0)
          expect(all(r.base)).toBe(true)
          expect(all(r.lights)).toBe(true)
          for (const rect of [...r.base, ...r.lights]) {
            expect(rect.w).toBeGreaterThan(0)
            expect(rect.h).toBeGreaterThan(0)
            expect(rect.color).toMatch(COLOUR)
          }
          expect(r.bounds.x1).toBeGreaterThan(r.bounds.x0)
          expect(r.bounds.y1).toBeGreaterThan(r.bounds.y0)
        }
      }
    })

    it(`${kind}: stays inside its sprite box, which is not much bigger than it`, () => {
      for (const theme of ['light', 'dark'] as const) {
        let tallest = Infinity
        let boxTop = 0
        for (let variant = 0; variant < 8; variant++) {
          const s = spec(kind, { theme, variant, lit: true, floors: kind === 'block' ? 1 + (variant % 6) : spec(kind).floors })
          const { bounds } = paintSprite(s)
          const box = spriteBox(asItem(s), 1)
          const where = `${kind} v${variant} ${theme}`
          expect(bounds.x0, where).toBeGreaterThanOrEqual(box.x)
          expect(bounds.x1, where).toBeLessThanOrEqual(box.x + box.w)
          expect(bounds.y0, where).toBeGreaterThanOrEqual(box.y)
          expect(bounds.y1, where).toBeLessThanOrEqual(box.y + box.h)
          if (bounds.y0 - box.y < tallest - boxTop || tallest === Infinity) {
            tallest = bounds.y0
            boxTop = box.y
          }
        }
        // The box is honest: the tallest variant leaves only a few pixels of slack above it.
        if (kind !== 'grass' && kind !== 'road') expect(tallest - boxTop, `${kind} ${theme}`).toBeLessThanOrEqual(6)
      }
    })
  }

  it('is a pure function of its spec', () => {
    for (const kind of KIND_ORDER) {
      const s = spec(kind, { variant: 5, lit: true, streakLevel: 3 })
      expect(paintSprite(s)).toEqual(paintSprite(s))
    }
  })
})

describe('variants', () => {
  it('give the eight houses different roofs and walls', () => {
    const colours = new Set<string>()
    for (let v = 0; v < 8; v++) colours.add(paintSprite(spec('house', { variant: v })).base.map((r) => r.color).join(','))
    expect(colours.size).toBe(8)
  })

  it('turns the last two trees autumn', () => {
    const green = paintSprite(spec('tree', { variant: 0 })).base.map((r) => r.color)
    const autumn = paintSprite(spec('tree', { variant: 7 })).base.map((r) => r.color)
    expect(autumn).not.toEqual(green)
    expect(paintSprite(spec('tree', { variant: 5 })).base.map((r) => r.color)).toEqual(green)
  })

  it('checkers the grass and speckles it by variant', () => {
    const a = paintSprite(spec('grass', { parity: 0 })).base[0]?.color
    const b = paintSprite(spec('grass', { parity: 1 })).base[0]?.color
    expect(a).toBe(paletteFor('light').grassA)
    expect(b).toBe(paletteFor('light').grassB)
    const counts = [0, 1, 2, 3].map((v) => paintSprite(spec('grass', { variant: v })).base.length)
    expect(new Set(counts).size).toBeGreaterThan(1)
  })

  it('runs a road along x, along y, or crosses', () => {
    const dashes = (variant: number) => paintSprite(spec('road', { variant })).base.filter((r) => r.color === paletteFor('light').roadDash)
    expect(dashes(0).length).toBeGreaterThan(1)
    expect(dashes(1).length).toBeGreaterThan(1)
    // Along x steps right as it goes down; along y steps left.
    const first = (variant: number) => dashes(variant).sort((p, q) => p.y - q.y)[0]?.x ?? 0
    const last = (variant: number) => dashes(variant).sort((p, q) => q.y - p.y)[0]?.x ?? 0
    expect(last(0)).toBeGreaterThan(first(0))
    expect(last(1)).toBeLessThan(first(1))
    expect(dashes(2)).toHaveLength(1)
  })

  it('draws blocks with the floors they were given', () => {
    const height = (floors: number) => {
      const { bounds } = paintSprite(spec('block', { floors }))
      return bounds.y1 - bounds.y0
    }
    expect(height(2) - height(1)).toBe(FLOOR_PX)
    expect(height(6) - height(1)).toBe(5 * FLOOR_PX)
  })
})

describe('night lights', () => {
  it('are empty by day and for things without windows', () => {
    for (const kind of KIND_ORDER) expect(paintSprite(spec(kind, { lit: false })).lights).toEqual([])
    for (const kind of ['tree', 'decor', 'monument', 'grass', 'road'] as const) {
      expect(paintSprite(spec(kind, { lit: true })).lights).toEqual([])
    }
  })

  it('light the windows of houses, blocks, landmarks and castles and the head of a lamp', () => {
    for (const kind of ['house', 'block', 'landmark', 'castle', 'lamp'] as const) {
      const r = paintSprite(spec(kind, { lit: true, streakLevel: 2 }))
      expect(r.lights.length, kind).toBeGreaterThan(0)
      expect(r.lights.every((l) => l.color === paletteFor('light').windowLit)).toBe(true)
    }
  })

  it('do not change what the sprite itself looks like', () => {
    for (const kind of KIND_ORDER) {
      expect(paintSprite(spec(kind, { lit: true })).base).toEqual(paintSprite(spec(kind, { lit: false })).base)
    }
  })

  it('light more of a block as the streak grows, and never turn a lit window off', () => {
    const lit = (streakLevel: number, id = 'block:3') =>
      new Set(paintSprite(spec('block', { id, floors: 6, lit: true, streakLevel })).lights.map((r) => `${r.x},${r.y}`))
    let previous = new Set<string>()
    let previousCount = -1
    for (const level of [0, 1, 2, 3, 4]) {
      const now = lit(level)
      expect(now.size).toBeGreaterThan(previousCount)
      for (const w of previous) expect(now.has(w)).toBe(true)
      previous = now
      previousCount = now.size
    }
    // A six-floor block has 24 windows of two columns each: about a third are lit at level 0, most at level 4.
    expect(lit(0).size / 48).toBeGreaterThan(0.2)
    expect(lit(0).size / 48).toBeLessThan(0.5)
    expect(lit(4).size / 48).toBeGreaterThan(0.85)
  })

  it('spread the lit windows over the whole building: no tower is left dark at level 0', () => {
    for (let b = 0; b < 40; b++) {
      const lights = paintSprite(spec('block', { id: `block:${b}`, floors: 6, lit: true, streakLevel: 0 })).lights
      expect(lights.length, `block:${b}`).toBeGreaterThan(6)
    }
  })

  it('differ between buildings', () => {
    const a = paintSprite(spec('block', { id: 'block:0', floors: 4, lit: true, streakLevel: 1 })).lights
    const b = paintSprite(spec('block', { id: 'block:1', floors: 4, lit: true, streakLevel: 1 })).lights
    expect(a).not.toEqual(b)
  })
})

describe('spriteKey', () => {
  it('separates what draws differently and merges what does not', () => {
    expect(spriteKey(spec('house', { variant: 1 }))).not.toBe(spriteKey(spec('house', { variant: 2 })))
    expect(spriteKey(spec('house', { lit: true }))).not.toBe(spriteKey(spec('house', { lit: false })))
    expect(spriteKey(spec('house', { theme: 'dark' }))).not.toBe(spriteKey(spec('house', { theme: 'light' })))
    expect(spriteKey(spec('house', { id: 'a' }))).toBe(spriteKey(spec('house', { id: 'b' })))
    expect(spriteKey(spec('block', { id: 'a' }))).not.toBe(spriteKey(spec('block', { id: 'b' })))
    expect(spriteKey(spec('grass', { parity: 0 }))).not.toBe(spriteKey(spec('grass', { parity: 1 })))
  })
})

describe('the fountain', () => {
  const rects = (theme: Theme, frame: number): Rect[] => {
    const out: Rect[] = []
    const p: Painter = { rect: (x, y, w, h, color) => void out.push({ x, y, w, h, color }) }
    paintFountain(p, paletteFor(theme), theme, frame)
    return out
  }

  it('has four different frames of water, and every colour is valid', () => {
    const frames = [0, 1, 2, 3].map((f) => JSON.stringify(rects('light', f)))
    expect(new Set(frames).size).toBe(4)
    expect(JSON.stringify(rects('light', 4))).toBe(frames[0])
    for (const r of rects('dark', 2)) expect(isHex(r.color) || COLOUR.test(r.color)).toBe(true)
    expect(all(rects('light', 1))).toBe(true)
  })

  it('stays on the plaza of a 2x2 building', () => {
    for (const f of [0, 1, 2, 3]) {
      for (const r of rects('light', f)) {
        expect(r.x).toBeGreaterThanOrEqual(-32)
        expect(r.x + r.w).toBeLessThanOrEqual(32)
        expect(r.y + r.h).toBeLessThanOrEqual(34)
      }
    }
  })
})
