import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { db } from '@/db/db'
import { resetDomainEvents, settleDomainEvents } from '@/db/events'
import { getSettings } from '@/db/repos/settings'
import { effectiveMixer } from '@/logic/soundMix'
import { syncedSettings } from '@/logic/syncTables'
import {
  getOverlay,
  resetLayers,
  setLayer,
  setPlaying,
  setSectionOpen,
  setWithFocus,
  wantsSound,
} from './mixActions'

let writes = 0
const count = () => {
  writes += 1
}

beforeEach(async () => {
  resetDomainEvents()
  await Promise.all(db.tables.map((t) => t.clear()))
  writes = 0
  db.settings.hook('updating', count)
  db.settings.hook('creating', count)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(async () => {
  db.settings.hook('updating').unsubscribe(count)
  db.settings.hook('creating').unsubscribe(count)
  vi.useRealTimers()
  await settleDomainEvents()
  resetDomainEvents()
})

const layers = async () => effectiveMixer((await getSettings()).sound).layers

describe('setLayer', () => {
  it('coalesces 30 calls in 100 ms into one write after 250 ms with the last value', async () => {
    for (let i = 1; i <= 30; i++) {
      setLayer('rain', i / 100)
      await vi.advanceTimersByTimeAsync(3)
    }
    expect(getOverlay().layers.rain).toBeCloseTo(0.3) // audio sees it at once
    expect(writes).toBe(0)
    setLayer('rain', 0.4)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(writes).toBe(1))
    expect((await layers()).rain).toBe(0.4)
    expect(getOverlay().layers).toEqual({})
  })

  it('removes the key at volume 0', async () => {
    setLayer('rain', 0.4)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () => expect(await layers()).toEqual({ rain: 0.4 }))
    setLayer('rain', 0)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () => expect(await layers()).toEqual({}))
    expect(await layers()).toEqual({})
    expect((await getSettings()).sound.mixer?.layers).toEqual({})
  })
})

describe('resetLayers', () => {
  it('empties the layers and undo restores them', async () => {
    setLayer('rain', 0.4)
    setLayer('wind', 0.2)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () => expect(await layers()).toEqual({ rain: 0.4, wind: 0.2 }))
    const { undo } = await resetLayers()
    expect(await layers()).toEqual({})
    await undo()
    expect(await layers()).toEqual({ rain: 0.4, wind: 0.2 })
  })
})

describe('device state', () => {
  it('setPlaying writes sound.device.playing and leaves the synced settings alone', async () => {
    await setWithFocus(true)
    const before = syncedSettings(await getSettings())
    await setPlaying(true)
    const row = await getSettings()
    expect(row.sound.device?.playing).toBe(true)
    expect({ ...syncedSettings(row), updatedAt: 0 }).toEqual({ ...before, updatedAt: 0 })
    await setSectionOpen('mixes', true)
    expect((await getSettings()).sound.device?.open.mixes).toBe(true)
    expect((await getSettings()).sound.device?.playing).toBe(true)
  })

  it('setWithFocus persists', async () => {
    await setWithFocus(false)
    expect(effectiveMixer((await getSettings()).sound).withFocus).toBe(false)
  })
})

describe('wantsSound', () => {
  const rain = {
    ...effectiveMixer({ ambient: 'rain', ambientVolume: 0.3 } as never),
    withFocus: true,
  }
  const focus = { kind: 'focus', status: 'running' }
  it('plays on the switch, or with focus, never when silent', () => {
    expect(wantsSound(rain, true, null)).toBe(true)
    expect(wantsSound(rain, false, focus)).toBe(true)
    expect(wantsSound(rain, false, { kind: 'focus', status: 'paused' })).toBe(false)
    expect(wantsSound({ ...rain, withFocus: false }, false, focus)).toBe(false)
    expect(wantsSound({ ...rain, layers: {} }, true, focus)).toBe(false)
    expect(wantsSound(undefined, true, focus)).toBe(false)
  })
})
