import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeAudioContext } from '@/test/fakeAudio'

const ctx = new FakeAudioContext()
vi.mock('./engine', () => ({
  getContext: () => ctx,
  masterOutput: () => ({}),
  setBusVolume: () => {},
  resumeContext: () => Promise.resolve(true),
  emitAudioChange: () => {},
}))

import { ambientKind, isAmbientPlaying, startAmbient, stopAmbient } from './ambientCompat'

afterEach(() => vi.useRealTimers())

describe('ambientCompat', () => {
  it('starts rain and stops it', async () => {
    vi.useFakeTimers()
    await startAmbient('rain', 0.4)
    expect(ambientKind()).toBe('rain')
    const p = stopAmbient(100)
    ctx.advance(1, vi)
    await p
    expect(isAmbientPlaying()).toBe(false)
  })
})
