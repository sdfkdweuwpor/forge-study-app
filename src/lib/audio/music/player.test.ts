import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeAudioContext, FakeSource } from '@/test/fakeAudio'
import { createComposer } from './composer'
import { startMusic } from './player'

let ctx: FakeAudioContext
beforeEach(() => {
  vi.useFakeTimers()
  ctx = new FakeAudioContext()
})
afterEach(() => vi.useRealTimers())

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
    vi.restoreAllMocks()
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

  it('stop(500) stops every voice and texture source after the fade', () => {
    const h = startMusic(ctx.asContext(), out(), 'classic')
    const n = ctx.sources.length
    const stopsBefore = ctx.sources.filter((s) => s.stops.length > 1).length
    h.stop(500)
    expect(stopsBefore).toBe(0)
    ctx.advance(2, vi)
    const buffers = ctx.sources.slice(0, n)
    expect(buffers.every((s) => s.stops.length >= 1)).toBe(true)
    const sourcesAfter = ctx.sources.length
    ctx.advance(5, vi)
    expect(ctx.sources.length).toBe(sourcesAfter) // timer stopped
  })
})
