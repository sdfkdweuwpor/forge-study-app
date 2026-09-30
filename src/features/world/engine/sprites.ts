/**
 * Procedural pixel sprites for the My World city. Every sprite is a list of solid `fillRect`s at whole
 * pixels; nothing here touches a canvas, so the painters are plain functions of their inputs and are
 * tested in Node. The renderer turns a sprite's rects into a small bitmap once (at 1x), then stamps it
 * at any integer scale with nearest-neighbour drawing, which is pixel-for-pixel what multiplying every
 * rect by the zoom would give, at a fraction of the cost.
 *
 * Geometry. A sprite is drawn in "footprint units": the footprint's top corner is the origin, `u` runs
 * down-right and `v` down-left, and one cell is 16 units on each axis. A point `(u, v)` at height `z`
 * lands on the screen at `x = u - v`, `y = (u + v) / 2 - z`. The 2:1 slope means every edge steps one
 * pixel down for two across, so all lengths and corners are even and everything lines up.
 *
 * Shading (isometric solid): top face = base +8 lightness, left face = base, right face = base -12.
 * Each sprite gets a 1 px silhouette outline one shade darker than its walls.
 *
 * Night: windows are painted in their unlit colour on the sprite, and lit ones are painted again, on a
 * second "lights" list. The renderer draws the lights after the night overlay, so they stay bright.
 */
import {
  FLOOR_PX,
  hash32,
  mixHex,
  mulberry32,
  paletteFor,
  shade,
  withAlpha,
  type Hue,
  type Kind,
  type Theme,
  type WorldPalette,
} from '@/logic/world'

// ─── Painters ───────────────────────────────────────────────────────────────────────────────────

/** Where sprite pixels go. Coordinates are whole art pixels relative to the sprite's origin. */
export interface Painter {
  rect(x: number, y: number, w: number, h: number, color: string): void
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
  color: string
}

export interface RectBounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface SpriteRects {
  /** What is drawn on the sprite itself. */
  base: Rect[]
  /** Lit windows and lamp heads, drawn again after the night overlay. Empty by day. */
  lights: Rect[]
  /** The pixels the sprite touches: `x0`/`y0` inclusive, `x1`/`y1` exclusive. */
  bounds: RectBounds
}

export interface SpriteSpec {
  kind: Kind
  /** Seeds which windows of a block are lit. */
  id: string
  variant: number
  floors: number
  theme: Theme
  /** 0..4: how many windows of a block are lit at night. */
  streakLevel: number
  /** Night (more dark than light): also produce the lights list. */
  lit: boolean
  /** Grass checker colour: 0 or 1. */
  parity: number
}

export const spriteKey = (s: SpriteSpec): string => {
  switch (s.kind) {
    case 'grass':
      return `grass|${s.theme}|${s.parity}|${s.variant}`
    case 'road':
      return `road|${s.theme}|${s.variant}`
    case 'block':
      return `block|${s.theme}|${s.id}|${s.floors}|${s.variant}|${s.streakLevel}|${s.lit ? 1 : 0}`
    case 'house':
    case 'tree':
    case 'lamp':
    case 'decor':
    case 'landmark':
    case 'monument':
    case 'castle':
      return `${s.kind}|${s.theme}|${s.variant}|${s.lit ? 1 : 0}`
  }
}

// ─── Drawing toolkit ────────────────────────────────────────────────────────────────────────────

const HOUSE_HUES: readonly Hue[] = ['brown', 'orange', 'yellow', 'red', 'blue', 'pink', 'gray', 'green']
const BLOCK_HUES: readonly Hue[] = ['gray', 'blue', 'brown', 'purple']
const CAP_HUES: readonly Hue[] = ['blue', 'green', 'purple', 'red', 'brown', 'orange', 'pink', 'yellow']

function pickFrom<T>(list: readonly T[], i: number): T {
  const item = list[((i % list.length) + list.length) % list.length]
  if (item === undefined) throw new Error('empty list')
  return item
}

/**
 * The outline colour for a part: one shade darker than its walls, and in daylight pulled towards a
 * warm grey so the nine hues keep a calm, shared ink.
 */
function ink(theme: Theme, color: string): string {
  return theme === 'dark' ? shade(color, -28) : mixHex(shade(color, -26), '#7d776d', 0.45)
}

/** In the dark theme the walls' base colours are already dark, and the right face is darker still: lift them a little. */
function wallOf(theme: Theme, color: string): string {
  return theme === 'dark' ? shade(color, 5) : color
}

interface Faces {
  top: string
  left: string
  right: string
}

const faces = (base: string): Faces => ({ top: shade(base, 8), left: base, right: shade(base, -12) })

/** A flat diamond (the top of a slab, or ground) at height `z`, over the units `[u0, u0+lu] x [v0, v0+lv]`. */
function flat(p: Painter, u0: number, v0: number, lu: number, lv: number, z: number, color: string): void {
  const cx = u0 - v0
  const top = (u0 + v0) / 2 - z
  const rows = (lu + lv) / 2
  for (let r = 0; r < rows; r++) {
    const xl = Math.max(cx - 2 * r - 2, cx - 2 * lv + 2 * r)
    const xr = Math.min(cx + 2 * r + 2, cx + 2 * lu - 2 * r)
    if (xr > xl) p.rect(xl, top + r, xr - xl, 1, color)
  }
}

/** The face that looks down-left (towards +v), from height `z0` up to `z1`. */
function faceLeft(p: Painter, u0: number, v0: number, lu: number, lv: number, z0: number, z1: number, color: string): void {
  const cx = u0 - v0
  const top = (u0 + v0) / 2
  for (let j = 0; j < lu / 2; j++) {
    const bottom = top + lv / 2 + j
    p.rect(cx - lv + 2 * j, bottom - z1 + 1, 2, z1 - z0, color)
  }
}

/** The face that looks down-right (towards +u). */
function faceRight(p: Painter, u0: number, v0: number, lu: number, lv: number, z0: number, z1: number, color: string): void {
  const cx = u0 - v0
  const top = (u0 + v0) / 2
  for (let k = 0; k < lv / 2; k++) {
    const bottom = top + (lu + lv) / 2 - 1 - k
    p.rect(cx + lu - lv + 2 * k, bottom - z1 + 1, 2, z1 - z0, color)
  }
}

/** A shaded cuboid: left, right and top faces. `base` is the colour of the left face. */
function cuboid(p: Painter, u0: number, v0: number, lu: number, lv: number, z0: number, z1: number, base: string): void {
  const f = faces(base)
  faceLeft(p, u0, v0, lu, lv, z0, z1, f.left)
  faceRight(p, u0, v0, lu, lv, z0, z1, f.right)
  flat(p, u0, v0, lu, lv, z1, f.top)
}

interface Solid {
  u0: number
  v0: number
  lu: number
  lv: number
  z0: number
}

/** A rectangle painted on the left face: `col` px in from its left end, `w` wide, `up` above the base, `h` tall. */
function bandLeft(p: Painter, s: Solid, col: number, w: number, up: number, h: number, color: string): void {
  const cx = s.u0 - s.v0
  const top = (s.u0 + s.v0) / 2
  for (let c = col; c < col + w; c++) {
    const bottom = top + s.lv / 2 + Math.floor(c / 2) - s.z0 - up
    p.rect(cx - s.lv + c, bottom - h + 1, 1, h, color)
  }
}

/** The same on the right face (`col` counts from its left end, the front corner). */
function bandRight(p: Painter, s: Solid, col: number, w: number, up: number, h: number, color: string): void {
  const cx = s.u0 - s.v0
  const top = (s.u0 + s.v0) / 2
  for (let c = col; c < col + w; c++) {
    const bottom = top + (s.lu + s.lv) / 2 - 1 - Math.floor(c / 2) - s.z0 - up
    p.rect(cx + s.lu - s.lv + c, bottom - h + 1, 1, h, color)
  }
}

/** Fills a convex polygon by whole columns, sampling at each column's middle. */
function poly(p: Painter, pts: readonly (readonly [number, number])[], color: string): void {
  let minX = Infinity
  let maxX = -Infinity
  for (const [x] of pts) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
  }
  let runX = 0
  let runTop = 0
  let runBottom = 0
  let runLength = 0
  const flush = () => {
    if (runLength > 0) p.rect(runX, runTop, runLength, runBottom - runTop, color)
    runLength = 0
  }
  for (let x = Math.floor(minX); x < Math.ceil(maxX); x++) {
    const xc = x + 0.5
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if (!a || !b) continue
      if ((a[0] <= xc && xc < b[0]) || (b[0] <= xc && xc < a[0])) {
        const y = a[1] + ((b[1] - a[1]) * (xc - a[0])) / (b[0] - a[0])
        lo = Math.min(lo, y)
        hi = Math.max(hi, y)
      }
    }
    if (!(hi > lo)) {
      flush()
      continue
    }
    const top = Math.round(lo)
    const bottom = Math.round(hi)
    if (bottom <= top) {
      flush()
      continue
    }
    if (runLength > 0 && top === runTop && bottom === runBottom && x === runX + runLength) {
      runLength += 1
    } else {
      flush()
      runX = x
      runTop = top
      runBottom = bottom
      runLength = 1
    }
  }
  flush()
}

/** A 1 px line between two points, stepping along the longer axis. */
function line(p: Painter, x0: number, y0: number, x1: number, y1: number, color: string): void {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps
    p.rect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1, color)
  }
}

/** A rounded blob: `w` by `h` with its corners trimmed. */
function blob(p: Painter, cx: number, top: number, w: number, h: number, color: string): void {
  for (let r = 0; r < h; r++) {
    const inset = r === 0 || r === h - 1 ? 2 : r === 1 || r === h - 2 ? 1 : 0
    const width = w - 2 * inset
    if (width > 0) p.rect(cx - Math.floor(w / 2) + inset, top + r, width, 1, color)
  }
}

/**
 * One part of a sprite with its own 1 px outline: `draw` runs once for each of the four neighbouring
 * offsets in the outline colour, then once for real. Later parts paint over earlier ones, so every
 * part keeps a dark edge where it meets the next (a roof over its walls, a tower beside a wall).
 * The painter given to `draw` is the real one only on the last pass.
 */
function part(p: Painter, color: string, draw: (p: Painter) => void): void {
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const) {
    draw({ rect: (x, y, w, h) => p.rect(x + dx, y + dy, w, h, color) })
  }
  draw(p)
}

/** A soft shadow on the ground under a building. */
function shadow(p: Painter, theme: Theme, u0: number, v0: number, lu: number, lv: number): void {
  flat(p, u0, v0, lu, lv, 0, theme === 'dark' ? 'rgba(0, 0, 0, 0.22)' : 'rgba(55, 53, 47, 0.10)')
}

/** Everything a sprite painter needs: the palette and where to draw (base and, at night, lights). */
interface Ctx {
  pal: WorldPalette
  theme: Theme
  spec: SpriteSpec
  p: Painter
  /** `null` by day, and during the outline passes. */
  lights: Painter | null
}

/** A window: unlit on the sprite, lit (if it is) on the lights list. */
function windowLeft(c: Ctx, s: Solid, col: number, w: number, up: number, h: number, wall: string, lit: boolean): void {
  bandLeft(c.p, s, col, w, up, h, shade(wall, -20))
  if (lit && c.lights) bandLeft(c.lights, s, col, w, up, h, c.pal.windowLit)
}

function windowRight(c: Ctx, s: Solid, col: number, w: number, up: number, h: number, wall: string, lit: boolean): void {
  bandRight(c.p, s, col, w, up, h, shade(wall, -20))
  if (lit && c.lights) bandRight(c.lights, s, col, w, up, h, c.pal.windowLit)
}

// ─── Ground ─────────────────────────────────────────────────────────────────────────────────────

/** Where the speckles of a grass tile go (cell-local pixels), by variant 0..7. */
const SPECKLES: readonly (readonly (readonly [number, number, 0 | 1])[])[] = [
  [],
  [[-6, 7, 0]],
  [[7, 6, 1]],
  [[-9, 8, 0], [8, 9, 1]],
  [[3, 3, 1]],
  [[-4, 10, 1], [10, 7, 0]],
  [[0, 12, 0]],
  [[-11, 8, 1], [5, 11, 0]],
]

export function paintGrass(p: Painter, pal: WorldPalette, parity: number, variant: number): void {
  const base = parity === 0 ? pal.grassA : pal.grassB
  flat(p, 0, 0, 16, 16, 0, base)
  for (const [x, y, light] of pickFrom(SPECKLES, variant)) {
    p.rect(x, y, 1, 1, light === 1 ? shade(base, 5) : shade(base, -7))
  }
}

/** A road cell: `variant` 0 runs along x, 1 along y, 2 is a crossing. */
export function paintRoad(p: Painter, pal: WorldPalette, variant: number): void {
  flat(p, 0, 0, 16, 16, 0, pal.road)
  const dash = pal.roadDash
  if (variant === 0) {
    for (let m = -3; m < 3; m++) p.rect(2 * m, 7 + m + 1, 2, 2, dash)
  } else if (variant === 1) {
    for (let m = -3; m < 3; m++) p.rect(-2 * m - 2, 7 + m + 1, 2, 2, dash)
  } else {
    p.rect(-2, 7, 4, 2, dash)
  }
}

/** The soil under the outer edge of the ground: left and right faces of one cell. */
export function paintSoil(p: Painter, pal: WorldPalette, side: 'left' | 'right', depth: number): void {
  if (side === 'left') faceLeft(p, 0, 0, 16, 16, -depth, 0, pal.soil)
  else faceRight(p, 0, 0, 16, 16, -depth, 0, shade(pal.soil, -10))
}

// ─── Decor ──────────────────────────────────────────────────────────────────────────────────────

function paintDecor(c: Ctx): void {
  const { p, pal, spec } = c
  const green = pal.hues.green
  const cx = 0
  const base = 8
  switch (spec.variant % 8) {
    case 0:
    case 1: {
      // A round bush.
      blob(p, cx, base - 5, 9, 5, shade(green.text, 8))
      blob(p, cx - 1, base - 5, 6, 3, shade(green.text, 18))
      break
    }
    case 2: {
      // A low, wide hedge.
      blob(p, cx, base - 4, 12, 4, shade(green.text, 4))
      blob(p, cx - 1, base - 4, 8, 2, shade(green.text, 14))
      break
    }
    case 3: {
      // A bush with pink flowers.
      blob(p, cx, base - 5, 9, 5, shade(green.text, 8))
      p.rect(cx - 3, base - 4, 1, 1, pal.hues.pink.text)
      p.rect(cx + 1, base - 3, 1, 1, pal.hues.pink.text)
      p.rect(cx + 3, base - 5, 1, 1, pal.hues.pink.text)
      break
    }
    case 4: {
      // Yellow flowers in the grass.
      for (const [x, y] of [[-4, 6], [0, 8], [4, 6], [-1, 4]] as const) {
        p.rect(cx + x, base - 8 + y, 1, 1, shade(green.text, 6))
        p.rect(cx + x, base - 9 + y, 1, 1, pal.hues.yellow.text)
      }
      break
    }
    case 5: {
      // A small fir.
      p.rect(cx, base - 1, 1, 2, pal.hues.brown.text)
      poly(p, [[cx - 3, base - 1], [cx + 3, base - 1], [cx, base - 8]], shade(green.text, 4))
      poly(p, [[cx - 2, base - 4], [cx + 2, base - 4], [cx, base - 9]], shade(green.text, 12))
      break
    }
    case 6: {
      // Stones.
      p.rect(cx - 3, base - 2, 4, 2, pal.hues.gray.text)
      p.rect(cx - 2, base - 3, 2, 1, shade(pal.hues.gray.text, 10))
      p.rect(cx + 2, base - 1, 2, 1, shade(pal.hues.gray.text, -6))
      break
    }
    default: {
      // An autumn bush.
      blob(p, cx, base - 5, 9, 5, shade(pal.hues.orange.text, 4))
      blob(p, cx - 1, base - 5, 6, 3, shade(pal.hues.orange.text, 14))
      break
    }
  }
}

// ─── Earned: tiles ──────────────────────────────────────────────────────────────────────────────

function paintHouse(c: Ctx): void {
  const { pal, spec, theme, p } = c
  const hue = pickFrom(HOUSE_HUES, spec.variant)
  const colours = pal.hues[hue]
  const wall = wallOf(theme, colours.bg)
  const roof = colours.text
  const s: Solid = { u0: 1, v0: 1, lu: 14, lv: 14, z0: 0 }
  const wallH = 14
  shadow(p, theme, 2, 2, 14, 14)

  // Walls, with the gable end of the roof (the ridge runs along u, so the left slope and the right
  // gable end show).
  const cx = 0
  const eaveY = 1 - wallH // y of the top corner of the wall top
  const rise = 9
  const L: [number, number] = [cx - 14, eaveY + 7]
  const B: [number, number] = [cx, eaveY + 14]
  const R: [number, number] = [cx + 14, eaveY + 7]
  const ridgeStart: [number, number] = [cx - 7, eaveY + 3.5 - rise]
  const ridgeEnd: [number, number] = [cx + 7, eaveY + 10.5 - rise]
  part(p, ink(theme, wall), (q) => {
    faceLeft(q, s.u0, s.v0, s.lu, s.lv, 0, wallH, wall)
    faceRight(q, s.u0, s.v0, s.lu, s.lv, 0, wallH, shade(wall, -12))
    poly(q, [B, R, ridgeEnd], shade(wall, -12))
  })
  // A door on the left face (3x5) and a window (3x3) on each face.
  bandLeft(p, s, 2, 3, 0, 5, shade(roof, -8))
  windowLeft(c, s, 8, 3, 5, 3, wall, true)
  windowRight(c, s, 4, 3, 5, 3, wall, true)
  // The roof.
  part(p, ink(theme, roof), (q) => {
    poly(q, [[L[0], L[1] + 1], [B[0], B[1] + 1], ridgeEnd, ridgeStart], roof)
  })
  line(p, L[0] + 1, L[1] + 1, B[0], B[1] + 1, shade(roof, -14))
  line(p, ridgeStart[0] + 1, Math.round(ridgeStart[1]) + 1, ridgeEnd[0] - 1, Math.round(ridgeEnd[1]) + 1, shade(roof, 12))
  if (spec.variant >= 4) part(p, ink(theme, roof), (q) => cuboid(q, 4, 6, 2, 2, 20, 26, shade(pal.hues.gray.text, -4)))
}

function paintTree(c: Ctx): void {
  const { pal, spec, theme, p } = c
  const autumn = spec.variant >= 6
  const leaf = pal.hues[autumn ? 'orange' : 'green']
  const trunk = pal.hues.brown.text
  const dark = theme === 'dark'
  const mid = shade(leaf.text, dark ? -20 : 12)
  const lightLeaf = shade(mid, 10)
  const deep = shade(mid, -12)
  shadow(p, theme, 3, 3, 10, 10)
  // Trunk 2 by 5.
  p.rect(-1, 3, 2, 5, trunk)
  p.rect(0, 3, 1, 5, shade(trunk, -10))
  // Three stacked blobs: 8x5, 10x5, 6x4, lit from the top left and shaded underneath.
  part(p, shade(mid, -26), (q) => {
    blob(q, 0, -1, 8, 5, mid)
    blob(q, 0, -5, 10, 5, mid)
    blob(q, 0, -8, 6, 4, mid)
  })
  blob(p, -1, -8, 4, 2, lightLeaf)
  p.rect(-4, -4, 3, 2, lightLeaf)
  p.rect(-3, 0, 2, 2, lightLeaf)
  p.rect(1, 1, 4, 2, deep)
  p.rect(2, -3, 3, 2, deep)
  p.rect(-2, 3, 5, 1, deep)
}

function paintLamp(c: Ctx): void {
  const { pal, p } = c
  const pole = pal.hues.gray.text
  // A 1 px pole 14 tall, a 3x1 foot and a 3x2 head.
  p.rect(-1, 7, 3, 1, shade(pole, -6))
  p.rect(0, -6, 1, 13, pole)
  p.rect(-1, -8, 3, 2, shade(pal.hues.gray.bg, c.theme === 'dark' ? 8 : -22))
  p.rect(-1, -9, 3, 1, pole)
  if (c.lights) c.lights.rect(-1, -8, 3, 2, pal.windowLit)
}

// ─── Earned: blocks of flats ────────────────────────────────────────────────────────────────────

function paintBlock(c: Ctx): void {
  const { pal, spec, theme, p } = c
  const hue = pickFrom(BLOCK_HUES, spec.variant)
  const wall = wallOf(theme, pal.hues[hue].bg)
  const trim = pal.hues[hue].text
  const floors = Math.max(1, Math.min(6, spec.floors))
  const height = floors * FLOOR_PX
  const s: Solid = { u0: 1, v0: 1, lu: 14, lv: 14, z0: 0 }
  // Each window has a fixed place on a golden-ratio sequence (offset per building), and is lit when that
  // place is below the chance: lit windows are evenly spread, and a window lit at one streak level stays
  // lit at every higher one.
  const chance = 0.35 + 0.15 * spec.streakLevel
  const offset = mulberry32(hash32(spec.id))()
  shadow(p, theme, 2, 2, 14, 14)
  part(p, ink(theme, wall), (q) => cuboid(q, 1, 1, 14, 14, 0, height, wall))
  // A dark base band, then two windows per face per floor (2x3 px), each lit or not by its own roll.
  bandLeft(p, s, 0, 14, 0, 2, shade(wall, -14))
  bandRight(p, s, 0, 14, 0, 2, shade(wall, -20))
  for (let f = 0; f < floors; f++) {
    for (const face of ['left', 'right'] as const) {
      ;[3, 9].forEach((col, i) => {
        const n = f * 4 + (face === 'left' ? 0 : 2) + i
        const lit = (offset + n * 0.6180339887) % 1 < chance
        const up = f * FLOOR_PX + 4
        if (face === 'left') windowLeft(c, s, col, 2, up, 3, wall, lit)
        else windowRight(c, s, col, 2, up, 3, wall, lit)
      })
    }
  }
  // A 2 px roof ledge, a little wider than the walls, and now and then a plant room on it.
  part(p, ink(theme, wall), (q) => cuboid(q, 0, 0, 16, 16, height, height + 2, shade(wall, -6)))
  if (spec.variant % 2 === 1) part(p, ink(theme, trim), (q) => cuboid(q, 6, 6, 4, 4, height + 2, height + 5, trim))
}

// ─── Earned: landmarks ──────────────────────────────────────────────────────────────────────────

function paintLandmark(c: Ctx): void {
  const { pal, spec, theme, p } = c
  const gray = pal.hues.gray
  const cap = pal.hues[pickFrom(CAP_HUES, spec.variant)]
  const wall = wallOf(theme, gray.bg)
  const trim = gray.text
  const outline = ink(theme, wall)
  const plaza = shade(gray.bg, theme === 'dark' ? 6 : -5)
  const s: Solid = { u0: 7, v0: 7, lu: 18, lv: 18, z0: 2 }
  const towerTop = 2 + 44
  shadow(p, theme, 3, 3, 28, 28)
  part(p, outline, (q) => cuboid(q, 2, 2, 28, 28, 0, 2, plaza))
  part(p, outline, (q) => cuboid(q, s.u0, s.v0, s.lu, s.lv, 2, towerTop, wall))
  // Four floors of 11 px: a trim line between floors, two windows per face.
  for (let f = 1; f < 4; f++) {
    bandLeft(p, s, 0, s.lv, f * 11 - 1, 1, trim)
    bandRight(p, s, 0, s.lv, f * 11 - 1, 1, shade(trim, -8))
  }
  for (let f = 0; f < 4; f++) {
    const up = f * 11 + 3
    for (const col of [3, 12]) {
      if (!(f === 3 && col === 12)) windowLeft(c, s, col, 3, up, 5, wall, true)
      windowRight(c, s, col, 3, up, 5, wall, true)
    }
  }
  // A clock on the front of the top floor (4x4) and a door.
  bandLeft(p, s, 7, 4, 3 * 11 + 3, 4, trim)
  bandLeft(p, s, 8, 2, 3 * 11 + 4, 2, shade(wall, 6))
  bandLeft(p, s, 7, 4, 0, 5, shade(trim, -6))
  // Cornice, a coloured cap, and the gold spire with its flag.
  part(p, ink(theme, trim), (q) => cuboid(q, 6, 6, 20, 20, towerTop, towerTop + 2, trim))
  part(p, ink(theme, cap.text), (q) => cuboid(q, 8, 8, 16, 16, towerTop + 2, towerTop + 5, cap.text))
  const cy = 16 - (towerTop + 5)
  poly(p, [[-2, cy], [2, cy], [0, cy - 8]], pal.gold)
  p.rect(0, cy - 9, 3, 1, shade(pal.gold, 12))
}

function paintMonument(c: Ctx): void {
  const { pal, theme, p } = c
  const gray = pal.hues.gray
  const stone = shade(gray.bg, theme === 'dark' ? 6 : -6)
  const obelisk = mixHex(gray.bg, gray.text, 0.4)
  const outline = ink(theme, gray.bg)
  shadow(p, theme, 3, 3, 28, 28)
  part(p, outline, (q) => cuboid(q, 2, 2, 28, 28, 0, 3, stone))
  cuboid(p, 9, 9, 14, 14, 3, 4, shade(stone, 6))
  part(p, ink(theme, obelisk), (q) => cuboid(q, 12, 12, 8, 8, 4, 7, shade(obelisk, -6)))
  // The obelisk: 4 wide and 24 tall, with a gold cap.
  part(p, ink(theme, obelisk), (q) => cuboid(q, 15, 15, 2, 2, 7, 31, obelisk))
  const cy = 16 - 31
  poly(p, [[-2, cy], [2, cy], [0, cy - 4]], pal.gold)
  // Two small trees on the plaza.
  const leaf = shade(pal.hues.green.text, theme === 'dark' ? -20 : 12)
  for (const x of [-19, 19]) {
    const y = 13
    p.rect(x, y - 1, 1, 3, pal.hues.brown.text)
    part(p, shade(leaf, -26), (q) => {
      blob(q, x, y - 6, 6, 3, leaf)
      blob(q, x, y - 4, 6, 3, leaf)
    })
    blob(p, x - 1, y - 6, 3, 2, shade(leaf, 10))
  }
}

function paintCastle(c: Ctx): void {
  const { pal, theme, p } = c
  const gray = pal.hues.gray
  const wall = wallOf(theme, gray.bg)
  const trim = gray.text
  const flag = pal.gold
  const outline = ink(theme, wall)
  const merlon = shade(wall, -3)
  shadow(p, theme, 3, 3, 44, 44)
  const merlons = (q: Painter, u0: number, v0: number, lu: number, lv: number, z: number) => {
    if (lu >= lv) {
      for (let u = u0; u + 2 <= u0 + lu; u += 4) cuboid(q, u, v0, 2, 2, z, z + 3, merlon)
    } else {
      for (let v = v0; v + 2 <= v0 + lv; v += 4) cuboid(q, u0, v, 2, 2, z, z + 3, merlon)
    }
  }
  const tower = (u0: number, v0: number) =>
    part(p, outline, (q) => {
      cuboid(q, u0, v0, 8, 8, 0, 26, wall)
      for (const [du, dv] of [[0, 0], [6, 0], [0, 6], [6, 6]] as const) cuboid(q, u0 + du, v0 + dv, 2, 2, 26, 29, merlon)
    })
  const slits = (u0: number, v0: number, left: boolean, right: boolean) => {
    const t: Solid = { u0, v0, lu: 8, lv: 8, z0: 0 }
    if (left) bandLeft(p, t, 3, 2, 15, 6, shade(wall, -24))
    if (right) bandRight(p, t, 3, 2, 15, 6, shade(wall, -28))
  }
  // A paved courtyard.
  part(p, outline, (q) => cuboid(q, 4, 4, 40, 40, 0, 1, shade(gray.bg, theme === 'dark' ? 8 : -6)))
  // Back to front: back tower, the two back walls, the side towers, the keep, the two front walls, the front tower.
  tower(2, 2)
  part(p, outline, (q) => {
    cuboid(q, 10, 4, 28, 4, 0, 16, wall)
    merlons(q, 10, 4, 28, 4, 16)
  })
  part(p, outline, (q) => {
    cuboid(q, 4, 10, 4, 28, 0, 16, wall)
    merlons(q, 4, 10, 4, 28, 16)
  })
  tower(38, 2)
  slits(38, 2, true, true)
  tower(2, 38)
  slits(2, 38, true, true)
  // The keep: 16 x 16 units and 34 tall, with merlons all round and window slits.
  const keep: Solid = { u0: 16, v0: 16, lu: 16, lv: 16, z0: 0 }
  part(p, outline, (q) => {
    cuboid(q, 16, 16, 16, 16, 0, 34, wall)
    for (const [du, dv] of [[0, 0], [14, 0], [0, 14], [14, 14], [6, 0], [0, 6], [6, 14], [14, 6]] as const) {
      cuboid(q, 16 + du, 16 + dv, 2, 2, 34, 37, merlon)
    }
  })
  for (const col of [3, 11]) {
    bandLeft(p, keep, col, 2, 22, 6, shade(wall, -22))
    bandRight(p, keep, col, 2, 22, 6, shade(wall, -26))
  }
  windowLeft(c, keep, 7, 2, 12, 5, wall, true)
  part(p, outline, (q) => {
    cuboid(q, 10, 40, 28, 4, 0, 16, wall)
    merlons(q, 10, 40, 28, 4, 16)
  })
  part(p, outline, (q) => {
    cuboid(q, 40, 10, 4, 28, 0, 16, wall)
    merlons(q, 40, 10, 4, 28, 16)
  })
  // The gate in the front-left wall: an arch 8 wide and 10 tall.
  const gate: Solid = { u0: 10, v0: 40, lu: 28, lv: 4, z0: 0 }
  const dark = shade(trim, -22)
  bandLeft(p, gate, 10, 8, 0, 8, dark)
  bandLeft(p, gate, 11, 6, 8, 1, dark)
  bandLeft(p, gate, 12, 4, 9, 1, dark)
  tower(38, 38)
  slits(38, 38, true, true)
  // Two gold flags: on the keep and on the front tower.
  const flagAt = (x: number, y: number, h: number, wide: number) => {
    p.rect(x, y - h, 1, h, shade(trim, -10))
    p.rect(x + 1, y - h, wide, 3, flag)
    p.rect(x + 1, y - h + 3, Math.max(1, wide - 2), 1, shade(flag, -12))
  }
  flagAt(0, 24 - 37, 9, 5)
  flagAt(0, 42 - 29, 7, 4)
}

// ─── Fountain ───────────────────────────────────────────────────────────────────────────────────

/**
 * The fountain on a plaza (streak of 30 days): a small stone basin at the plaza's right-hand edge, with
 * a jet of water in one of four frames. Drawn in the same footprint units as a landmark or monument,
 * whose plazas share one geometry.
 */
export function paintFountain(p: Painter, pal: WorldPalette, theme: Theme, frame: number): void {
  const stone = shade(pal.hues.gray.bg, theme === 'dark' ? 12 : -8)
  const rim = ink(theme, pal.hues.gray.bg)
  part(p, rim, (q) => cuboid(q, 26, 12, 4, 8, 2, 4, stone))
  flat(p, 27, 13, 2, 6, 4, pal.water)
  // The middle of the basin: u = 28, v = 16, at the height of the water.
  const cx = 28 - 16
  const top = (28 + 16) / 2 - 4
  const f = ((frame % 4) + 4) % 4
  const light = pal.waterLight
  // Jet: a column that rises and falls, with drops that drift out.
  const rise = [3, 4, 5, 4][f] ?? 3
  p.rect(cx, top - rise, 1, rise, light)
  p.rect(cx - 1, top - rise + 1, 1, 1, pal.water)
  p.rect(cx + 1, top - rise + 1, 1, 1, pal.water)
  if (f === 1 || f === 2) {
    p.rect(cx - 2, top - rise + 2, 1, 1, light)
    p.rect(cx + 2, top - rise + 2, 1, 1, light)
  }
  if (f === 3 || f === 0) p.rect(cx, top - rise - 1, 1, 1, light)
}

// ─── Entry point ────────────────────────────────────────────────────────────────────────────────

function boundsOf(rects: readonly Rect[]): RectBounds {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return rects.length === 0 ? { x0: 0, y0: 0, x1: 1, y1: 1 } : { x0, y0, x1, y1 }
}

/** The rects of one sprite (and its lights when `spec.lit`), ready to be stamped onto a small bitmap. */
export function paintSprite(spec: SpriteSpec): SpriteRects {
  const pal = paletteFor(spec.theme)
  const base: Rect[] = []
  const lights: Rect[] = []
  const p: Painter = { rect: (x, y, w, h, color) => void base.push({ x, y, w, h, color }) }
  const lp: Painter | null = spec.lit
    ? { rect: (x, y, w, h, color) => void lights.push({ x, y, w, h, color }) }
    : null
  const ctx: Ctx = { pal, theme: spec.theme, spec, p, lights: lp }
  switch (spec.kind) {
    case 'grass':
      paintGrass(p, pal, spec.parity, spec.variant)
      break
    case 'road':
      paintRoad(p, pal, spec.variant)
      break
    case 'decor':
      paintDecor(ctx)
      break
    case 'house':
      paintHouse(ctx)
      break
    case 'tree':
      paintTree(ctx)
      break
    case 'lamp':
      paintLamp(ctx)
      break
    case 'block':
      paintBlock(ctx)
      break
    case 'landmark':
      paintLandmark(ctx)
      break
    case 'monument':
      paintMonument(ctx)
      break
    case 'castle':
      paintCastle(ctx)
      break
  }
  return { base, lights, bounds: boundsOf([...base, ...lights]) }
}

/** The translucent colour of a lamp's glow at night. */
export const lampGlow = (pal: WorldPalette, alpha: number): string => withAlpha(pal.windowLit, alpha)

/** A colour halfway between a hue's wall and roof colours: used for people. */
export const muted = (pal: WorldPalette, hue: Hue): string => mixHex(pal.hues[hue].bg, pal.hues[hue].text, 0.7)
