import { describe, expect, it } from 'vitest'
import { place, type PlaceOptions } from './position'

const viewport = { width: 1000, height: 800 }
const opts = (side: PlaceOptions['side']): PlaceOptions => ({ side, gap: 6, margin: 8, viewport })
const tip = { width: 100, height: 28 }

describe('place', () => {
  it('centres above the anchor by default', () => {
    const anchor = { top: 400, left: 450, width: 100, height: 32 }
    expect(place(anchor, tip, opts('top'))).toEqual({ top: 366, left: 450, side: 'top' })
  })

  it('flips to the bottom when there is no room above', () => {
    const anchor = { top: 10, left: 450, width: 100, height: 32 }
    expect(place(anchor, tip, opts('top'))).toEqual({ top: 48, left: 450, side: 'bottom' })
  })

  it('clamps horizontally inside the viewport margin', () => {
    const nearLeft = { top: 400, left: 0, width: 24, height: 24 }
    expect(place(nearLeft, tip, opts('top')).left).toBe(8)
    const nearRight = { top: 400, left: 990, width: 10, height: 24 }
    expect(place(nearRight, tip, opts('bottom')).left).toBe(1000 - 8 - 100)
  })

  it('places on the sides and flips left ↔ right', () => {
    const anchor = { top: 400, left: 40, width: 24, height: 24 }
    expect(place(anchor, tip, opts('right'))).toEqual({ top: 398, left: 70, side: 'right' })
    expect(place(anchor, tip, opts('left')).side).toBe('right')
  })

  it('keeps the preferred side when neither side fits but it has more room', () => {
    const anchor = { top: 20, left: 450, width: 100, height: 760 }
    expect(place(anchor, tip, opts('top')).side).toBe('top')
  })
})
