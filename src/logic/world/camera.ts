import type { Extent } from './iso'

/**
 * The camera of the world view. Pure maths on numbers: the canvas never appears here.
 *
 * The camera is the point of the world (in art pixels at zoom 1) that sits in the middle of the view,
 * plus an integer zoom. `unit` is how many screen pixels one art pixel takes at zoom 1 (the device
 * pixel ratio, rounded), so the screen scale is always a whole number and the pixel art stays crisp.
 */
export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export interface Camera {
  cx: number
  cy: number
  zoom: number
}

export interface View {
  width: number
  height: number
}

export interface ScreenXY {
  x: number
  y: number
}

/** Rounds to a whole zoom level and keeps it inside 1..4. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)))
}

/** Screen pixels per art pixel. */
export const scaleOf = (zoom: number, unit: number): number => zoom * unit

export function centreOf(extent: Extent): { cx: number; cy: number } {
  return { cx: (extent.left + extent.right) / 2, cy: (extent.top + extent.bottom) / 2 }
}

/**
 * The largest zoom at which `extent` fits the view with `padding` screen pixels on every side; never
 * below 1 (a very large world is then panned, not shrunk).
 */
export function fitZoom(extent: Extent, view: View, padding: number, unit: number): number {
  const w = Math.max(1, extent.right - extent.left)
  const h = Math.max(1, extent.bottom - extent.top)
  for (let zoom = MAX_ZOOM; zoom > MIN_ZOOM; zoom--) {
    const s = scaleOf(zoom, unit)
    if (w * s + 2 * padding <= view.width && h * s + 2 * padding <= view.height) return zoom
  }
  return MIN_ZOOM
}

/** Fit to view: the fitting zoom, centred on the extent. */
export function fitCamera(extent: Extent, view: View, padding: number, unit: number): Camera {
  return { ...centreOf(extent), zoom: fitZoom(extent, view, padding, unit) }
}

/** Where the world's origin (art pixel 0, 0) lands on screen, in whole pixels. */
export function originOf(cam: Camera, view: View, unit: number): ScreenXY {
  const s = scaleOf(cam.zoom, unit)
  return { x: Math.round(view.width / 2 - cam.cx * s), y: Math.round(view.height / 2 - cam.cy * s) }
}

/** The world point (art pixels) under a screen point. */
export function screenToArt(cam: Camera, view: View, unit: number, at: ScreenXY): ScreenXY {
  const o = originOf(cam, view, unit)
  const s = scaleOf(cam.zoom, unit)
  return { x: (at.x - o.x) / s, y: (at.y - o.y) / s }
}

/** The screen point (whole pixels) of a world point. */
export function artToScreen(cam: Camera, view: View, unit: number, art: ScreenXY): ScreenXY {
  const o = originOf(cam, view, unit)
  const s = scaleOf(cam.zoom, unit)
  return { x: o.x + Math.round(art.x * s), y: o.y + Math.round(art.y * s) }
}

/** Zooms to `zoom` keeping the world point under `anchor` (screen pixels) where it is. */
export function zoomAbout(cam: Camera, zoom: number, anchor: ScreenXY, view: View, unit: number): Camera {
  const next = clampZoom(zoom)
  if (next === cam.zoom) return cam
  const world = screenToArt(cam, view, unit, anchor)
  const s = scaleOf(next, unit)
  return {
    zoom: next,
    cx: world.x - (anchor.x - view.width / 2) / s,
    cy: world.y - (anchor.y - view.height / 2) / s,
  }
}

/** Moves the world with the pointer: dragging by `(dx, dy)` screen pixels. */
export function panBy(cam: Camera, dx: number, dy: number, unit: number): Camera {
  const s = scaleOf(cam.zoom, unit)
  return { ...cam, cx: cam.cx - dx / s, cy: cam.cy - dy / s }
}

/** Keeps the middle of the view inside the world, so it can never be dragged out of sight. */
export function clampToExtent(cam: Camera, extent: Extent): Camera {
  const cx = Math.min(extent.right, Math.max(extent.left, cam.cx))
  const cy = Math.min(extent.bottom, Math.max(extent.top, cam.cy))
  return cx === cam.cx && cy === cam.cy ? cam : { ...cam, cx, cy }
}

/** A pinch: one zoom step out or in once the fingers have moved 25% closer or further apart. */
export function pinchStep(startDistance: number, distance: number): -1 | 0 | 1 {
  if (!(startDistance > 0) || !Number.isFinite(distance)) return 0
  const ratio = distance / startDistance
  return ratio >= 1.25 ? 1 : ratio <= 0.8 ? -1 : 0
}
