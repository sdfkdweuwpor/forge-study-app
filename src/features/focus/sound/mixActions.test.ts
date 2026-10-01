import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { db } from '@/db/db'
import { resetDomainEvents, settleDomainEvents } from '@/db/events'
import { getActiveSession, startSession } from '@/db/repos/sessions'
import { getSettings, updateSettings } from '@/db/repos/settings'
import { effectiveMixer } from '@/logic/soundMix'
import { syncedSettings } from '@/logic/syncTables'
import {
  applyMix,
  clearOverlay,
  deleteMix,
  saveCurrentMix,
  getOverlay,
  resetLayers,
  setLayer,
  setMaster,
  setMusicVolume,
  setNoiseColor,
  setSectionOpen,
  setStyle,
  setWithFocus,
  flushPending,
  toggleSound,
  withOverlay,
  wantsSound,
} from './mixActions'
import { playLayer } from './playToggle'

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
  clearOverlay()
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
    expect(getOverlay().pending.rain).toBeCloseTo(0.3) // audio sees it at once
    expect(writes).toBe(0)
    setLayer('rain', 0.4)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(writes).toBe(1))
    expect((await layers()).rain).toBe(0.4)
  })

  it('keeps the overlay for a row older than the write, and stops needing it once the row has it', async () => {
    const old = await getSettings()
    setLayer('rain', 0.4)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () => expect((await layers()).rain).toBe(0.4))
    const o = getOverlay()
    const show = (s: typeof old) => withOverlay(effectiveMixer(s.sound), o, s.updatedAt).layers.rain
    await vi.waitFor(() => expect(getOverlay().landed.rain).toBeDefined())
    expect(show({ ...old, updatedAt: old.updatedAt - 1 })).toBe(0.4) // a view that has not seen the write
    expect(show(await getSettings())).toBe(0.4) // the row itself: same value either way
    const next = await getSettings()
    next.sound.mixer = { ...effectiveMixer(next.sound), layers: { rain: 0.7 } }
    expect(show({ ...next, updatedAt: next.updatedAt + 1 })).toBe(0.7) // a newer row wins
  })

  it('an overlay 0 hides a stored layer until a newer row says otherwise', () => {
    setLayer('rain', 0)
    const mixer = effectiveMixer({ ambient: 'rain', ambientVolume: 0.3 } as never)
    expect(withOverlay(mixer, getOverlay(), 1).layers.rain).toBeUndefined()
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

describe('overlay across lagging views', () => {
  // Each mounted `useMixer` reads its own live query, so one view can hold the row from before the latest
  // write while another already has it. The mix a view shows is `withOverlay(its row, overlay)`.
  const view = (s: Awaited<ReturnType<typeof getSettings>>) =>
    withOverlay(effectiveMixer(s.sound), getOverlay(), s.updatedAt).layers.rain

  it('never goes back to an older value when a write lands between presses', async () => {
    setLayer('rain', 0.1)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () => expect((await layers()).rain).toBe(0.1))
    const lagging = await getSettings() // a view that has the first write only
    setLayer('rain', 0.15)
    setLayer('rain', 0.2)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () => expect((await layers()).rain).toBe(0.2))
    const fresh = await getSettings()
    expect(view(fresh)).toBe(0.2)
    expect(view(lagging)).toBe(0.2) // the lagging view must not show 0.1
    setLayer('rain', 0.25) // a press after the write landed
    expect(view(lagging)).toBe(0.25)
    expect(view(fresh)).toBe(0.25)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () => expect((await layers()).rain).toBe(0.25))
    expect(view(await getSettings())).toBe(0.25)
  })
})

describe('music', () => {
  const music = async () => effectiveMixer((await getSettings()).sound).music

  it('setStyle writes at once, keeps the volume, and starts playing for a style', async () => {
    await setStyle('tokyo')
    expect(await music()).toEqual({ style: 'tokyo', volume: 0.6 })
    const { sound } = await getSettings()
    expect(sound.enabled).toBe(true)
    expect(sound.device?.playing).toBe(true)
  })

  it('setStyle off stops nothing else and does not start playing', async () => {
    await setStyle('off')
    expect((await music()).style).toBe('off')
    expect((await getSettings()).sound.device?.playing ?? false).toBe(false)
  })

  it('setMusicVolume coalesces into one write, clamped, and shows in the overlay at once', async () => {
    for (let i = 1; i <= 10; i++) setMusicVolume(i / 10)
    setMusicVolume(2)
    expect(
      withOverlay(effectiveMixer((await getSettings()).sound), getOverlay()).music.volume,
    ).toBe(1)
    expect(writes).toBe(0)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(() => expect(writes).toBe(1))
    expect((await music()).volume).toBe(1)
  })
})

describe('music volume overlay', () => {
  it('survives a write landing, then yields to the row', async () => {
    const view = (s: Awaited<ReturnType<typeof getSettings>>) =>
      withOverlay(effectiveMixer(s.sound), getOverlay(), s.updatedAt).music.volume
    const old = await getSettings()
    setMusicVolume(0.3)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () =>
      expect(effectiveMixer((await getSettings()).sound).music.volume).toBe(0.3),
    )
    expect(view(old)).toBe(0.3) // a view still on the old row keeps the value
    expect(view(await getSettings())).toBe(0.3)
    setMusicVolume(0.4) // after the write landed
    expect(view(await getSettings())).toBe(0.4)
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
  it('Play writes sound.device.playing and leaves the synced settings alone', async () => {
    setLayer('rain', 0.4)
    await flushPending()
    await setWithFocus(true)
    const before = syncedSettings(await getSettings())
    await toggleSound(false)
    const row = await getSettings()
    expect(row.sound.device?.playing).toBe(true)
    expect({ ...syncedSettings(row), updatedAt: 0 }).toEqual({ ...before, updatedAt: 0 })
    await setSectionOpen('mixes', true)
    expect((await getSettings()).sound.device?.open.mixes).toBe(true)
    expect((await getSettings()).sound.device?.playing).toBe(true)
  })

  it('overlapping changes both survive', async () => {
    setLayer('rain', 0.4)
    await Promise.all([
      setNoiseColor('pink'),
      setWithFocus(false),
      vi.advanceTimersByTimeAsync(300),
    ])
    await vi.waitFor(async () => {
      const m = effectiveMixer((await getSettings()).sound)
      expect(m).toMatchObject({ noiseColor: 'pink', withFocus: false, layers: { rain: 0.4 } })
    })
  })

  it('setWithFocus persists', async () => {
    await setWithFocus(false)
    expect(effectiveMixer((await getSettings()).sound).withFocus).toBe(false)
  })
})

describe('resetLayers overlay', () => {
  it('shows the layers off at once, keeps a pending master, and holds until the row agrees', async () => {
    setLayer('rain', 0.4)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () => expect((await layers()).rain).toBe(0.4))
    setMaster(0.5)
    await resetLayers()
    expect(getOverlay().landed.rain?.value).toBe(0)
    const m = effectiveMixer((await getSettings()).sound)
    expect(m.layers).toEqual({})
    expect(m.master).toBe(0.5)
  })
})

describe('wantsSound', () => {
  const rain = {
    ...effectiveMixer({ ambient: 'rain', ambientVolume: 0.3 } as never),
    withFocus: true,
  }
  const focus = { kind: 'focus', status: 'running' }
  it('plays on the switch, or with focus, never when silent', () => {
    expect(wantsSound(true, rain, true, null)).toBe(true)
    expect(wantsSound(true, rain, false, focus)).toBe(true)
    expect(wantsSound(true, rain, false, { kind: 'focus', status: 'paused' })).toBe(false)
    expect(wantsSound(true, { ...rain, withFocus: false }, false, focus)).toBe(false)
    expect(wantsSound(true, { ...rain, layers: {} }, true, focus)).toBe(false)
    expect(wantsSound(true, undefined, true, focus)).toBe(false)
  })
  it('Pause pressed in a with-focus session keeps that session quiet, not the next one', () => {
    const s1 = { id: 's1', kind: 'focus', status: 'running' }
    expect(wantsSound(true, rain, false, s1, 's1')).toBe(false)
    expect(wantsSound(true, rain, true, s1, 's1')).toBe(true) // Play wins
    expect(wantsSound(true, rain, false, { ...s1, id: 's2' }, 's1')).toBe(true)
  })
  it('never plays when the sounds switch is off', () => {
    expect(wantsSound(false, rain, true, null)).toBe(false)
    expect(wantsSound(false, rain, false, focus)).toBe(false)
  })
})

describe('saved mixes', () => {
  it('saves what is on screen, slider moves included, and applying replaces a pending overlay', async () => {
    await setStyle('tokyo')
    setLayer('rain', 0.4)
    expect(await saveCurrentMix('Rainy Tokyo')).toBe('saved')
    const [preset] = effectiveMixer((await getSettings()).sound).presets
    expect(preset?.mix.layers).toEqual({ rain: 0.4 })

    setLayer('rain', 0.9) // a drag still pending
    setLayer('wind', 0.5)
    await applyMix(preset!.id)
    expect(getOverlay().pending).toEqual({})
    await vi.advanceTimersByTimeAsync(500) // no stale write lands afterwards
    const m = effectiveMixer((await getSettings()).sound)
    expect(m.layers).toEqual({ rain: 0.4 })
    expect(m.music.style).toBe('tokyo')
  })
  it('delete returns an undo that puts it back in place', async () => {
    for (const n of ['a', 'b', 'c']) await saveCurrentMix(n)
    const read = async () => effectiveMixer((await getSettings()).sound).presets.map((p) => p.name)
    const id = effectiveMixer((await getSettings()).sound).presets[1]!.id
    const { undo } = await deleteMix(id)
    expect(await read()).toEqual(['a', 'c'])
    await undo()
    expect(await read()).toEqual(['a', 'b', 'c'])
  })
})

describe('writes never carry values the row already has', () => {
  it('Reset, Undo, then a Master move keeps the restored layers', async () => {
    setLayer('rain', 0.4)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () => expect(await layers()).toEqual({ rain: 0.4 }))
    const { undo } = await resetLayers()
    await undo()
    expect(await layers()).toEqual({ rain: 0.4 })
    setMaster(0.5)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () =>
      expect(effectiveMixer((await getSettings()).sound).master).toBe(0.5),
    )
    expect(await layers()).toEqual({ rain: 0.4 })
  })

  it('a layer changed elsewhere after a slider write survives a later Master move', async () => {
    setLayer('rain', 0.1)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () => expect((await layers()).rain).toBe(0.1))
    await playLayer('rain', 0.4) // the palette's "Sound: Rain", or another tab
    expect((await layers()).rain).toBe(0.4)
    setMaster(0.5)
    await vi.advanceTimersByTimeAsync(300)
    await vi.waitFor(async () =>
      expect(effectiveMixer((await getSettings()).sound).master).toBe(0.5),
    )
    expect((await layers()).rain).toBe(0.4)
  })
})

describe('toggleSound', () => {
  const sounding = async () => {
    const { sound } = await getSettings()
    const d = sound.device
    const session = await getActiveSession()
    return wantsSound(
      sound.enabled,
      effectiveMixer(sound),
      d?.playing ?? false,
      session,
      d?.pausedSession,
    )
  }

  it('Pause silences a with-focus session, and Play brings it back', async () => {
    setLayer('rain', 0.4)
    await flushPending()
    await setWithFocus(true)
    await updateSettings({ sound: { enabled: true } })
    await startSession({ mode: 'custom', kind: 'focus', plannedMin: 25 })
    expect(await sounding()).toBe(true)
    await toggleSound()
    expect(await sounding()).toBe(false)
    expect((await getSettings()).sound.device?.playing).toBe(false)
    await toggleSound()
    expect(await sounding()).toBe(true)
    expect((await getSettings()).sound.device?.pausedSession).toBeNull()
  })

  it('Play with nothing in the mix starts brown noise at 40%, so it is heard', async () => {
    expect(effectiveMixer((await getSettings()).sound).layers).toEqual({})
    await toggleSound()
    const { sound } = await getSettings()
    expect(effectiveMixer(sound)).toMatchObject({ layers: { noise: 0.4 }, noiseColor: 'brown' })
    expect(await sounding()).toBe(true)
  })
})

describe('flushPending', () => {
  it('writes a pending slider value at once (the page is being closed)', async () => {
    setLayer('rain', 0.3)
    expect(writes).toBe(0)
    await flushPending()
    expect((await layers()).rain).toBe(0.3)
    expect(getOverlay().pending).toEqual({})
  })
})
