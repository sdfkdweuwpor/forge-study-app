/**
 * The public API of the My World canvas engine: `mountWorld(canvas, model, options)`.
 *
 * The engine draws on the canvas it is given and touches nothing else: it sets no styles on it (the app
 * owns the CSS, `tabindex` and `touch-action: none`) and reads only its size, its `ownerDocument` and
 * that document's window (`devicePixelRatio`, timers, animation frames). The app calls `resize()` from a
 * ResizeObserver and `destroy()` when it unmounts.
 */
import {
  clampToExtent,
  clampZoom,
  fitCamera,
  hitsSprite,
  originOf,
  panBy,
  pointInBox,
  spriteBox,
  zoomAbout,
  type Box,
  type Camera,
  type Placed,
  type Theme,
  type WorldModel,
} from '@/logic/world'
import { attachInput, type Pt } from './input'
import { createRenderer, type Frame, type Renderer, type Viewport } from './renderer'

export interface MountOptions {
  theme: Theme
  reducedMotion: boolean
  /** Injected clock; the app passes `Date.now`. */
  now: () => number
  /** Called with the item under the pointer (or focused with the keyboard) and where, in canvas CSS pixels. */
  onHover?: (item: Placed | null, at: { x: number; y: number }, via?: 'pointer' | 'keyboard') => void
}

export interface WorldHandle {
  /** Keeps the camera; if the world grew, the same point stays in the middle. */
  update(model: WorldModel): void
  setTheme(theme: Theme): void
  setReducedMotion(value: boolean): void
  /** Re-reads the canvas size and pixel ratio. The app calls this from a ResizeObserver. */
  resize(): void
  /** The item at a client (page) point. */
  hitTest(clientX: number, clientY: number): Placed | null
  /** Sets the zoom (1-4, rounded) around the middle of the view. */
  zoomTo(level: number): void
  /** The current zoom level. */
  zoom(): number
  fit(): void
  /** Where an item's middle is, in client (page) coordinates, or null if it is not in the model. */
  clientPointOf(id: string): { x: number; y: number } | null
  /** The whole world as a PNG (default zoom 2, reduced so neither side passes 8192 px). */
  exportPng(opts?: { zoom?: 1 | 2 | 3 | 4; caption?: string }): Promise<Blob>
  /** Removes every listener, observer and timer, and cancels the frame loop. Safe to call twice. */
  destroy(): void
}

const FIT_PADDING_CSS = 24
const MAX_EXPORT_SIDE = 8192
/** Frames are capped at 30 a second while something animates. */
const FRAME_MS = 1000 / 30
const CLOCK_MS = 60_000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** `Sep 29, 2026`, in English whatever the locale (it is part of an image people share). */
function captionDate(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()] ?? ''} ${d.getDate()}, ${d.getFullYear()}`
}

export function mountWorld(canvas: HTMLCanvasElement, initial: WorldModel, opts: MountOptions): WorldHandle {
  const owner = canvas.ownerDocument.defaultView
  if (owner === null) throw new Error('The world canvas must be attached to a window.')
  const win: Window & typeof globalThis = owner
  const doc = canvas.ownerDocument

  let model = initial
  /** `spriteBox` of every earned item at zoom 1, parallel to `model.earned`: the cheap first cut of a hit test. */
  let boxes: Box[] = initial.earned.map((p) => spriteBox(p, 1))
  let theme = opts.theme
  let reducedMotion = opts.reducedMotion
  let destroyed = false

  const renderer: Renderer = createRenderer(canvas)
  renderer.setModel(model)

  // Device-pixel view: `unit` is the pixel ratio rounded, so an art pixel is a whole number of pixels.
  let cssWidth = 0
  let cssHeight = 0
  let toDevice = 1
  const view: Viewport = { width: 1, height: 1, unit: 1 }
  let camera: Camera = { cx: 0, cy: 0, zoom: 1 }
  /** False until the person pans or zooms: until then the view keeps re-fitting as the world or window changes. */
  let touched = false
  let highlightId: string | null = null
  let hoverVia: 'pointer' | 'keyboard' = 'pointer'

  /** Bumps whenever the picture moves, so a keyboard tooltip is only re-placed when it has to be. */
  let cameraVersion = 0
  let placedAt = -1
  const clampCam = (cam: Camera): Camera => clampToExtent(cam, renderer.extent())
  const setCamera = (cam: Camera, byUser: boolean): void => {
    camera = clampCam(cam)
    cameraVersion += 1
    if (byUser) touched = true
    invalidate()
  }

  const fitView = (): void => {
    camera = fitCamera(renderer.extent(), view, FIT_PADDING_CSS * toDevice, view.unit)
    cameraVersion += 1
  }

  // ── Frame loop ─────────────────────────────────────────────────────────────────────────────────
  let raf = 0
  let lastFrameAt = -Infinity
  let dirty = true
  let intersecting = true
  let looping = false

  const frameState = (): Frame => ({
    camera,
    theme,
    motion: !reducedMotion,
    highlightId,
    nowMs: opts.now(),
  })

  const visible = (): boolean => !doc.hidden && intersecting

  function schedule(): void {
    if (raf !== 0 || destroyed || !visible()) return
    raf = win.requestAnimationFrame(tick)
  }

  function invalidate(): void {
    dirty = true
    schedule()
  }

  function tick(t: number): void {
    raf = 0
    if (destroyed) return
    // While only an animation asks for frames, hold to 30 a second; a change the person made draws at once.
    if (!dirty && t - lastFrameAt < FRAME_MS - 1) {
      schedule()
      return
    }
    lastFrameAt = t
    dirty = false
    looping = renderer.render(view, frameState())
    if (looping) schedule()
    if (hoverVia === 'keyboard' && placedAt !== cameraVersion) refreshKeyboardTooltip()
  }

  // ── Size ───────────────────────────────────────────────────────────────────────────────────────
  function resize(): void {
    if (destroyed) return
    const rect = canvas.getBoundingClientRect()
    const dpr = win.devicePixelRatio > 0 ? win.devicePixelRatio : 1
    cssWidth = rect.width
    cssHeight = rect.height
    view.unit = Math.max(1, Math.round(dpr))
    view.width = Math.max(1, Math.round(cssWidth * dpr))
    view.height = Math.max(1, Math.round(cssHeight * dpr))
    toDevice = cssWidth > 0 ? view.width / cssWidth : dpr
    if (canvas.width !== view.width) canvas.width = view.width
    if (canvas.height !== view.height) canvas.height = view.height
    if (!touched && cssWidth > 0 && cssHeight > 0) fitView()
    else camera = clampCam(camera)
    cameraVersion += 1
    invalidate()
  }

  // ── Hit testing and coordinates ────────────────────────────────────────────────────────────────
  const hitDevice = (dx: number, dy: number): Placed | null => {
    const o = originOf(camera, view, view.unit)
    const k = camera.zoom * view.unit
    // In art pixels at zoom 1, so most items are ruled out by a box compare that allocates nothing.
    const ax = (dx - o.x) / k
    const ay = (dy - o.y) / k
    for (let i = model.earned.length - 1; i >= 0; i--) {
      const p = model.earned[i]
      const box = boxes[i]
      if (p && box && pointInBox(box, ax, ay) && hitsSprite(p, ax, ay, 1)) return p
    }
    return null
  }

  /**
   * A point (device pixels) where the item really is what you would hit: its footprint's middle, or, when
   * something nearer the viewer stands over that, a nearby point on the building itself.
   */
  const visiblePoint = (id: string): Pt | null => {
    const middle = renderer.screenPointOf(id, view, camera)
    if (!middle) return null
    const k = camera.zoom * view.unit
    for (const dy of [0, -4, -8, -12, -16, -20, 4]) {
      for (const dx of [0, -6, 6, -10, 10]) {
        const x = middle.x + dx * k
        const y = middle.y + dy * k
        if (hitDevice(x, y)?.id === id) return { x, y }
      }
    }
    return middle
  }

  const cssPointOf = (id: string): Pt | null => {
    const d = visiblePoint(id)
    return d ? { x: d.x / toDevice, y: d.y / toDevice } : null
  }

  function emitHover(item: Placed | null, at: Pt, via: 'pointer' | 'keyboard'): void {
    hoverVia = via
    highlightId = item?.id ?? null
    invalidate()
    opts.onHover?.(item, at, via)
  }

  function refreshKeyboardTooltip(): void {
    placedAt = cameraVersion
    if (highlightId === null) return
    const item = model.earned.find((p) => p.id === highlightId)
    const at = item ? cssPointOf(item.id) : null
    if (item && at) opts.onHover?.(item, at, 'keyboard')
  }

  // ── Camera actions ─────────────────────────────────────────────────────────────────────────────
  const zoomStep = (dir: 1 | -1, around?: Pt): void => {
    const anchor = around ? { x: around.x * toDevice, y: around.y * toDevice } : { x: view.width / 2, y: view.height / 2 }
    setCamera(zoomAbout(camera, camera.zoom + dir, anchor, view, view.unit), true)
  }

  const input = attachInput({
    canvas,
    hitAt: (css) => hitDevice(css.x * toDevice, css.y * toDevice),
    pan: (dx, dy) => setCamera(panBy(camera, dx * toDevice, dy * toDevice, view.unit), true),
    zoomStep,
    fit: () => {
      touched = false
      fitView()
      invalidate()
    },
    items: () => model.earned,
    reveal: (item) => {
      const at = cssPointOf(item.id) ?? { x: cssWidth / 2, y: cssHeight / 2 }
      const margin = 48
      if (at.x < margin || at.y < margin || at.x > cssWidth - margin || at.y > cssHeight - margin) {
        // Bring it to the middle of the view.
        const d = renderer.screenPointOf(item.id, view, camera)
        if (d) {
          camera = clampCam(panBy(camera, view.width / 2 - d.x, view.height / 2 - d.y, view.unit))
          cameraVersion += 1
          touched = true
        }
      }
      // `emitHover` runs after this, so the outline follows the item.
      highlightId = item.id
      invalidate()
      return cssPointOf(item.id) ?? at
    },
    hover: emitHover,
  })

  // ── Pause when nobody is looking ───────────────────────────────────────────────────────────────
  const onVisibility = (): void => {
    if (doc.hidden) {
      if (raf !== 0) win.cancelAnimationFrame(raf)
      raf = 0
    } else invalidate()
  }
  doc.addEventListener('visibilitychange', onVisibility)

  let observer: IntersectionObserver | null = null
  if (typeof win.IntersectionObserver === 'function') {
    observer = new win.IntersectionObserver((entries) => {
      const last = entries[entries.length - 1]
      if (!last) return
      intersecting = last.isIntersecting
      if (intersecting) invalidate()
      else if (raf !== 0) {
        win.cancelAnimationFrame(raf)
        raf = 0
      }
    })
    observer.observe(canvas)
  }

  // Time of day: while the loop is paused, look again once a minute (the sky and the 15-minute bucket).
  const clock = win.setInterval(() => {
    if (!destroyed) invalidate()
  }, CLOCK_MS)

  resize()

  return {
    update(next) {
      if (destroyed) return
      model = next
      boxes = next.earned.map((p) => spriteBox(p, 1))
      renderer.setModel(next)
      input.reset()
      if (highlightId !== null && !next.earned.some((p) => p.id === highlightId)) {
        highlightId = null
        opts.onHover?.(null, { x: 0, y: 0 }, 'pointer')
      }
      if (!touched && cssWidth > 0) fitView()
      else camera = clampCam(camera)
      cameraVersion += 1
      invalidate()
    },
    setTheme(next) {
      if (destroyed || next === theme) return
      theme = next
      invalidate()
    },
    setReducedMotion(value) {
      if (destroyed || value === reducedMotion) return
      reducedMotion = value
      invalidate()
    },
    resize,
    hitTest(clientX, clientY) {
      const r = canvas.getBoundingClientRect()
      return hitDevice((clientX - r.left) * toDevice, (clientY - r.top) * toDevice)
    },
    zoomTo(level) {
      if (destroyed) return
      setCamera(zoomAbout(camera, clampZoom(level), { x: view.width / 2, y: view.height / 2 }, view, view.unit), true)
    },
    zoom: () => camera.zoom,
    fit() {
      if (destroyed) return
      touched = false
      fitView()
      invalidate()
    },
    clientPointOf(id) {
      const at = cssPointOf(id)
      if (!at) return null
      const r = canvas.getBoundingClientRect()
      return { x: r.left + at.x, y: r.top + at.y }
    },
    async exportPng(options) {
      if (destroyed) throw new Error('The world has been closed.')
      const e = renderer.extent()
      const width = e.right - e.left + 48
      const height = e.bottom - e.top + 64
      const want = options?.zoom ?? 2
      const zoom = Math.max(1, Math.min(want, Math.floor(MAX_EXPORT_SIDE / width), Math.floor(MAX_EXPORT_SIDE / height)))
      const now = opts.now()
      const caption =
        options?.caption ??
        `Forge · ${captionDate(now)} · ${model.stats.tiles} tiles · ${model.stats.floors} floors`
      return renderer.exportPng({ camera, theme, motion: false, highlightId: null, nowMs: now }, { zoom, caption })
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      if (raf !== 0) win.cancelAnimationFrame(raf)
      raf = 0
      win.clearInterval(clock)
      doc.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
      input.destroy()
      renderer.destroy()
    },
  }
}

