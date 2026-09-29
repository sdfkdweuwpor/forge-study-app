import { describe, expect, it } from 'vitest'
import { computePosition, type Box, type Size } from './position'

const viewport: Size = { width: 1000, height: 800 }
const floating: Size = { width: 200, height: 120 }
/** A 80×32 trigger somewhere in the middle of the viewport. */
const middle: Box = { x: 400, y: 300, width: 80, height: 32 }

describe('computePosition: side and alignment', () => {
  it('opens below and start-aligned by default, with a 6px gap', () => {
    const p = computePosition({ anchor: middle, floating, viewport })
    expect(p).toMatchObject({ x: 400, y: 338, side: 'bottom', flipped: false })
  })

  it('aligns to the end and centre of the anchor', () => {
    expect(computePosition({ anchor: middle, floating, viewport, align: 'end' }).x).toBe(280)
    expect(computePosition({ anchor: middle, floating, viewport, align: 'center' }).x).toBe(340)
  })

  it('places above, left and right of the anchor', () => {
    expect(computePosition({ anchor: middle, floating, viewport, side: 'top' })).toMatchObject({
      x: 400,
      y: 174,
      side: 'top',
    })
    expect(computePosition({ anchor: middle, floating, viewport, side: 'right' })).toMatchObject({
      x: 486,
      y: 300,
      side: 'right',
    })
    expect(computePosition({ anchor: middle, floating, viewport, side: 'left' })).toMatchObject({
      x: 194,
      y: 300,
      side: 'left',
    })
  })

  it('centres on the anchor when the side is left or right', () => {
    const p = computePosition({
      anchor: middle,
      floating,
      viewport,
      side: 'right',
      align: 'center',
    })
    expect(p.y).toBe(300 + 16 - 60)
  })

  it('honours a custom offset', () => {
    expect(computePosition({ anchor: middle, floating, viewport, offset: 12 }).y).toBe(344)
  })
})

describe('computePosition: flip', () => {
  const nearBottom: Box = { x: 400, y: 740, width: 80, height: 32 }

  it('flips to the top when the bottom overflows and the top fits', () => {
    const p = computePosition({ anchor: nearBottom, floating, viewport })
    expect(p).toMatchObject({ side: 'top', flipped: true, y: 740 - 6 - 120 })
  })

  it('flips to the bottom when a top popover would leave the viewport', () => {
    const nearTop: Box = { x: 400, y: 20, width: 80, height: 32 }
    const p = computePosition({ anchor: nearTop, floating, viewport, side: 'top' })
    expect(p).toMatchObject({ side: 'bottom', flipped: true, y: 58 })
  })

  it('flips a right-side popover to the left near the right edge', () => {
    const nearRight: Box = { x: 900, y: 300, width: 80, height: 32 }
    const p = computePosition({ anchor: nearRight, floating, viewport, side: 'right' })
    expect(p).toMatchObject({ side: 'left', flipped: true, x: 900 - 6 - 200 })
  })

  it('does not flip when flip is disabled, and shifts instead', () => {
    const p = computePosition({ anchor: nearBottom, floating, viewport, flip: false })
    expect(p.side).toBe('bottom')
    expect(p.y).toBe(viewport.height - floating.height - 8)
  })

  it('keeps the preferred side when it fits', () => {
    const p = computePosition({ anchor: middle, floating, viewport, side: 'top' })
    expect(p.flipped).toBe(false)
  })
})

describe('computePosition: shift', () => {
  it('shifts left when the box would overflow the right edge', () => {
    const anchor: Box = { x: 940, y: 300, width: 40, height: 32 }
    const p = computePosition({ anchor, floating, viewport })
    expect(p.x).toBe(1000 - 200 - 8)
    expect(p.side).toBe('bottom')
  })

  it('shifts right when the box would overflow the left edge (end aligned)', () => {
    const anchor: Box = { x: 10, y: 300, width: 40, height: 32 }
    const p = computePosition({ anchor, floating, viewport, align: 'end' })
    expect(p.x).toBe(8)
  })

  it('respects a custom viewport padding', () => {
    const anchor: Box = { x: 990, y: 300, width: 8, height: 32 }
    expect(computePosition({ anchor, floating, viewport, padding: 16 }).x).toBe(1000 - 200 - 16)
  })

  it('keeps left/right boxes inside the viewport vertically', () => {
    const anchor: Box = { x: 400, y: 780, width: 80, height: 32 }
    const p = computePosition({ anchor, floating, viewport, side: 'right' })
    expect(p.y).toBe(viewport.height - floating.height - 8)
  })

  it('pins to the padding when the box is wider than the viewport', () => {
    const wide: Size = { width: 400, height: 100 }
    const p = computePosition({
      anchor: { x: 20, y: 20, width: 40, height: 20 },
      floating: wide,
      viewport: { width: 300, height: 600 },
    })
    expect(p.x).toBe(8)
  })
})

describe('computePosition: not enough room on either side', () => {
  const tall: Size = { width: 200, height: 500 }
  const short: Size = { width: 1000, height: 300 }

  it('picks the roomier side and reports the available height', () => {
    // 300px viewport: anchor near the top, so the bottom has more room.
    const p = computePosition({
      anchor: { x: 20, y: 40, width: 80, height: 32 },
      floating: tall,
      viewport: short,
    })
    expect(p.side).toBe('bottom')
    expect(p.maxHeight).toBe(300 - 72 - 6 - 8)
    expect(p.y).toBe(78)
  })

  it('places a capped top box flush against the anchor', () => {
    const p = computePosition({
      anchor: { x: 20, y: 240, width: 80, height: 32 },
      floating: tall,
      viewport: short,
      side: 'top',
    })
    expect(p.side).toBe('top')
    expect(p.maxHeight).toBe(240 - 6 - 8)
    expect(p.y).toBe(8)
  })

  it('reports the viewport height as the cap for left/right boxes', () => {
    const p = computePosition({ anchor: middle, floating, viewport, side: 'right' })
    expect(p.maxHeight).toBe(800 - 16)
  })

  it('never returns a negative maxHeight', () => {
    const p = computePosition({
      anchor: { x: 0, y: 0, width: 10, height: 10 },
      floating: tall,
      viewport: { width: 400, height: 20 },
    })
    expect(p.maxHeight).toBeGreaterThanOrEqual(0)
  })
})

describe('computePosition: transform origin', () => {
  it('points the origin at the anchor centre for a bottom popover', () => {
    const p = computePosition({ anchor: middle, floating, viewport, align: 'center' })
    expect(p.origin).toEqual({ x: 100, y: 0 })
  })

  it('anchors the origin at the bottom edge for a top popover', () => {
    const p = computePosition({ anchor: middle, floating, viewport, side: 'top', align: 'start' })
    expect(p.origin).toEqual({ x: 40, y: 120 })
  })

  it('anchors the origin on the near edge for left and right popovers', () => {
    expect(computePosition({ anchor: middle, floating, viewport, side: 'right' }).origin.x).toBe(0)
    expect(computePosition({ anchor: middle, floating, viewport, side: 'left' }).origin.x).toBe(200)
  })

  it('keeps the origin inside the box after a shift', () => {
    const anchor: Box = { x: 990, y: 300, width: 8, height: 32 }
    const p = computePosition({ anchor, floating, viewport })
    expect(p.origin.x).toBeLessThanOrEqual(floating.width)
    expect(p.origin.x).toBeGreaterThanOrEqual(0)
  })
})
