import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeAudioContext, FakeSource } from '@/test/fakeAudio'
import { createComposer } from './composer'
import { startMusic } from './player'

const PADSTYLE = 'rainy' as const
let ctx: FakeAudioContext
beforeEach(() => {
  vi.useFakeTimers()
  ctx = new FakeAudioContext()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const out = () => ctx.createGain() as unknown as AudioNode
const startTimes = () => ctx.sources.flatMap((s) => s.starts.map((a) => a[0] ?? 0))

describe('startMusic', () => {
  it('schedules the first two bars at the right audio times', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
    startMusic(ctx.asContext(), out(), 'classic')
    const c = createComposer('classic', Math.floor(0.25 * 0xffffffff))
    const spb = 60 / c.bpm
    const expected = [0, 1].flatMap((bar) =>
      c.nextBar().map((e) => 0.1 + bar * 4 * spb + e.at * spb),
    )
    const got = ctx.sources.filter((s) => s.starts[0]?.length === 1 && (s.starts[0][0] ?? 0) >= 0.1)
    expect(got.length).toBeGreaterThanOrEqual(expected.length)
    for (const t of expected) expect(startTimes().some((x) => Math.abs(x - t) < 1e-9)).toBe(true)
  })

  it('drops missed bars after a long stall instead of bursting', () => {
    startMusic(ctx.asContext(), out(), 'classic')
    const before = ctx.sources.length
    ctx.currentTime = 40 // far past the scheduled bars, with the timer never having run
    vi.advanceTimersByTime(100)
    const late = ctx.sources.slice(before) as FakeSource[]
    expect(late.length).toBeGreaterThan(0)
    for (const s of late) for (const a of s.starts) expect(a[0] ?? 0).toBeGreaterThanOrEqual(40)
    expect(late.length).toBeLessThan(before * 2) // two bars' worth, not ten
  })

  it('pad lengths are beats converted to seconds: stops at bar end plus release', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25)
    startMusic(ctx.asContext(), out(), PADSTYLE)
    const c = createComposer(PADSTYLE, Math.floor(0.25 * 0xffffffff))
    const barDur = (60 / c.bpm) * 4
    const pads = ctx.sources.filter((s) => s.type === 'sawtooth' && s.starts[0]?.[0] === 0.1)
    expect(pads.length).toBeGreaterThan(0)
    for (const p of pads) expect(p.stops[0]?.[0]).toBeCloseTo(0.1 + barDur + 0.85, 6)
  })

  it('stop(500) stops live voices and textures and disconnects the bus after the fade', () => {
    const h = startMusic(ctx.asContext(), out(), 'classic')
    const bus = ctx.nodes[1] as unknown as { disconnected: boolean }
    const total = ctx.sources.reduce((n, s) => n + s.stops.length, 0)
    h.stop(500)
    ctx.advance(0.1, vi)
    expect(ctx.sources.reduce((n, s) => n + s.stops.length, 0)).toBe(total)
    expect(bus.disconnected).toBe(false)
    ctx.advance(2, vi)
    expect(ctx.sources.reduce((n, s) => n + s.stops.length, 0)).toBeGreaterThan(total)
    expect(bus.disconnected).toBe(true)
    const n = ctx.sources.length
    ctx.advance(5, vi)
    expect(ctx.sources.length).toBe(n)
  })
})
