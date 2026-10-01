import { describe, expect, it } from 'vitest'
import {
  areaPath,
  bandLayout,
  barPath,
  clamp,
  estimateTextWidth,
  formatHourLabel,
  hourRangeLabel,
  linePath,
  linearScale,
  nearestPoint,
  niceTicks,
  niceTimeTicks,
  showsTick,
  tickStep,
  visibleTicks,
  truncateLabel,
} from './scale'

describe('linearScale', () => {
  it('maps the domain onto the range, including an inverted range (SVG y grows down)', () => {
    const y = linearScale([0, 60], [100, 0])
    expect(y(0)).toBe(100)
    expect(y(60)).toBe(0)
    expect(y(30)).toBe(50)
  })

  it('extrapolates, and maps a zero-width domain to the start', () => {
    expect(linearScale([0, 10], [0, 100])(20)).toBe(200)
    expect(linearScale([5, 5], [10, 90])(5)).toBe(10)
  })
})

describe('clamp', () => {
  it('keeps a value in range', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })
})

describe('niceTicks', () => {
  it('gives 0, 20, 40, 60 for a max of 47 with three intervals', () => {
    expect(niceTicks(47, 3)).toEqual([0, 20, 40, 60])
  })

  it('always starts at 0 and reaches at least the max', () => {
    for (const max of [1, 3, 7, 12, 47, 99, 100, 101, 250, 1234, 0.4]) {
      for (const count of [2, 3, 4, 5]) {
        const ticks = niceTicks(max, count)
        expect(ticks[0]).toBe(0)
        expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max - 1e-9)
      }
    }
  })

  it('uses 1-2-5 steps', () => {
    expect(niceTicks(100, 4)).toEqual([0, 50, 100])
    expect(niceTicks(60, 3)).toEqual([0, 20, 40, 60])
    expect(niceTicks(90, 3)).toEqual([0, 50, 100])
    expect(niceTicks(1200, 4)).toEqual([0, 500, 1000, 1500])
    expect(niceTicks(9, 3)).toEqual([0, 5, 10])
    expect(niceTicks(5, 5)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('does not make a step for a max that already sits on a tick', () => {
    expect(niceTicks(40, 2)).toEqual([0, 20, 40])
    expect(niceTicks(200, 4)).toEqual([0, 50, 100, 150, 200])
  })

  it('keeps steps whole for counts', () => {
    expect(niceTicks(1, 3, { integer: true })).toEqual([0, 1])
    expect(niceTicks(2, 3, { integer: true })).toEqual([0, 1, 2])
    expect(niceTicks(7, 3, { integer: true })).toEqual([0, 5, 10])
  })

  it('has no float noise', () => {
    expect(niceTicks(0.9, 3)).toEqual([0, 0.5, 1])
    expect(niceTicks(0.3, 3)).toEqual([0, 0.1, 0.2, 0.3])
  })

  it('is [0] with nothing to plot', () => {
    expect(niceTicks(0, 3)).toEqual([0])
    expect(niceTicks(-5, 3)).toEqual([0])
    expect(niceTicks(Number.NaN, 3)).toEqual([0])
    expect(niceTicks(Infinity, 3)).toEqual([0])
  })
})

describe('niceTimeTicks', () => {
  it('uses the 1-2-5 minutes up to an hour', () => {
    expect(niceTimeTicks(47, 3)).toEqual([0, 20, 40, 60])
    expect(niceTimeTicks(60, 3)).toEqual([0, 20, 40, 60])
  })

  it('uses whole hours beyond it, the smallest step that fits the interval count', () => {
    expect(niceTimeTicks(150, 3)).toEqual([0, 60, 120, 180])
    expect(niceTimeTicks(61, 3)).toEqual([0, 60, 120])
    expect(niceTimeTicks(200, 3)).toEqual([0, 120, 240])
    expect(niceTimeTicks(600, 3)).toEqual([0, 240, 480, 720])
  })

  it('never stops short of the max', () => {
    for (const max of [1, 30, 59, 61, 95, 180, 181, 500, 1000, 5000]) {
      const ticks = niceTimeTicks(max, 3)
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max)
    }
  })

  it('is [0] with nothing to plot', () => {
    expect(niceTimeTicks(0, 3)).toEqual([0])
  })
})

describe('barPath', () => {
  it('rounds the top corners and squares the base', () => {
    expect(barPath(10, 20, 8, 30, 3)).toBe('M10,50V23A3,3 0 0 1 13,20H15A3,3 0 0 1 18,23V50Z')
  })

  it('never lets the radius exceed half the width or the height', () => {
    // Half of a 4px-wide bar is 2; a 1px-tall bar allows a radius of 1.
    expect(barPath(0, 0, 4, 30, 10)).toBe('M0,30V2A2,2 0 0 1 2,0H2A2,2 0 0 1 4,2V30Z')
    expect(barPath(0, 9, 10, 1, 4)).toBe('M0,10V10A1,1 0 0 1 1,9H9A1,1 0 0 1 10,10V10Z')
  })

  it('is a plain rectangle with no radius', () => {
    expect(barPath(0, 0, 10, 10, 0)).toBe('M0,10V0H10V10Z')
  })

  it('is empty for a bar with no size', () => {
    expect(barPath(0, 0, 10, 0, 3)).toBe('')
    expect(barPath(0, 0, 0, 10, 3)).toBe('')
    expect(barPath(0, 0, -5, 10, 3)).toBe('')
  })

  it('rounds coordinates to two decimals', () => {
    expect(barPath(0.123456, 0, 10, 10, 0)).toContain('M0.12,')
  })
})

describe('hour labels', () => {
  it('formats axis labels', () => {
    expect([0, 1, 6, 11, 12, 13, 18, 23, 24].map(formatHourLabel)).toEqual([
      '12a',
      '1a',
      '6a',
      '11a',
      '12p',
      '1p',
      '6p',
      '11p',
      '12a',
    ])
  })

  it('formats the hour that starts at h', () => {
    expect(hourRangeLabel(9)).toBe('9–10 AM')
    expect(hourRangeLabel(0)).toBe('12–1 AM')
    expect(hourRangeLabel(11)).toBe('11 AM–12 PM')
    expect(hourRangeLabel(12)).toBe('12–1 PM')
    expect(hourRangeLabel(15)).toBe('3–4 PM')
    expect(hourRangeLabel(23)).toBe('11 PM–12 AM')
  })
})

describe('text fitting', () => {
  it('leaves short text alone and cuts long text with an ellipsis', () => {
    expect(truncateLabel('C182', 200, 13)).toBe('C182')
    const cut = truncateLabel('C779 Web Development Foundations', 100, 13)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThan('C779 Web Development Foundations'.length)
    expect(estimateTextWidth(cut, 13)).toBeLessThanOrEqual(100)
  })

  it('keeps at least one character', () => {
    expect(truncateLabel('Introduction', 1, 13)).toBe('I…')
  })
})

describe('axis label thinning', () => {
  it('labels every bar when they are far apart, and fewer when close', () => {
    expect(tickStep(40, 30)).toBe(1)
    expect(tickStep(10, 30)).toBe(4)
    expect(tickStep(0, 30)).toBe(1)
  })

  it('anchors the labels at the last bar', () => {
    const shown = Array.from({ length: 30 }, (_, i) => i).filter((i) => showsTick(i, 30, 7))
    expect(shown).toEqual([1, 8, 15, 22, 29])
    expect(showsTick(29, 30, 1)).toBe(true)
  })

  it('thins labels on every bar the same way, anchored at the last', () => {
    const all = Array.from({ length: 30 }, (_, i) => i)
    expect([...visibleTicks(all, 10, 60)].sort((a, b) => a - b)).toEqual([1, 8, 15, 22, 29])
  })

  it('spaces sparse labels by the distance between them, so the hour axis keeps 12a, 6a, 12p, 6p', () => {
    // 24 bars about 13px apart (a phone), labelled every sixth: two bars' room would drop them all
    // if the step were counted over every bar and anchored at bar 23.
    const hours = [0, 6, 12, 18]
    expect([...visibleTicks(hours, 13, 22)].sort((a, b) => a - b)).toEqual([0, 6, 12, 18])
    // Squeezed hard, every other one goes, still counted back from the last label.
    expect([...visibleTicks(hours, 4, 22)].sort((a, b) => a - b)).toEqual([6, 18])
    expect([...visibleTicks([5], 4, 22)]).toEqual([5])
    expect(visibleTicks([], 4, 22).size).toBe(0)
  })
})

describe('bandLayout', () => {
  it('centres capped bars in their bands', () => {
    const l = bandLayout(4, 10, 400)
    expect(l.pitch).toBe(100)
    expect(l.barWidth).toBe(24)
    expect(l.bandX(2)).toBe(210)
    expect(l.barX(0)).toBe(10 + (100 - 24) / 2)
  })

  it('leaves a 2px gap when the bands are narrow', () => {
    const l = bandLayout(30, 0, 300)
    expect(l.pitch).toBe(10)
    expect(l.barWidth).toBe(8)
  })

  it('finds the band under the pointer and clamps to the ends', () => {
    const l = bandLayout(4, 10, 400)
    expect(l.indexAt(10)).toBe(0)
    expect(l.indexAt(109)).toBe(0)
    expect(l.indexAt(110)).toBe(1)
    expect(l.indexAt(-50)).toBe(0)
    expect(l.indexAt(9999)).toBe(3)
  })

  it('never has a bar narrower than 1px', () => {
    expect(bandLayout(500, 0, 100).barWidth).toBe(1)
  })
})

describe('paths and points', () => {
  const pts: [number, number][] = [
    [0, 10],
    [5, 4.126],
    [10, 8],
  ]

  it('draws a line', () => {
    expect(linePath(pts)).toBe('M0,10L5,4.13L10,8')
    expect(linePath([])).toBe('')
  })

  it('closes an area down to the baseline', () => {
    expect(areaPath(pts, 12)).toBe('M0,10L5,4.13L10,8L10,12L0,12Z')
    expect(areaPath([], 12)).toBe('')
  })

  it('finds the nearest point', () => {
    expect(nearestPoint(pts, 6, 5)).toBe(1)
    expect(nearestPoint(pts, 100, 100)).toBe(2)
    expect(nearestPoint([], 1, 1)).toBe(-1)
    // A tie goes to the earlier point.
    expect(
      nearestPoint(
        [
          [0, 0],
          [2, 0],
        ],
        1,
        0,
      ),
    ).toBe(0)
  })
})
