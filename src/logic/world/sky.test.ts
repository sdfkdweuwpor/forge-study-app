import { describe, expect, it } from 'vitest'
import { DAWN_START, DUSK_START, NIGHT_START, skyAt } from './sky'

const at = (h: number, m = 0) => h * 60 + m

describe('skyAt', () => {
  it('is full day at noon', () => {
    const s = skyAt(at(12), 'light')
    expect(s.phase).toBe('day')
    expect(s.ambient).toBe(0)
    expect(s.windowsLit).toBe(false)
    expect(s.top).toBe('#dcebf5')
    expect(s.bottom).toBe('#f4f1ea')
  })

  it('is full night at 23:00 with windows lit', () => {
    const s = skyAt(at(23), 'light')
    expect(s.phase).toBe('night')
    expect(s.ambient).toBe(1)
    expect(s.windowsLit).toBe(true)
    expect(s.top).toBe('#141a26')
    expect(s.bottom).toBe('#2a2f3a')
  })

  it('is dusk at 19:15, between day and night', () => {
    const s = skyAt(at(19, 15), 'light')
    expect(s.phase).toBe('dusk')
    expect(s.ambient).toBeGreaterThan(0)
    expect(s.ambient).toBeLessThan(1)
  })

  it('has the specified dusk colours at the middle of dusk', () => {
    const mid = (DUSK_START + NIGHT_START) / 2
    const s = skyAt(mid, 'light')
    expect(s.ambient).toBeCloseTo(0.5, 6)
    expect(s.top).toBe('#e8c9a8')
    expect(s.bottom).toBe('#f2e3d0')
  })

  it('draws the phase boundaries at 05:00, 07:30, 18:00 and 20:30', () => {
    expect(skyAt(DAWN_START - 1, 'light').phase).toBe('night')
    expect(skyAt(DAWN_START, 'light').phase).toBe('dawn')
    expect(skyAt(at(7, 29), 'light').phase).toBe('dawn')
    expect(skyAt(at(7, 30), 'light').phase).toBe('day')
    expect(skyAt(at(17, 59), 'light').phase).toBe('day')
    expect(skyAt(at(18), 'light').phase).toBe('dusk')
    expect(skyAt(at(20, 29), 'light').phase).toBe('dusk')
    expect(skyAt(at(20, 30), 'light').phase).toBe('night')
    expect(skyAt(0, 'light').phase).toBe('night')
  })

  it('never lets the ambient level go backwards from 18:00 to 20:30', () => {
    let last = -1
    for (let m = at(18); m <= at(20, 30); m += 5) {
      const { ambient } = skyAt(m, 'light')
      expect(ambient).toBeGreaterThanOrEqual(last)
      last = ambient
    }
    expect(last).toBe(1)
  })

  it('mirrors that from 05:00 to 07:30 (dawn gets brighter)', () => {
    let last = 2
    for (let m = at(5); m <= at(7, 30); m += 5) {
      const { ambient } = skyAt(m, 'dark')
      expect(ambient).toBeLessThanOrEqual(last)
      last = ambient
    }
    expect(last).toBe(0)
  })

  it('lights the windows only when it is more night than day', () => {
    expect(skyAt(at(19), 'light').windowsLit).toBe(false)
    expect(skyAt(at(20), 'light').windowsLit).toBe(true)
    expect(skyAt(at(6), 'light').windowsLit).toBe(true)
    expect(skyAt(at(7), 'light').windowsLit).toBe(false)
  })

  it('has deeper colours in the dark theme and wraps the minutes', () => {
    const light = skyAt(at(12), 'light')
    const dark = skyAt(at(12), 'dark')
    expect(dark.top).not.toBe(light.top)
    expect(skyAt(at(12) + 1440, 'dark')).toEqual(dark)
    expect(skyAt(-60, 'dark')).toEqual(skyAt(at(23), 'dark'))
  })

  it('only produces #rrggbb colours', () => {
    for (let m = 0; m < 1440; m += 17) {
      const s = skyAt(m, m % 2 === 0 ? 'light' : 'dark')
      expect(s.top).toMatch(/^#[0-9a-f]{6}$/)
      expect(s.bottom).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
