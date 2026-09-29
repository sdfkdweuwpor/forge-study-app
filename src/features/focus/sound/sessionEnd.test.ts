import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SoundSettings } from './hooks'

const playChime = vi.fn((_volume: number) => Promise.resolve())
const notify = vi.fn((..._args: unknown[]) => Promise.resolve(true))
let permission = 'granted'

vi.mock('@/lib/audio', () => ({ playChime: (v: number) => playChime(v) }))
vi.mock('@/lib/notify', () => ({
  notify: (...args: unknown[]) => notify(...args),
  notifyPermission: () => permission,
}))

const { alertSessionEnd, planSessionEndAlert } = await import('./sessionEnd')

const settings = (
  over: {
    sound?: Partial<SoundSettings['sound']>
    notifications?: Partial<SoundSettings['notifications']>
  } = {},
): SoundSettings => ({
  sound: {
    enabled: true,
    volume: 0.6,
    chime: true,
    ambient: 'none',
    ambientVolume: 0.4,
    ...over.sound,
  },
  notifications: { enabled: true, promptedAt: 1, ...over.notifications },
})

afterEach(() => {
  playChime.mockClear()
  notify.mockClear()
  permission = 'granted'
})

describe('planSessionEndAlert', () => {
  it('chimes at the saved volume and notifies when both are on and allowed', () => {
    expect(planSessionEndAlert(settings(), 'granted')).toEqual({
      chimeVolume: 0.6,
      notification: true,
    })
  })

  it('stays silent when sounds are off, the chime is off, or the volume is zero', () => {
    expect(
      planSessionEndAlert(settings({ sound: { enabled: false } }), 'granted').chimeVolume,
    ).toBeNull()
    expect(
      planSessionEndAlert(settings({ sound: { chime: false } }), 'granted').chimeVolume,
    ).toBeNull()
    expect(
      planSessionEndAlert(settings({ sound: { volume: 0 } }), 'granted').chimeVolume,
    ).toBeNull()
  })

  it('needs both the setting and the browser permission to notify', () => {
    expect(planSessionEndAlert(settings(), 'default').notification).toBe(false)
    expect(planSessionEndAlert(settings(), 'denied').notification).toBe(false)
    expect(planSessionEndAlert(settings(), 'unsupported').notification).toBe(false)
    expect(
      planSessionEndAlert(settings({ notifications: { enabled: false } }), 'granted').notification,
    ).toBe(false)
  })

  it('does not depend on sounds being on to notify', () => {
    const plan = planSessionEndAlert(settings({ sound: { enabled: false } }), 'granted')
    expect(plan).toEqual({ chimeVolume: null, notification: true })
  })
})

describe('alertSessionEnd', () => {
  it('plays the chime and sends a silent notification (one sound, not two)', async () => {
    await alertSessionEnd(settings(), { title: 'Focus done', body: 'C182 · 25 min' })
    expect(playChime).toHaveBeenCalledWith(0.6)
    expect(notify).toHaveBeenCalledWith('Focus done', 'C182 · 25 min', {
      silent: true,
      onClick: undefined,
    })
  })

  it('lets the notification make its own sound when the chime is off', async () => {
    await alertSessionEnd(settings({ sound: { chime: false } }), { title: 'a', body: 'b' })
    expect(playChime).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith('a', 'b', expect.objectContaining({ silent: false }))
  })

  it('does nothing when everything is off', async () => {
    permission = 'default'
    await alertSessionEnd(settings({ sound: { enabled: false } }), { title: 'a', body: 'b' })
    expect(playChime).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})
