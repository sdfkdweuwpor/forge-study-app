import type { Extent } from './iso'

/**
 * The camera of the world view. Pure maths on numbers: the canvas never appears here.
 *
 * The camera is the point of the world (in art pixels at zoom 1) that sits in the middle of the view,
 * plus a zoom. `unit` is how many screen pixels one art pixel takes at zoom 1 (the device pixel ratio,
 * rounded), so at the whole zoom levels 1 to 4 the screen scale is a whole number and the pixel art
 * stays crisp. One more level exists below them, and only when the whole city does not fit at zoom 1:
 * the fit zoom, a fraction (see `fitZoom`). The person reaches it with Fit, or by zooming out from 1.
 */
export const MIN_ZOOM = 1
export const MAX_ZOOM = 4
/**
 * The smallest scale Fit will pick, in screen pixels per art pixel. Below this a city is a smear of
 * dots, so a city too big for it is shown at this scale and panned, not shrunk further.
 */
export const MIN_FIT_SCALE = 0.1
/** Zoom values closer than this are the same level (they come from a division). */
const ZOOM_EPS = 1e-6

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

/**
 * Rounds to a whole zoom level and keeps it inside 1..4. `floor` is the lowest level the view can be at
 * (the fit zoom when the whole city does not fit at zoom 1, otherwise 1): anything that rounds below 1
 * lands there, so a fraction is only ever the floor itself, never an arbitrary in-between.
 */
export function clampZoom(zoom: number, floor: number = MIN_ZOOM): number {
  const low = Math.min(MIN_ZOOM, floor)
  if (!Number.isFinite(zoom) || zoom < MIN_ZOOM - ZOOM_EPS) return low
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)))
}

/**
 * One zoom level in or out from `zoom`: the next whole level above, or the next one below; out of 1 it
 * goes to `floor` (the fit zoom) when that is a fraction, and from the floor it stays. A fractional zoom
 * steps in to 1, never past it.
 */
export function stepZoom(zoom: number, dir: 1 | -1, floor: number = MIN_ZOOM): number {
  const low = Math.min(MIN_ZOOM, floor)
  if (!Number.isFinite(zoom)) return low
  if (dir > 0) {
    if (zoom < MIN_ZOOM - ZOOM_EPS) return MIN_ZOOM
    return Math.min(MAX_ZOOM, Math.floor(zoom + ZOOM_EPS) + 1)
  }
  if (zoom <= low + ZOOM_EPS) return low
  if (zoom <= MIN_ZOOM + ZOOM_EPS) return low
  return Math.max(MIN_ZOOM, Math.ceil(zoom - ZOOM_EPS) - 1)
}

/** Screen pixels per art pixel. */
export const scaleOf = (zoom: number, unit: number): number => zoom * unit

export function centreOf(extent: Extent): { cx: number; cy: number } {
  return { cx: (extent.left + extent.right) / 2, cy: (extent.top + extent.bottom) / 2 }
}

/**
 * The zoom at which all of `extent` fits the view with `padding` screen pixels on every side.
 *
 * The largest whole zoom (1 to 4) that fits, so the pixels stay crisp. Only when not even zoom 1 fits (a
 * phone, or a big city) does it fall back to a fraction: the largest one that fits, rounded down so it
 * never overflows by a rounding error. A city too big for `MIN_FIT_SCALE` is shown at that scale and
 * panned, not shrunk to dots.
 */
export function fitZoom(extent: Extent, view: View, padding: number, unit: number): number {
  const w = Math.max(1, extent.right - extent.left)
  const h = Math.max(1, extent.bottom - extent.top)
  const roomW = view.width - 2 * padding
  const roomH = view.height - 2 * padding
  for (let zoom = MAX_ZOOM; zoom >= MIN_ZOOM; zoom--) {
    const s = scaleOf(zoom, unit)
    if (w * s <= roomW && h * s <= roomH) return zoom
  }
  const exact = Math.min(roomW / w, roomH / h) / unit
  const floored = Math.floor(exact * 1000) / 1000
  return Math.max(MIN_FIT_SCALE / unit, Math.min(floored, MIN_ZOOM))
}

/** The lowest zoom the view can reach: the fit zoom when it is a fraction, otherwise 1. */
export function zoomFloor(extent: Extent, view: View, padding: number, unit: number): number {
  return Math.min(MIN_ZOOM, fitZoom(extent, view, padding, unit))
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
export function zoomAbout(
  cam: Camera,
  zoom: number,
  anchor: ScreenXY,
  view: View,
  unit: number,
  floor: number = MIN_ZOOM,
): Camera {
  const next = clampZoom(zoom, floor)
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
