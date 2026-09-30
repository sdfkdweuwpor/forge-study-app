import { describe, expect, it } from 'vitest'
import {
  artToScreen,
  centreOf,
  clampToExtent,
  clampZoom,
  fitCamera,
  fitZoom,
  originOf,
  panBy,
  pinchStep,
  screenToArt,
  zoomAbout,
} from './camera'
import type { Extent } from './iso'

const view = { width: 1200, height: 800 }
const extent: Extent = { left: -160, top: -40, right: 160, bottom: 200 }

describe('zoom levels', () => {
  it('rounds and clamps to 1..4', () => {
    expect(clampZoom(0)).toBe(1)
    expect(clampZoom(1.4)).toBe(1)
    expect(clampZoom(1.5)).toBe(2)
    expect(clampZoom(9)).toBe(4)
    expect(clampZoom(Number.NaN)).toBe(1)
  })
})

describe('fit to view', () => {
  it('takes the largest zoom that fits with the padding', () => {
    // 320 x 240 art px: zoom 3 needs 960 x 720 + 48 = 1008 x 768, which fits 1200 x 800.
    expect(fitZoom(extent, view, 24, 1)).toBe(3)
    expect(fitZoom(extent, { width: 1400, height: 1100 }, 24, 1)).toBe(4)
    expect(fitZoom(extent, { width: 700, height: 800 }, 24, 1)).toBe(2)
  })

  it('never goes below 1, even for a world that does not fit', () => {
    const huge: Extent = { left: -5000, top: -5000, right: 5000, bottom: 5000 }
    expect(fitZoom(huge, view, 24, 1)).toBe(1)
  })

  it('counts device pixels per art pixel', () => {
    // At 2 pixels per art pixel the same world only fits at half the zoom.
    expect(fitZoom(extent, { width: 1200, height: 800 }, 48, 2)).toBe(1)
    expect(fitZoom(extent, { width: 2400, height: 1600 }, 48, 2)).toBe(3)
  })

  it('centres on the extent', () => {
    expect(centreOf(extent)).toEqual({ cx: 0, cy: 80 })
    const cam = fitCamera(extent, view, 24, 1)
    expect(cam).toEqual({ cx: 0, cy: 80, zoom: 3 })
    // The middle of the extent is the middle of the view.
    expect(artToScreen(cam, view, 1, { x: 0, y: 80 })).toEqual({ x: 600, y: 400 })
  })
})

describe('coordinates', () => {
  const cam = { cx: 10, cy: 20, zoom: 3 }

  it('puts the camera point in the middle and round-trips', () => {
    expect(originOf(cam, view, 1)).toEqual({ x: 570, y: 340 })
    expect(artToScreen(cam, view, 1, { x: 10, y: 20 })).toEqual({ x: 600, y: 400 })
    const back = screenToArt(cam, view, 1, { x: 630, y: 460 })
    expect(back.x).toBeCloseTo(20, 9)
    expect(back.y).toBeCloseTo(40, 9)
  })

  it('lands art pixels on whole screen pixels', () => {
    const c = { cx: 3.37, cy: -8.9, zoom: 2 }
    const o = originOf(c, view, 2)
    expect(Number.isInteger(o.x)).toBe(true)
    expect(Number.isInteger(o.y)).toBe(true)
  })
})

describe('zoomAbout', () => {
  it('keeps the point under the pointer where it is', () => {
    const cam = { cx: 30, cy: 50, zoom: 1 }
    const anchor = { x: 900, y: 300 }
    const before = screenToArt(cam, view, 1, anchor)
    const next = zoomAbout(cam, 3, anchor, view, 1)
    expect(next.zoom).toBe(3)
    const after = screenToArt(next, view, 1, anchor)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('keeps the middle when anchored in the middle, and ignores the same zoom', () => {
    const cam = { cx: 30, cy: 50, zoom: 2 }
    const next = zoomAbout(cam, 4, { x: 600, y: 400 }, view, 1)
    expect(next.cx).toBeCloseTo(30, 9)
    expect(next.cy).toBeCloseTo(50, 9)
    expect(zoomAbout(cam, 2, { x: 0, y: 0 }, view, 1)).toBe(cam)
    expect(zoomAbout(cam, 99, { x: 0, y: 0 }, view, 1).zoom).toBe(4)
  })
})

describe('panBy and clamping', () => {
  it('moves the world with the pointer', () => {
    const cam = { cx: 0, cy: 0, zoom: 2 }
    const next = panBy(cam, 40, -20, 1)
    expect(next).toEqual({ cx: -20, cy: 10, zoom: 2 })
    // The world point that was in the middle is now 40 px right and 20 px up.
    expect(artToScreen(next, view, 1, { x: 0, y: 0 })).toEqual({ x: 640, y: 380 })
  })

  it('keeps the centre inside the world', () => {
    expect(clampToExtent({ cx: 999, cy: -999, zoom: 1 }, extent)).toEqual({ cx: 160, cy: -40, zoom: 1 })
    const ok = { cx: 0, cy: 0, zoom: 1 }
    expect(clampToExtent(ok, extent)).toBe(ok)
  })
})

describe('pinchStep', () => {
  it('steps at 1.25 and 0.8 of the starting distance', () => {
    expect(pinchStep(100, 100)).toBe(0)
    expect(pinchStep(100, 124)).toBe(0)
    expect(pinchStep(100, 125)).toBe(1)
    expect(pinchStep(100, 81)).toBe(0)
    expect(pinchStep(100, 80)).toBe(-1)
    expect(pinchStep(0, 50)).toBe(0)
  })
})
