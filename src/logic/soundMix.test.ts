import { describe, expect, it } from 'vitest'
import type { Mix, Settings } from '@/db/types'
import { cleanMixer, describeLayers, effectiveMixer, isSilent } from './soundMix'

type Sound = Settings['sound']
const base: Sound = { enabled: true, volume: 0.5, chime: true, ambient: 'none', ambientVolume: 0.5 }

describe('effectiveMixer', () => {
  it('derives from the old ambient fields', () => {
    const m = effectiveMixer({ ...base, ambient: 'rain', ambientVolume: 0.3 })
    expect(m.layers).toEqual({ rain: 0.3 })
    expect(m.music).toEqual({ style: 'off', volume: 0.6 })
    expect(m.withFocus).toBe(true)
    expect(m.master).toBe(1)
    expect(m.presets).toEqual([])
    const b = effectiveMixer({ ...base, ambient: 'brown', ambientVolume: 0.4 })
    expect(b.layers).toEqual({ noise: 0.4 })
    expect(b.noiseColor).toBe('brown')
    expect(effectiveMixer({ ...base, ambient: 'cafe', ambientVolume: 0.2 }).layers).toEqual({
      cafe: 0.2,
    })
    expect(effectiveMixer(base).layers).toEqual({})
  })
  it('returns a present mixer cleaned', () => {
    const mixer = {
      music: { style: 'piano', volume: 2 },
      layers: { wind: 0.5 },
      noiseColor: 'pink',
      master: 0.5,
      withFocus: false,
      presets: [],
    }
    const m = effectiveMixer({ ...base, mixer: mixer as never })
    expect(m.music).toEqual({ style: 'piano', volume: 1 })
    expect(m.withFocus).toBe(false)
    expect(m.noiseColor).toBe('pink')
  })
})

describe('cleanMixer', () => {
  it('clamps, drops unknowns and caps presets', () => {
    const preset = (i: number) => ({
      id: `p${i}`,
      name: 'x'.repeat(50),
      mix: { music: { style: 'off', volume: 0 }, layers: {}, noiseColor: 'brown', master: 1 },
    })
    const m = cleanMixer({
      music: { style: 'polka', volume: 3 },
      layers: { rain: -1, lava: 0.5 },
      presets: Array.from({ length: 13 }, (_, i) => preset(i)),
    })
    expect(m.music).toEqual({ style: 'off', volume: 1 })
    expect(m.layers).toEqual({})
    expect(m.presets).toHaveLength(12)
    expect(m.presets[0]?.name).toHaveLength(40)
  })
  it('survives garbage', () => {
    expect(cleanMixer(null).layers).toEqual({})
  })
})

describe('describeLayers / isSilent', () => {
  const mix = (layers: Mix['layers'], style: Mix['music']['style'] = 'off'): Mix => ({
    music: { style, volume: 0.6 },
    layers,
    noiseColor: 'brown',
    master: 1,
  })
  it('lists in layer order', () => {
    expect(describeLayers(mix({ campfire: 0.25, rain: 0.4 }))).toBe('Rain 40% · Campfire 25%')
    expect(describeLayers(mix({}))).toBe('Off')
  })
  it('isSilent', () => {
    expect(isSilent(mix({}))).toBe(true)
    expect(isSilent(mix({}, 'piano'))).toBe(false)
    expect(isSilent(mix({ rain: 0.4 }))).toBe(false)
  })
})
