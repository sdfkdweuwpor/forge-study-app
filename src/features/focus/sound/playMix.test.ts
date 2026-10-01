import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectiveMixer } from '@/logic/soundMix'
import { playMix } from './playMix'

const audio = vi.hoisted(() => ({ armAudioUnlock: vi.fn(), applyMix: vi.fn(), stopMix: vi.fn() }))
const recordError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/audio', () => audio)
vi.mock('@/app/reportError', () => ({ recordError }))

const mix = effectiveMixer({ ambient: 'rain', ambientVolume: 0.3 } as never)
beforeEach(() => vi.clearAllMocks())

describe('playMix (autoplay blocked)', () => {
  it('arms the unlock and applies the mix', async () => {
    audio.applyMix.mockResolvedValue(undefined)
    await playMix(mix)
    expect(audio.armAudioUnlock).toHaveBeenCalledOnce()
    expect(audio.applyMix).toHaveBeenCalledWith(mix, expect.anything())
  })

  it('never throws when the browser blocks audio; the error is recorded', async () => {
    audio.applyMix.mockRejectedValue(new Error('NotAllowedError'))
    await expect(playMix(mix)).resolves.toBeUndefined()
    expect(audio.armAudioUnlock).toHaveBeenCalled()
    expect(recordError).toHaveBeenCalledWith(expect.any(Error), 'sound.apply')
  })

  it('never throws when arming throws synchronously', async () => {
    audio.armAudioUnlock.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    await expect(playMix(mix)).resolves.toBeUndefined()
    expect(recordError).toHaveBeenCalled()
  })
})
