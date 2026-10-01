import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOISE_LAYERS } from '@/logic/soundMix'
import { FakeAudioContext, type FakeSource } from '@/test/fakeAudio'
import { createRng } from '../noise'
import { NOISE_BUILDERS } from './index'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const build = (id: (typeof NOISE_LAYERS)[number], color: 'white' | 'pink' | 'brown' = 'brown') => {
  const ctx = new FakeAudioContext()
  const graph = NOISE_BUILDERS[id](ctx.asContext(), createRng(7), { color })
  return { ctx, graph }
}

describe('NOISE_BUILDERS', () => {
  it('has exactly the nine layer ids', () => {
    expect(Object.keys(NOISE_BUILDERS).sort()).toEqual([...NOISE_LAYERS].sort())
  })

  it.each(NOISE_LAYERS)(
    '%s: output is unconnected; stop() stops sources and releases timers',
    (id) => {
      const { ctx, graph } = build(id)
      expect((graph.output as unknown as { connections: unknown[] }).connections).toEqual([])
      for (let i = 0; i < 20; i++) ctx.advance(0.5, vi)
      const looping = ctx.sources.filter(
        (s) => s.starts.length && (s.loop || s.starts[0]?.length === 0),
      )
      const before = new Map(looping.map((s) => [s, s.stops.length]))
      graph.stop()
      // every source still running at stop() time gets stopped again; ended one-shots may not
      const unstopped = looping.filter((s) => {
        const lastStop = s.stops.at(-1)?.[0]
        const pending = lastStop === undefined || lastStop > ctx.currentTime
        return pending && s.stops.length === before.get(s)
      })
      expect(unstopped).toEqual([])
      const nodes = ctx.nodes.length
      ctx.advance(5, vi)
      expect(ctx.nodes.length).toBe(nodes)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('storm does not track ended thunders without bound', () => {
    const { ctx, graph } = build('storm')
    for (let i = 0; i < 3000; i++) ctx.advance(0.7, vi) // ~35 minutes
    const thunders = ctx.sources.filter((s) => s.loop && s.starts.length && s.stops.length)
    graph.stop()
    const restopped = thunders.filter((s) => s.stops.length > 1)
    expect(thunders.length).toBeGreaterThan(20)
    expect(restopped.length).toBeLessThan(4)
  })

  it('noise colour picks the buffer', () => {
    const bufferOf = (color: 'pink' | 'brown') => {
      const { ctx } = build('noise', color)
      return (ctx.sources.find((s) => s.kind === 'buffer') as FakeSource).buffer
    }
    expect(bufferOf('pink')).not.toBe(bufferOf('brown'))
  })

  it.each(['storm', 'campfire', 'birds', 'waves', 'creek'] as const)(
    '%s keeps scheduling after build',
    (id) => {
      const { ctx } = build(id)
      const probe = () =>
        ctx.nodes.reduce(
          (n, x) => n + ((x as { gain?: { calls: unknown[] } }).gain?.calls.length ?? 0),
          0,
        ) + ctx.sources.length
      const before = probe()
      for (let i = 0; i < 15; i++) ctx.advance(0.7, vi)
      // creek is a continuous bed; it only needs to keep running without throwing
      if (id !== 'creek') expect(probe()).toBeGreaterThan(before)
    },
  )
})
