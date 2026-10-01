import { describe, expect, it } from 'vitest'
import {
  MIN_FIT_SCALE,
  artToScreen,
  centreOf,
  clampToExtent,
  clampZoom,
  fitCamera,
  fitZoom,
  originOf,
  panBy,
  pinchStep,
  scaleOf,
  screenToArt,
  stepZoom,
  zoomAbout,
  zoomFloor,
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

  it('lets a fractional floor (the fit zoom) be the lowest level, and only that', () => {
    expect(clampZoom(0.5, 0.93)).toBe(0.93)
    expect(clampZoom(0.93, 0.93)).toBe(0.93)
    expect(clampZoom(1, 0.93)).toBe(1)
    expect(clampZoom(2.4, 0.93)).toBe(2)
    expect(clampZoom(Number.NaN, 0.93)).toBe(0.93)
    // A floor above 1 is not a floor: 1 is always reachable.
    expect(clampZoom(0, 3)).toBe(1)
  })
})

describe('stepZoom', () => {
  it('walks the whole levels and stops at both ends', () => {
    expect(stepZoom(1, 1)).toBe(2)
    expect(stepZoom(3, 1)).toBe(4)
    expect(stepZoom(4, 1)).toBe(4)
    expect(stepZoom(4, -1)).toBe(3)
    expect(stepZoom(2, -1)).toBe(1)
    expect(stepZoom(1, -1)).toBe(1)
  })

  it('reaches a fractional fit zoom below 1 and climbs back to 1, never past it', () => {
    const fit = 0.93
    expect(stepZoom(1, -1, fit)).toBe(fit)
    expect(stepZoom(fit, -1, fit)).toBe(fit)
    expect(stepZoom(fit, 1, fit)).toBe(1)
    expect(stepZoom(0.4, 1, fit)).toBe(1)
    expect(stepZoom(2, -1, fit)).toBe(1)
    expect(stepZoom(Number.NaN, 1, fit)).toBe(fit)
  })
})

describe('fit to view', () => {
  it('takes the largest zoom that fits with the padding', () => {
    // 320 x 240 art px: zoom 3 needs 960 x 720 + 48 = 1008 x 768, which fits 1200 x 800.
    expect(fitZoom(extent, view, 24, 1)).toBe(3)
    expect(fitZoom(extent, { width: 1400, height: 1100 }, 24, 1)).toBe(4)
    expect(fitZoom(extent, { width: 700, height: 800 }, 24, 1)).toBe(2)
  })

  it('uses a fraction only when not even zoom 1 fits, and then the largest that does', () => {
    // A phone: 352 x 193 art px (the WGU sample city) in a 375 x 640 view with 24 px of padding.
    const city: Extent = { left: -176, top: -29, right: 176, bottom: 164 }
    const phone = { width: 375, height: 640 }
    const zoom = fitZoom(city, phone, 24, 1)
    expect(zoom).toBeLessThan(1)
    expect(zoom).toBeGreaterThan(0.9)
    // It fits, and a hair more would not.
    expect(352 * scaleOf(zoom, 1) + 48).toBeLessThanOrEqual(375)
    expect(352 * scaleOf(zoom + 0.002, 1) + 48).toBeGreaterThan(375)
    // The same city in a tablet-wide view takes a whole zoom: nothing fractional when an integer fits.
    expect(fitZoom(city, { width: 768, height: 900 }, 24, 1)).toBe(2)
  })

  it('takes the binding side: a view that is wide but short shrinks the zoom too', () => {
    const tall: Extent = { left: 0, top: 0, right: 100, bottom: 600 }
    const zoom = fitZoom(tall, { width: 1200, height: 400 }, 20, 1)
    expect(zoom).toBeLessThan(1)
    expect(600 * zoom + 40).toBeLessThanOrEqual(400)
  })

  it('counts device pixels for the fraction too', () => {
    // 2 device px per art px at zoom 1 needs 704 + 96 here; the view has 750, so zoom 1 does not fit.
    const city: Extent = { left: -176, top: -29, right: 176, bottom: 164 }
    const zoom = fitZoom(city, { width: 750, height: 1400 }, 48, 2)
    expect(zoom).toBeLessThan(1)
    expect(352 * scaleOf(zoom, 2) + 96).toBeLessThanOrEqual(750)
    expect(352 * scaleOf(zoom + 0.002, 2) + 96).toBeGreaterThan(750)
  })

  it('stops shrinking at MIN_FIT_SCALE: a city that big is panned, not turned into dots', () => {
    const huge: Extent = { left: -5000, top: -5000, right: 5000, bottom: 5000 }
    expect(fitZoom(huge, view, 24, 1)).toBe(MIN_FIT_SCALE)
    const vast: Extent = { left: -50_000, top: -50_000, right: 50_000, bottom: 50_000 }
    // The floor is in screen pixels per art pixel, so at 2 device pixels per unit it is half a zoom.
    expect(fitZoom(vast, { width: 2400, height: 1600 }, 48, 2)).toBe(MIN_FIT_SCALE / 2)
    // And a city that does fit above the floor gets its exact fit, here with a sliver of room to spare.
    const fitted = fitZoom(huge, { width: 2400, height: 1600 }, 48, 2)
    expect(fitted).toBeGreaterThan(MIN_FIT_SCALE / 2)
    expect(10_000 * scaleOf(fitted, 2)).toBeLessThanOrEqual(1600 - 96)
    // A view with no room at all (the first layout pass) is still a sane number.
    expect(fitZoom(extent, { width: 10, height: 10 }, 24, 1)).toBe(MIN_FIT_SCALE)
  })

  it('knows the lowest zoom the view can reach', () => {
    expect(zoomFloor(extent, view, 24, 1)).toBe(1)
    expect(zoomFloor(extent, { width: 300, height: 800 }, 24, 1)).toBeLessThan(1)
    // Whole zooms above 1 are not a floor.
    expect(fitZoom(extent, view, 24, 1)).toBe(3)
    expect(zoomFloor(extent, view, 24, 1)).toBe(1)
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

  it('steps down to a fractional floor about the point under the pointer', () => {
    const cam = { cx: 30, cy: 50, zoom: 1 }
    const anchor = { x: 900, y: 300 }
    const before = screenToArt(cam, view, 1, anchor)
    const next = zoomAbout(cam, 0.5, anchor, view, 1, 0.93)
    expect(next.zoom).toBe(0.93)
    const after = screenToArt(next, view, 1, anchor)
    // The screen origin is rounded to a whole pixel, so the point is held to within a pixel of art.
    expect(Math.abs(after.x - before.x)).toBeLessThan(1)
    expect(Math.abs(after.y - before.y)).toBeLessThan(1)
    // Without a fractional floor the same request stays at 1.
    expect(zoomAbout(cam, 0.5, anchor, view, 1)).toBe(cam)
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
