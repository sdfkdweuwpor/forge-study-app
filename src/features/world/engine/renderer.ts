/**
 * The My World renderer: layered, cached, and only as busy as the scene needs it to be.
 *
 * Layers, back to front, every frame:
 *  1. the sky gradient over the whole canvas (plus stars at night);
 *  2. the **static layer**: ground, roads, shrubs and every earned sprite, painted once onto an
 *     off-screen canvas and only blitted at the new offset while the view pans;
 *  3. the **dynamic layer**: people, the fountain, birds and the hover outline;
 *  4. the night overlay (`rgba(20, 26, 38, 0.4 * ambient)`, 0.28 in the dark theme);
 *  5. the **lights**: lit windows and lamp heads from a second cached layer, lamp glows and fireworks,
 *     drawn after the overlay so they stay bright.
 *
 * Crisp pixels: everything is drawn at whole device pixels with smoothing off. One art pixel is
 * `zoom * unit` device pixels (`unit` is the device pixel ratio, rounded), so a sprite is always an
 * exact integer multiple of its 1x bitmap. The one exception is the fit zoom of a city that does not
 * fit at zoom 1 (a phone): its scale is a fraction, so the static layer is still painted at a whole
 * scale (`ceil`), seamlessly, and resampled once onto the canvas with smoothing on.
 *
 * The static layer covers the whole world when that is small enough (panning is then one blit) and a
 * window around the view when the world is large, so 2,000 buildings at zoom 4 stay within memory. It
 * is rebuilt only when the model, theme, zoom or 15-minute time bucket changes (or the view leaves the
 * window). Sprites are painted once at 1x (see `sprites.ts`) and stamped with `drawImage`.
 */
import {
  SOIL_PX,
  boxesOverlap,
  compareDepth,
  depthKey,
  layoutSignature,
  modelExtent,
  paletteFor,
  planWalkers,
  skyAt,
  sparksOf,
  spriteBox,
  originOf,
  toScreen,
  walkerAt,
  birdsAt,
  firework,
  fountainFrame,
  hash32,
  mulberry32,
  shade,
  withAlpha,
  type Box,
  type Camera,
  type Extent,
  type Placed,
  type Sky,
  type Theme,
  type View,
  type Walker,
  type WorldModel,
} from '@/logic/world'
import {
  bitmapFromRects,
  createLayer,
  silhouetteOf,
  type Bitmap,
  type Draw2D,
  type Layer,
} from './canvasKit'
import {
  paintFountain,
  paintSoil,
  paintSprite,
  spriteKey,
  type Painter,
  type Rect,
  type RectBounds,
  type SpriteSpec,
} from './sprites'

/** The canvas the renderer draws on: device pixels, and the pixel unit of one art pixel at zoom 1. */
export interface Viewport extends View {
  unit: number
}

export interface Frame {
  camera: Camera
  theme: Theme
  /** Whether things may move (people, birds, flicker, fountain). */
  motion: boolean
  /** The item to outline (hover or keyboard focus). */
  highlightId: string | null
  /** Epoch ms. */
  nowMs: number
}

export interface Renderer {
  /** Replaces the model. The static layer is only rebuilt when the layout really changed. */
  setModel(model: WorldModel): void
  /** The extent of everything drawn, in art pixels at zoom 1. */
  extent(): Extent
  /** Draws one frame. Returns true when the scene has something animated in it. */
  render(view: Viewport, frame: Frame): boolean
  /** Whether the scene would move at `nowMs` (so the app knows if it needs a frame loop). */
  animated(frame: Frame): boolean
  /** The whole world as a PNG. */
  exportPng(frame: Frame, options: { zoom: number; caption: string }): Promise<Blob>
  /** Where an item's middle is on screen (device pixels), for keyboard tooltips. */
  screenPointOf(id: string, view: Viewport, camera: Camera): { x: number; y: number } | null
  destroy(): void
}

// ─── Small helpers ──────────────────────────────────────────────────────────────────────────────

/** Minutes after local midnight, fractional. */
function localMinutes(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

const BUCKET_MINUTES = 15
const mod = (n: number, m: number): number => ((n % m) + m) % m

interface RectPx {
  x0: number
  y0: number
  x1: number
  y1: number
}

const MAX_CACHE_PIXELS = 12_000_000
const MAX_CACHE_SIDE = 8192
const SNAP = 256

/** Kinds whose sprites have lit windows or lamp heads. */
const hasLights = (kind: Placed['kind']): boolean =>
  kind === 'house' || kind === 'block' || kind === 'lamp' || kind === 'landmark' || kind === 'castle'

interface SpriteBitmaps {
  base: Bitmap
  lights: Bitmap | null
}

interface Prepared {
  model: WorldModel
  /** Changes when a new static layer is needed (layout, streak level). */
  signature: string
  ground: Placed[]
  soilLeft: Placed[]
  soilRight: Placed[]
  /** Shrubs and everything earned, back to front. */
  objects: Placed[]
  lamps: Placed[]
  byId: Map<string, Placed>
  extent: Extent
  walkers: Walker[]
  /** The first landmark or monument: where the fountain goes. */
  host: Placed | null
  /** `spriteBox` of each earned item at zoom 1, parallel to `model.earned`. */
  earnedBoxes: Box[]
}

function mergeByDepth(a: readonly Placed[], b: readonly Placed[]): Placed[] {
  const out: Placed[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const x = a[i]
    const y = b[j]
    if (x !== undefined && (y === undefined || compareDepth(x, y) <= 0)) {
      out.push(x)
      i += 1
    } else if (y !== undefined) {
      out.push(y)
      j += 1
    }
  }
  return out
}

function prepare(model: WorldModel): Prepared {
  const ground = model.scenery.filter((p) => p.kind === 'grass' || p.kind === 'road')
  const cells = new Set(ground.map((p) => `${p.x}:${p.y}`))
  const soilLeft = ground.filter((p) => !cells.has(`${p.x}:${p.y + 1}`))
  const soilRight = ground.filter((p) => !cells.has(`${p.x + 1}:${p.y}`))
  const decor = model.scenery.filter((p) => p.kind === 'decor')
  const byId = new Map<string, Placed>()
  for (const p of model.earned) byId.set(p.id, p)
  let host: Placed | null = null
  for (const p of model.earned) {
    if (p.kind !== 'landmark' && p.kind !== 'monument') continue
    if (
      host === null ||
      (p.earnedAt ?? 0) < (host.earnedAt ?? 0) ||
      ((p.earnedAt ?? 0) === (host.earnedAt ?? 0) && p.id < host.id)
    ) {
      host = p
    }
  }
  const b = model.bounds
  const signature = `${layoutSignature(model)}|${model.scenery.length}|${b.minX},${b.minY},${b.maxX},${b.maxY}|${model.stats.streakLevel}`
  return {
    model,
    signature,
    ground,
    soilLeft,
    soilRight,
    objects: mergeByDepth(decor, model.earned),
    lamps: model.earned.filter((p) => p.kind === 'lamp'),
    byId,
    extent: modelExtent(model),
    walkers: planWalkers(model),
    host,
    earnedBoxes: model.earned.map((p) => spriteBox(p, 1)),
  }
}

// ─── The renderer ───────────────────────────────────────────────────────────────────────────────

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const doc = canvas.ownerDocument
  const ctx: Draw2D | null = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('This browser cannot draw the world: 2D canvas is not available.')

  let prepared: Prepared | null = null
  const sprites = new Map<string, SpriteBitmaps>()
  const extras = new Map<string, Bitmap>()

  interface StaticCache {
    key: string
    region: RectPx
    full: boolean
    base: Layer
    lights: Layer | null
  }
  let cache: StaticCache | null = null
  let destroyed = false

  // ── Sprites ───────────────────────────────────────────────────────────────────────────────────
  const boundsOf = (a: readonly Rect[], b: readonly Rect[]): RectBounds => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const list of [a, b]) {
      for (const r of list) {
        x0 = Math.min(x0, r.x)
        y0 = Math.min(y0, r.y)
        x1 = Math.max(x1, r.x + r.w)
        y1 = Math.max(y1, r.y + r.h)
      }
    }
    return { x0, y0, x1, y1 }
  }

  const specFor = (p: Placed, theme: Theme, lit: boolean, streakLevel: number): SpriteSpec => ({
    kind: p.kind,
    id: p.id,
    variant: p.variant,
    floors: p.floors,
    theme,
    streakLevel,
    lit: lit && hasLights(p.kind),
    parity: mod(p.x + p.y, 2),
  })

  const bitmapsFor = (spec: SpriteSpec): SpriteBitmaps => {
    const key = spriteKey(spec)
    const hit = sprites.get(key)
    if (hit) return hit
    const painted = paintSprite(spec)
    const bounds = boundsOf(painted.base, painted.lights)
    const base = bitmapFromRects(doc, painted.base, bounds)
    const lights = painted.lights.length > 0 ? bitmapFromRects(doc, painted.lights, bounds) : null
    const made = { base, lights }
    sprites.set(key, made)
    return made
  }

  /** A hand-painted piece that is not a `Placed` (soil edges, the fountain's frames). */
  const extra = (key: string, paint: (p: Painter) => void): Bitmap => {
    const hit = extras.get(key)
    if (hit) return hit
    const rects: Rect[] = []
    paint({ rect: (x, y, w, h, color) => void rects.push({ x, y, w, h, color }) })
    const made = bitmapFromRects(doc, rects, boundsOf(rects, []))
    extras.set(key, made)
    return made
  }

  const soilBitmap = (theme: Theme, side: 'left' | 'right'): Bitmap =>
    extra(`soil|${theme}|${side}`, (p) => paintSoil(p, paletteFor(theme), side, SOIL_PX))

  const fountainBitmap = (theme: Theme, frame: number): Bitmap =>
    extra(`fountain|${theme}|${frame}`, (p) => paintFountain(p, paletteFor(theme), theme, frame))

  const outlineOf = (spec: SpriteSpec, color: string): Bitmap => {
    const key = `ring|${spriteKey(spec)}|${color}`
    const hit = extras.get(key)
    if (hit) return hit
    const made = silhouetteOf(doc, bitmapsFor(spec).base, color)
    extras.set(key, made)
    return made
  }

  const stamp = (
    target: Draw2D,
    bmp: Bitmap,
    artX: number,
    artY: number,
    k: number,
    offX: number,
    offY: number,
  ): void => {
    // Edges are rounded, not sizes, so neighbours that share an edge still share it at a fractional scale.
    // At a whole scale this is exactly `bmp.w * k` by `bmp.h * k`.
    const x0 = Math.round(offX + (artX + bmp.ox) * k)
    const y0 = Math.round(offY + (artY + bmp.oy) * k)
    const x1 = Math.round(offX + (artX + bmp.ox + bmp.w) * k)
    const y1 = Math.round(offY + (artY + bmp.oy + bmp.h) * k)
    target.drawImage(bmp.layer.surface, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0))
  }

  // ── The world onto a target ───────────────────────────────────────────────────────────────────

  interface Pass {
    prep: Prepared
    theme: Theme
    lit: boolean
    /** Device pixels per art pixel. */
    k: number
    /** Where world device pixel (0, 0) lands on the target. */
    offX: number
    offY: number
    /** The part of the world (world device pixels) that needs painting. */
    region: RectPx
  }

  const overlaps = (r: RectPx, x: number, y: number, w: number, h: number): boolean =>
    x < r.x1 && x + w > r.x0 && y < r.y1 && y + h > r.y0

  /** Ground, soil, shrubs and earned sprites, back to front. */
  const paintBase = (target: Draw2D, pass: Pass): void => {
    const { prep, theme, lit, k, offX, offY, region } = pass
    const streak = prep.model.stats.streakLevel
    const tileW = 32 * k
    const tileH = (16 + SOIL_PX) * k
    const cellVisible = (p: Placed): boolean => {
      const s = toScreen(p.x, p.y, 1)
      return overlaps(region, (s.sx - 16) * k, s.sy * k, tileW, tileH)
    }
    for (const side of ['left', 'right'] as const) {
      const bmp = soilBitmap(theme, side)
      for (const p of side === 'left' ? prep.soilLeft : prep.soilRight) {
        if (!cellVisible(p)) continue
        const s = toScreen(p.x, p.y, 1)
        stamp(target, bmp, s.sx, s.sy, k, offX, offY)
      }
    }
    for (const p of prep.ground) {
      if (!cellVisible(p)) continue
      const s = toScreen(p.x, p.y, 1)
      stamp(target, bitmapsFor(specFor(p, theme, false, streak)).base, s.sx, s.sy, k, offX, offY)
    }
    for (const p of prep.objects) {
      const box = spriteBox(p, k)
      if (!overlaps(region, box.x, box.y, box.w, box.h)) continue
      const s = toScreen(p.x, p.y, 1)
      stamp(target, bitmapsFor(specFor(p, theme, lit, streak)).base, s.sx, s.sy, k, offX, offY)
    }
  }

  /** Lit windows and lamp heads. */
  const paintLights = (target: Draw2D, pass: Pass): void => {
    const { prep, theme, k, offX, offY, region } = pass
    const streak = prep.model.stats.streakLevel
    for (const p of prep.model.earned) {
      if (!hasLights(p.kind)) continue
      const box = spriteBox(p, k)
      if (!overlaps(region, box.x, box.y, box.w, box.h)) continue
      const lights = bitmapsFor(specFor(p, theme, true, streak)).lights
      if (!lights) continue
      const s = toScreen(p.x, p.y, 1)
      stamp(target, lights, s.sx, s.sy, k, offX, offY)
    }
  }

  /** The part of the world the view shows, in the static layer's pixels (`ratio` screen pixels each). */
  const regionOf = (view: Viewport, camera: Camera, ratio: number): RectPx => {
    const o = originOf(camera, view, view.unit)
    return {
      x0: Math.floor(-o.x / ratio),
      y0: Math.floor(-o.y / ratio),
      x1: Math.ceil((-o.x + view.width) / ratio),
      y1: Math.ceil((-o.y + view.height) / ratio),
    }
  }

  const worldRect = (prep: Prepared, k: number): RectPx => {
    const e = prep.extent
    const pad = 4 * k
    return {
      x0: Math.floor(e.left * k) - pad,
      y0: Math.floor(e.top * k) - pad,
      x1: Math.ceil(e.right * k) + pad,
      y1: Math.ceil(e.bottom * k) + pad,
    }
  }

  const contains = (outer: RectPx, inner: RectPx): boolean =>
    outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 && outer.y1 >= inner.y1

  const intersect = (a: RectPx, b: RectPx): RectPx => ({
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  })

  /** `k`: the whole scale the layer is painted at; `ratio`: screen pixels per layer pixel (1 at a whole zoom). */
  const ensureStatic = (
    view: Viewport,
    frame: Frame,
    k: number,
    ratio: number,
    lit: boolean,
    bucket: number,
  ): StaticCache => {
    if (!prepared) throw new Error('renderer has no model')
    const prep = prepared
    const world = worldRect(prep, k)
    const seen = intersect(regionOf(view, frame.camera, ratio), world)
    const key = `${prep.signature}|${frame.theme}|${k}|${bucket}|${lit ? 1 : 0}`
    if (cache && cache.key === key && (cache.full || contains(cache.region, seen))) return cache

    const w = world.x1 - world.x0
    const h = world.y1 - world.y0
    const full = w * h <= MAX_CACHE_PIXELS && w <= MAX_CACHE_SIDE && h <= MAX_CACHE_SIDE
    let region: RectPx
    if (full) {
      region = world
    } else {
      const mx = Math.round((view.width * 0.5) / ratio / SNAP) * SNAP + SNAP
      const my = Math.round((view.height * 0.5) / ratio / SNAP) * SNAP + SNAP
      region = intersect(
        {
          x0: Math.floor((seen.x0 - mx) / SNAP) * SNAP,
          y0: Math.floor((seen.y0 - my) / SNAP) * SNAP,
          x1: Math.ceil((seen.x1 + mx) / SNAP) * SNAP,
          y1: Math.ceil((seen.y1 + my) / SNAP) * SNAP,
        },
        world,
      )
    }
    const base = createLayer(doc, Math.max(1, region.x1 - region.x0), Math.max(1, region.y1 - region.y0))
    const pass: Pass = { prep, theme: frame.theme, lit, k, offX: -region.x0, offY: -region.y0, region }
    paintBase(base.ctx, pass)
    let lights: Layer | null = null
    if (lit) {
      lights = createLayer(doc, base.width, base.height)
      paintLights(lights.ctx, pass)
    }
    cache = { key, region, full, base, lights }
    return cache
  }

  // ── Frame helpers ─────────────────────────────────────────────────────────────────────────────

  const drawSky = (target: Draw2D, width: number, height: number, sky: Sky): void => {
    const gradient = target.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, sky.top)
    gradient.addColorStop(1, sky.bottom)
    target.fillStyle = gradient
    target.fillRect(0, 0, width, height)
  }

  const STARS = 70
  const drawStars = (target: Draw2D, width: number, height: number, unit: number, sky: Sky, nowMs: number, motion: boolean): void => {
    const strength = Math.max(0, (sky.ambient - 0.5) * 2)
    if (strength <= 0) return
    for (let i = 0; i < STARS; i++) {
      const rng = mulberry32(hash32(`star:${i}`))
      const x = Math.floor(rng() * width)
      const y = Math.floor(rng() * height * 0.62)
      const twinkle = motion ? 0.75 + 0.25 * Math.sin(nowMs / 900 + i * 1.7) : 1
      const size = rng() < 0.15 ? 2 * unit : unit
      target.fillStyle = `rgba(255, 255, 255, ${(0.55 * strength * twinkle * (0.5 + rng() * 0.5)).toFixed(3)})`
      target.fillRect(x - (x % unit), y - (y % unit), size, size)
    }
  }

  /** The person's colours, from the palette. */
  const personColour = (theme: Theme, w: Walker): string => {
    const c = paletteFor(theme).hues[w.hue]
    return theme === 'dark' ? c.text : shade(c.text, -4)
  }

  const inFrontOfPerson = (a: Placed, personDepth: number): boolean => depthKey(a) > personDepth

  const drawWalkers = (target: Draw2D, prep: Prepared, frame: Frame, k: number, offX: number, offY: number, lit: boolean): void => {
    if (!frame.motion || prep.walkers.length === 0) return
    const seconds = frame.nowMs / 1000
    const streak = prep.model.stats.streakLevel
    for (const w of prep.walkers) {
      const pose = walkerAt(w, seconds)
      const s = toScreen(pose.x, pose.y, 1)
      const px = Math.round(s.sx)
      const py = Math.round(s.sy)
      target.fillStyle = personColour(frame.theme, w)
      target.fillRect(offX + px * k, offY + (py - 2) * k, k, 2 * k)
      target.fillStyle = shade('#c9a58c', frame.theme === 'dark' ? -12 : 0)
      target.fillRect(offX + px * k, offY + (py - 3) * k, k, k)
      // Anything nearer the viewer that overlaps them is painted over them again, so people walk behind buildings.
      const person: Box = { x: px, y: py - 3, w: 1, h: 3 }
      const personDepth = Math.floor(pose.x) + Math.floor(pose.y)
      let clipped = false
      prep.model.earned.forEach((p, i) => {
        const box = prep.earnedBoxes[i]
        if (!box || !inFrontOfPerson(p, personDepth) || !boxesOverlap(box, person)) return
        if (!clipped) {
          target.save()
          target.beginPath()
          target.rect(offX + (px - 1) * k, offY + (py - 4) * k, 3 * k, 5 * k)
          target.clip()
          clipped = true
        }
        const s2 = toScreen(p.x, p.y, 1)
        stamp(target, bitmapsFor(specFor(p, frame.theme, lit, streak)).base, s2.sx, s2.sy, k, offX, offY)
      })
      if (clipped) target.restore()
    }
  }

  const drawFountain = (target: Draw2D, prep: Prepared, frame: Frame, k: number, offX: number, offY: number): void => {
    if (prep.model.stats.streakLevel < 4 || !prep.host) return
    const s = toScreen(prep.host.x, prep.host.y, 1)
    const f = frame.motion ? fountainFrame(frame.nowMs) : 0
    stamp(target, fountainBitmap(frame.theme, f), s.sx, s.sy, k, offX, offY)
  }

  const drawBirds = (target: Draw2D, view: Viewport, prep: Prepared, frame: Frame, sky: Sky): void => {
    if (!frame.motion || prep.model.stats.streakLevel < 3) return
    if (sky.phase !== 'day' && sky.phase !== 'dusk') return
    const size = view.unit * Math.max(1, Math.round(frame.camera.zoom / 2))
    const pal = paletteFor(frame.theme)
    target.fillStyle = withAlpha(pal.hues.gray.text, 0.75)
    for (const b of birdsAt(frame.nowMs)) {
      const x = Math.round((b.x * (view.width + 12 * size) - 6 * size) / size) * size
      const y = Math.round((b.y * view.height) / size) * size
      const up = b.flap === 0
      target.fillRect(x - size, y + (up ? 0 : size), size, size)
      target.fillRect(x, y + (up ? size : 0), size, size)
      target.fillRect(x + size, y + (up ? 0 : size), size, size)
    }
  }

  const drawHighlight = (target: Draw2D, prep: Prepared, frame: Frame, k: number, offX: number, offY: number, lit: boolean): void => {
    if (frame.highlightId === null) return
    const p = prep.byId.get(frame.highlightId)
    if (!p) return
    const spec = specFor(p, frame.theme, lit, prep.model.stats.streakLevel)
    const ring = frame.theme === 'dark' ? 'rgba(255, 255, 255, 0.92)' : 'rgba(55, 53, 47, 0.92)'
    const silhouette = outlineOf(spec, ring)
    const s = toScreen(p.x, p.y, 1)
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      stamp(target, silhouette, s.sx + dx, s.sy + dy, k, offX, offY)
    }
    stamp(target, bitmapsFor(spec).base, s.sx, s.sy, k, offX, offY)
  }

  const flicker = (p: Placed, nowMs: number, motion: boolean): number => {
    if (!motion) return 1
    const phase = (hash32(p.id) % 628) / 100
    return 0.88 + 0.12 * Math.sin(nowMs / 420 + phase) * Math.sin(nowMs / 1130 + phase * 1.7)
  }

  const drawGlows = (target: Draw2D, prep: Prepared, frame: Frame, view: Viewport, k: number, offX: number, offY: number): void => {
    const pal = paletteFor(frame.theme)
    for (const p of prep.lamps) {
      const s = toScreen(p.x, p.y, 1)
      const cx = offX + s.sx * k
      const cy = offY + (s.sy - 8) * k
      if (cx < -8 * k || cx > view.width + 8 * k || cy < -8 * k || cy > view.height + 8 * k) continue
      const f = flicker(p, frame.nowMs, frame.motion)
      // A soft pool of light: a wide faint glow around a 5x3 brighter one.
      target.fillStyle = withAlpha(pal.windowLit, 0.12 * f)
      target.fillRect(cx - 4 * k, cy - 3 * k, 9 * k, 6 * k)
      target.fillStyle = withAlpha(pal.windowLit, 0.35 * f)
      target.fillRect(cx - 2 * k, cy - 1 * k, 5 * k, 3 * k)
    }
  }

  const FIREWORK_COLOURS = ['#f2c66d', '#f0a3c0', '#9cc9ee', '#f4f1ea'] as const
  const drawFirework = (target: Draw2D, prep: Prepared, frame: Frame, k: number, offX: number, offY: number): void => {
    if (!frame.motion || prep.model.stats.streakLevel < 4 || !prep.host) return
    const burst = firework(frame.nowMs)
    if (!burst) return
    const s = toScreen(prep.host.x, prep.host.y, 1)
    const cx = s.sx + burst.dx
    const cy = s.sy - 78 + burst.dy
    const colour = FIREWORK_COLOURS[burst.colour % FIREWORK_COLOURS.length] ?? '#f2c66d'
    for (const spark of sparksOf(burst)) {
      target.fillStyle = withAlpha(colour, spark.alpha)
      target.fillRect(offX + Math.round(cx + spark.dx) * k, offY + Math.round(cy + spark.dy) * k, k, k)
    }
  }

  const overlayColour = (theme: Theme, ambient: number): string =>
    `rgba(20, 26, 38, ${((theme === 'dark' ? 0.28 : 0.4) * ambient).toFixed(3)})`

  const skyFor = (frame: Frame): Sky => skyAt(localMinutes(frame.nowMs), frame.theme)

  /** Windows glow for a whole 15-minute bucket at a time, from the middle of it. */
  const bucketOf = (frame: Frame): { bucket: number; lit: boolean } => {
    const minutes = localMinutes(frame.nowMs)
    const bucket = Math.floor(minutes / BUCKET_MINUTES)
    const lit = skyAt(bucket * BUCKET_MINUTES + BUCKET_MINUTES / 2, frame.theme).windowsLit
    return { bucket, lit }
  }

  const animated = (frame: Frame): boolean => {
    if (!prepared || !frame.motion) return false
    const prep = prepared
    const streak = prep.model.stats.streakLevel
    const sky = skyFor(frame)
    if (prep.walkers.length > 0) return true
    if (streak >= 3 && (sky.phase === 'day' || sky.phase === 'dusk')) return true
    if (streak >= 4 && prep.host) return true
    return sky.windowsLit && prep.lamps.length > 0
  }

  /** Puts a static layer on the canvas: 1:1 at a whole zoom, otherwise resampled with smoothing (one pass). */
  const blit = (src: Layer, region: RectPx, o: { x: number; y: number }, ratio: number): void => {
    if (ratio === 1) {
      ctx.drawImage(src.surface, o.x + region.x0, o.y + region.y0)
      return
    }
    const x0 = Math.round(o.x + region.x0 * ratio)
    const y0 = Math.round(o.y + region.y0 * ratio)
    const x1 = Math.round(o.x + region.x1 * ratio)
    const y1 = Math.round(o.y + region.y1 * ratio)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src.surface, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0))
    ctx.imageSmoothingEnabled = false
  }

  const render = (view: Viewport, frame: Frame): boolean => {
    if (destroyed || !prepared) return false
    const prep = prepared
    ctx.imageSmoothingEnabled = false
    const k = frame.camera.zoom * view.unit
    // The static layer is painted at a whole scale; below or between whole scales it is resampled once.
    const paintK = Math.max(1, Math.ceil(k - 1e-6))
    const ratio = k / paintK
    const o = originOf(frame.camera, view, view.unit)
    const sky = skyFor(frame)
    const { bucket, lit } = bucketOf(frame)

    drawSky(ctx, view.width, view.height, sky)
    drawStars(ctx, view.width, view.height, view.unit, sky, frame.nowMs, frame.motion)

    const layer = ensureStatic(view, frame, paintK, ratio, lit, bucket)
    blit(layer.base, layer.region, o, ratio)

    drawWalkers(ctx, prep, frame, k, o.x, o.y, lit)
    drawFountain(ctx, prep, frame, k, o.x, o.y)
    drawHighlight(ctx, prep, frame, k, o.x, o.y, lit)
    drawBirds(ctx, view, prep, frame, sky)

    if (sky.ambient > 0) {
      ctx.fillStyle = overlayColour(frame.theme, sky.ambient)
      ctx.fillRect(0, 0, view.width, view.height)
    }
    if (layer.lights) blit(layer.lights, layer.region, o, ratio)
    if (lit) {
      drawGlows(ctx, prep, frame, view, k, o.x, o.y)
      drawFirework(ctx, prep, frame, k, o.x, o.y)
    }
    return animated(frame)
  }

  // ── Export ────────────────────────────────────────────────────────────────────────────────────

  const exportPng = async (frame: Frame, options: { zoom: number; caption: string }): Promise<Blob> => {
    if (!prepared) throw new Error('renderer has no model')
    const prep = prepared
    const k = Math.max(1, Math.round(options.zoom))
    const e = prep.extent
    const pad = 24
    const padBottom = 40
    const width = Math.round((e.right - e.left + 2 * pad) * k)
    const height = Math.round((e.bottom - e.top + pad + padBottom) * k)
    const target = createLayer(doc, width, height)
    const t = target.ctx
    const sky = skyFor(frame)
    const { lit } = bucketOf(frame)
    drawSky(t, width, height, sky)
    drawStars(t, width, height, k, sky, frame.nowMs, false)
    const offX = Math.round((pad - e.left) * k)
    const offY = Math.round((pad - e.top) * k)
    const region: RectPx = { x0: -offX, y0: -offY, x1: width - offX, y1: height - offY }
    const pass: Pass = { prep, theme: frame.theme, lit, k, offX, offY, region }
    paintBase(t, pass)
    if (sky.ambient > 0) {
      t.fillStyle = overlayColour(frame.theme, sky.ambient)
      t.fillRect(0, 0, width, height)
    }
    if (lit) {
      paintLights(t, pass)
      drawGlows(t, prep, { ...frame, motion: false }, { width, height, unit: k }, k, offX, offY)
    }
    t.font = `${12 * k}px "Inter Variable", ui-sans-serif, sans-serif`
    t.textBaseline = 'alphabetic'
    t.fillStyle = sky.ambient > 0.5 || frame.theme === 'dark' ? 'rgba(255, 255, 255, 0.72)' : 'rgba(55, 53, 47, 0.72)'
    t.fillText(options.caption, 16 * k, height - 14 * k)
    return target.toPng()
  }

  return {
    setModel(model) {
      const next = prepare(model)
      // A new static layer is only needed when what it shows changed.
      if (prepared === null || prepared.signature !== next.signature) cache = null
      prepared = next
    },
    extent: () => prepared?.extent ?? { left: 0, top: 0, right: 0, bottom: 0 },
    render,
    animated,
    exportPng,
    screenPointOf(id, view, camera) {
      const p = prepared?.byId.get(id)
      if (!p) return null
      const o = originOf(camera, view, view.unit)
      const k = camera.zoom * view.unit
      const s = toScreen(p.x + p.w / 2, p.y + p.h / 2, 1)
      return { x: o.x + s.sx * k, y: o.y + s.sy * k }
    },
    destroy() {
      destroyed = true
      cache = null
      prepared = null
      sprites.clear()
      extras.clear()
    },
  }
}
