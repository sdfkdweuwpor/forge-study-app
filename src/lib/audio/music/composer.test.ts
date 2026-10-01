import { describe, expect, it } from 'vitest'
import { LOFI_STYLES } from '@/logic/soundMix'
import { createComposer, SCALES } from './composer'
import { STYLES } from './styles'

const bars = (style: (typeof LOFI_STYLES)[number], seed: number, n: number) => {
  const c = createComposer(style, seed)
  return { bpm: c.bpm, bars: Array.from({ length: n }, () => c.nextBar()) }
}

describe('composer', () => {
  it('STYLES has exactly LOFI_STYLES', () => {
    expect(Object.keys(STYLES).sort()).toEqual([...LOFI_STYLES].sort())
  })

  for (const style of LOFI_STYLES) {
    describe(style, () => {
      const def = STYLES[style]
      it('bpm in range, notes in scale, events inside the bar', () => {
        for (let seed = 1; seed <= 20; seed++) {
          const { bpm, bars: out } = bars(style, seed, 16)
          expect(bpm).toBeGreaterThanOrEqual(def.bpm[0])
          expect(bpm).toBeLessThanOrEqual(def.bpm[1])
          const scale = SCALES[def.key.scale]
          for (const ev of out.flat()) {
            expect(ev.at).toBeGreaterThanOrEqual(0)
            expect(ev.at).toBeLessThan(4)
            if ('midi' in ev) {
              expect(scale).toContain((((ev.midi - def.key.root) % 12) + 12) % 12)
            } else if (def.drums === 'none') throw new Error('drum in a no-drum style')
          }
        }
      })
      it('same seed identical, different seeds differ', () => {
        expect(bars(style, 3, 64)).toEqual(bars(style, 3, 64))
        expect(bars(style, 3, 64).bars).not.toEqual(bars(style, 4, 64).bars)
      })
      it('bass stays in MIDI 36-52', () => {
        for (let seed = 1; seed <= 20; seed++)
          for (const ev of bars(style, seed, 16).bars.flat())
            if ('inst' in ev && ev.inst === 'bass') {
              expect(ev.midi).toBeGreaterThanOrEqual(36)
              expect(ev.midi).toBeLessThanOrEqual(52)
            }
      })
      it('drum styles produce drums in the first 8 bars', () => {
        const n = bars(style, 1, 8)
          .bars.flat()
          .filter((e) => 'drum' in e).length
        if (def.drums === 'none') expect(n).toBe(0)
        else expect(n).toBeGreaterThan(0)
      })
      it('no 8-bar phrase repeats over 30 minutes', () => {
        const probe = createComposer(style, 7)
        const n = Math.ceil((30 * probe.bpm) / 4) // 30 min of 4-beat bars
        const phrases = new Set<string>()
        const total = Math.floor(n / 8)
        for (let p = 0; p < total; p++) {
          phrases.add(JSON.stringify(Array.from({ length: 8 }, () => probe.nextBar())))
        }
        expect(phrases.size).toBe(total)
      })
    })
  }
})
