import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COVER_PRESETS, COVER_PRESET_LABELS, isCoverPresetId } from './presets'

const css = readFileSync(new URL('./PageHeader.module.css', import.meta.url), 'utf8')
const block = css.slice(css.indexOf('/* presets:start */'), css.indexOf('/* presets:end */'))

function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

describe('cover presets', () => {
  it('lists the eight calm presets with labels', () => {
    expect(COVER_PRESETS).toEqual([
      'warm-paper',
      'sage',
      'sand',
      'slate',
      'dusk-orange',
      'sea-glass',
      'stone',
      'ink',
    ])
    for (const id of COVER_PRESETS) expect(COVER_PRESET_LABELS[id]).toBeTruthy()
  })

  it('recognises preset ids', () => {
    expect(isCoverPresetId('sage')).toBe(true)
    expect(isCoverPresetId('neon-purple')).toBe(false)
  })

  it('defines all three colours for every preset in the stylesheet', () => {
    expect(block.length).toBeGreaterThan(0)
    for (const id of COVER_PRESETS) {
      const rule = new RegExp(`\\[data-preset='${id}'\\]\\s*\\{([^}]*)\\}`).exec(block)
      expect(rule, `rule for ${id}`).not.toBeNull()
      for (const name of ['--cover-a', '--cover-b', '--cover-glow']) {
        expect(rule?.[1]).toContain(`${name}: light-dark(#`)
      }
    }
  })

  it('has no colour in the blue to violet range (BRIEF §9), in either theme', () => {
    const colours = block.match(/#[0-9a-f]{6}/gi) ?? []
    expect(colours.length).toBe(COVER_PRESETS.length * 6)
    for (const hex of colours) {
      const { h, s } = hsl(hex)
      const bluish = h >= 225 && h <= 330
      expect(bluish && s > 0.15, `${hex} (h ${Math.round(h)}, s ${s.toFixed(2)})`).toBe(false)
    }
  })

  it('keeps every colour soft: no neon saturation', () => {
    for (const hex of block.match(/#[0-9a-f]{6}/gi) ?? []) {
      const { s, l } = hsl(hex)
      // Muted tones only; saturated shades must be light or dark enough to read as tints.
      expect(s <= 0.8 && (s < 0.5 || l > 0.6 || l < 0.35), hex).toBe(true)
    }
  })
})
