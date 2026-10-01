import { describe, expect, it } from 'vitest'
import { HUES, isHex, mixHex, paletteFor, shade, withAlpha } from './palette'

describe('shade', () => {
  it('always returns lower-case #rrggbb', () => {
    for (const hex of ['#E9E8E5', '#64615c', '#be8226', '#000000', '#ffffff']) {
      for (const pct of [-40, -12, 0, 8, 40]) expect(shade(hex, pct)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('round-trips at zero', () => {
    for (const hue of HUES) {
      for (const theme of ['light', 'dark'] as const) {
        const { bg, text } = paletteFor(theme).hues[hue]
        expect(shade(bg, 0)).toBe(bg)
        expect(shade(text, 0)).toBe(text)
      }
    }
  })

  it('lightens and darkens', () => {
    const base = '#7a5a49'
    const lum = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
    expect(lum(shade(base, 10))).toBeGreaterThan(lum(base))
    expect(lum(shade(base, -10))).toBeLessThan(lum(base))
  })

  it('clamps at black and white', () => {
    expect(shade('#101010', -50)).toBe('#000000')
    expect(shade('#f0f0f0', 50)).toBe('#ffffff')
    expect(shade('#808080', 200)).toBe('#ffffff')
    expect(shade('#808080', -200)).toBe('#000000')
  })

  it('keeps the hue', () => {
    const [r, g, b] = [shade('#396d46', 10)].map((h) => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ])[0] ?? [0, 0, 0]
    expect(g).toBeGreaterThan(r ?? 0)
    expect(g).toBeGreaterThan(b ?? 0)
  })

  it('rejects anything that is not #rrggbb', () => {
    expect(() => shade('red', 5)).toThrow()
    expect(isHex('#abc')).toBe(false)
    expect(isHex('#abcdef')).toBe(true)
  })
})

describe('palettes', () => {
  it('has the nine hues in both themes, all #rrggbb', () => {
    for (const theme of ['light', 'dark'] as const) {
      const p = paletteFor(theme)
      expect(Object.keys(p.hues)).toHaveLength(9)
      for (const c of Object.values(p.hues)) {
        expect(isHex(c.bg)).toBe(true)
        expect(isHex(c.text)).toBe(true)
      }
      for (const key of ['grassA', 'grassB', 'soil', 'road', 'roadDash', 'gold', 'windowLit'] as const) {
        expect(isHex(p[key])).toBe(true)
      }
    }
  })

  it('uses the specified colours', () => {
    expect(paletteFor('light').hues.brown).toEqual({ bg: '#f5e4db', text: '#7a5a49' })
    expect(paletteFor('dark').hues.blue).toEqual({ bg: '#233846', text: '#84b1cf' })
    expect(paletteFor('light').grassA).toBe('#cfe3c4')
    expect(paletteFor('dark').road).toBe('#3a3936')
    expect(paletteFor('light').gold).toBe('#be8226')
    expect(paletteFor('dark').windowLit).toBe('#f2c66d')
  })
})

describe('mixHex and withAlpha', () => {
  it('mixes linearly', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#000000', '#ffffff', 2)).toBe('#ffffff')
  })

  it('writes rgba', () => {
    expect(withAlpha('#f2c66d', 0.35)).toBe('rgba(242, 198, 109, 0.35)')
  })
})
