import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mix, NoiseLayer } from '@/db/types'
import { FakeAudioContext, type FakeNode } from '@/test/fakeAudio'

const h = vi.hoisted(() => ({
  ctx: null as unknown,
  master: [] as number[],
  built: [] as string[],
  music: [] as { style: string; stop: ReturnType<typeof vi.fn> }[],
}))
vi.mock('./music/player', () => ({
  startMusic: (_c: unknown, _o: unknown, style: string) => {
    const handle = { style, stop: vi.fn() }
    h.music.push(handle)
    return handle
  },
}))

vi.mock('./engine', () => ({
  getContext: () => h.ctx,
  masterOutput: () => ({ kind: 'master' }),
  setBusVolume: (v: number) => h.master.push(v),
  resumeContext: () => Promise.resolve(true),
  emitAudioChange: () => {},
}))
const stops: Record<string, ReturnType<typeof vi.fn>> = {}
vi.mock('./noises', () => {
  const make = (id: string) => (c: FakeAudioContext) => {
    if (id === 'wind' && h.built.includes('boom')) throw new Error('boom')
    h.built.push(id)
    stops[id] = vi.fn()
    return { output: c.createGain(), stop: stops[id] }
  }
  return {
    NOISE_BUILDERS: Object.fromEntries(
      ['rain', 'storm', 'wind', 'campfire', 'cafe', 'waves', 'birds', 'creek', 'noise'].map(
        (id) => [id, make(id)],
      ),
    ),
  }
})

import { applyMix, isMixPlaying, playingLayers, stopMix } from './mixer'

const mix = (
  layers: Partial<Record<NoiseLayer, number>>,
  master = 1,
  style: Mix['music']['style'] = 'off',
): Mix => ({
  music: { style, volume: 0.5 },
  layers,
  noiseColor: 'brown',
  master,
})

let ctx: FakeAudioContext
beforeEach(() => {
  vi.useFakeTimers()
  ctx = new FakeAudioContext()
  h.ctx = ctx
  h.master.length = 0
  h.built.length = 0
  h.music.length = 0
})
afterEach(async () => {
  const p = stopMix(0)
  vi.advanceTimersByTime(1000)
  await p
  vi.useRealTimers()
})

describe('mixer', () => {
  it('diffs against what plays', async () => {
    await applyMix(mix({ rain: 0.4 }))
    expect(h.built).toEqual(['rain'])
    await applyMix(mix({ rain: 0.4 }))
    expect(h.built).toEqual(['rain'])
    await applyMix(mix({ rain: 0.4, wind: 0.2 }))
    expect(h.built).toEqual(['rain', 'wind'])
    expect(playingLayers().sort()).toEqual(['rain', 'wind'])
  })

  it('fades a removed layer, stops it after the fade, ramps the rest', async () => {
    await applyMix(mix({ rain: 0.4, wind: 0.2 }))
    const rainNode = ctx.nodes.filter((n) => n.kind === 'gain')[1] as FakeNode & {
      gain: { calls: { fn: string; args: number[] }[] }
    }
    await applyMix(mix({ wind: 0.5 }))
    expect(stops.rain).not.toHaveBeenCalled()
    const last = rainNode.gain.calls.at(-1)
    expect([last?.fn, last?.args[0]]).toEqual(['setTargetAtTime', 0])
    ctx.advance(2, vi)
    expect(stops.rain).toHaveBeenCalledTimes(1)
    expect(stops.wind).not.toHaveBeenCalled()
    expect(playingLayers()).toEqual(['wind'])
  })

  it('sets master and stopMix stops everything', async () => {
    await applyMix(mix({ rain: 0.4 }, 0))
    expect(h.master.at(-1)).toBe(0)
    const p = stopMix(100)
    ctx.advance(1, vi)
    await p
    expect(stops.rain).toHaveBeenCalled()
    expect(isMixPlaying()).toBe(false)
  })

  it('skips a throwing builder, reports it once', async () => {
    h.built.push('boom')
    const onLayerError = vi.fn()
    await applyMix(mix({ rain: 0.4, wind: 0.2 }), { onLayerError })
    await applyMix(mix({ rain: 0.4, wind: 0.2 }), { onLayerError })
    expect(playingLayers()).toEqual(['rain'])
    expect(onLayerError).toHaveBeenCalledTimes(1)
    expect(onLayerError.mock.calls[0]?.[0]).toBe('wind')
  })

  it('crossfades a style change over 2 s and stops only music on off', async () => {
    await applyMix(mix({ rain: 0.4 }, 1, 'classic'))
    await applyMix(mix({ rain: 0.4 }, 1, 'tokyo'))
    const [a, b] = h.music
    expect(h.music.map((m) => m.style)).toEqual(['classic', 'tokyo'])
    expect(a?.stop).toHaveBeenCalledWith(2000)
    expect(b?.stop).not.toHaveBeenCalled()
    await applyMix(mix({ rain: 0.4 }, 1, 'tokyo'))
    expect(h.music).toHaveLength(2)
    await applyMix(mix({ rain: 0.4 }))
    expect(b?.stop).toHaveBeenCalled()
    expect(stops.rain).not.toHaveBeenCalled()
    expect(playingLayers()).toEqual(['rain'])
  })
})
