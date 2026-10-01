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

  it.each(NOISE_LAYERS)('%s: output is unconnected and stop() stops every source', (id) => {
    const { ctx, graph } = build(id)
    expect((graph.output as unknown as { connections: unknown[] }).connections).toEqual([])
    for (let i = 0; i < 20; i++) ctx.advance(0.5, vi)
    graph.stop()
    const sources = ctx.sources
    expect(sources.length).toBeGreaterThan(0)
    for (const s of sources) if (s.starts.length) expect(s.stops.length).toBeGreaterThan(0)
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
