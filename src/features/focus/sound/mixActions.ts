/**
 * Writes to the sound mixer. Everything goes through the settings row (`sound.mixer`, and the
 * device-only `sound.device`). Slider moves (`setLayer`, `setMaster`, `setMusicVolume`) also land in an
 * in-memory overlay the player reads at once, so the audio follows the finger while the row is written at
 * most every 250 ms (the first move in a window schedules the write, so the last value always lands).
 */
import { recordError } from '@/app/reportError'
import { getActiveSession } from '@/db/repos/sessions'
import { getSettings, updateSettings } from '@/db/repos/settings'
import { replaceMixer } from '@/db/repos/soundMixer'
import type { ID, LofiStyle, NoiseColor, NoiseLayer, Settings, SoundMixer } from '@/db/types'
import { unlockAudio } from '@/lib/audio/engine'
import { clamp01 } from '@/lib/audio/envelope'
import { newId } from '@/lib/ids'
import {
  applyPreset,
  deletePreset,
  effectiveMixer,
  isSilent,
  MAX_PRESETS,
  renamePreset,
  savePreset,
} from '@/logic/soundMix'

export const WRITE_EVERY_MS = 250

type Key = NoiseLayer | 'master' | 'music'

/** Replaced, never mutated, so it works with `useSyncExternalStore`. */
export interface MixOverlay {
  /** Slider values not in the row yet. The next write carries them. */
  pending: Partial<Record<Key, number>>
  /**
   * Values a write already put in the row, with that row's `updatedAt`. For display only (writes never
   * carry them): a view whose own row is older than the write still shows the new value, so a slider
   * never snaps back while that view's live query catches up.
   */
  landed: Partial<Record<Key, { value: number; at: number }>>
}

const EMPTY: MixOverlay = { pending: {}, landed: {} }
let overlay = EMPTY
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

export const getOverlay = (): MixOverlay => overlay
export const subscribeOverlay = (fn: () => void): (() => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const setOverlay = (next: MixOverlay) => {
  overlay = next
  listeners.forEach((fn) => fn())
}

const entries = <V>(o: Partial<Record<Key, V>>) => Object.entries(o) as [Key, V][]

/**
 * `mixer` with the unsaved slider values on top. Without `rowAt` (a write) only the pending values;
 * with `rowAt`, the `updatedAt` of the row a view read `mixer` from, also the landed values that row
 * may not have yet.
 */
export function withOverlay(mixer: SoundMixer, o: MixOverlay, rowAt?: number): SoundMixer {
  if (o === EMPTY) return mixer
  const values: Partial<Record<Key, number>> = {}
  // ponytail: rows only carry a millisecond `updatedAt`, so a row from the same millisecond as the
  // write counts as "not caught up" and shows the landed value, even when another writer changed that
  // key in that millisecond (the view shows it once the row changes again). A per-write sequence
  // number in the row would make this exact.
  if (rowAt !== undefined)
    for (const [k, l] of entries(o.landed)) if (rowAt <= l.at) values[k] = l.value
  Object.assign(values, o.pending)
  const layers = { ...mixer.layers }
  let { master } = mixer
  let volume = mixer.music.volume
  for (const [k, v] of entries(values)) {
    if (k === 'master') master = v
    else if (k === 'music') volume = v
    else if (v > 0) layers[k] = v
    else delete layers[k]
  }
  return { ...mixer, layers, master, music: { ...mixer.music, volume } }
}

const change = (fn: (m: SoundMixer) => SoundMixer): Promise<Settings> => replaceMixer(fn)

/** The pending values of `sent` that are still current moved to `landed`, at the row time `at`. */
function markLanded(sent: MixOverlay, at: number): void {
  const pending = { ...overlay.pending }
  const landed = { ...overlay.landed }
  for (const [k, value] of entries(sent.pending))
    if (pending[k] === value) {
      delete pending[k]
      landed[k] = { value, at }
    }
  setOverlay({ pending, landed })
}

/** Forgets the pending values of `sent` that are still current (the write for them failed). */
function dropSent(sent: MixOverlay): void {
  const pending = { ...overlay.pending }
  for (const [k, value] of entries(sent.pending)) if (pending[k] === value) delete pending[k]
  setOverlay({ ...overlay, pending })
}

/** Forgets everything the overlay holds for `keys`: a write that sets them outright supersedes it. */
function forget(keys: Key[]): void {
  const pending = { ...overlay.pending }
  const landed = { ...overlay.landed }
  for (const k of keys) {
    delete pending[k]
    delete landed[k]
  }
  setOverlay({ pending, landed })
}

async function flush(): Promise<void> {
  timer = undefined
  const sent = overlay
  if (Object.keys(sent.pending).length === 0) return
  try {
    const row = await change((m) => withOverlay(m, sent))
    markLanded(sent, row.updatedAt)
  } catch (e) {
    recordError(e, 'sound.mixer.write')
    dropSent(sent)
  }
}

/** Writes pending slider values now instead of at the end of the 250 ms window. */
export function flushPending(): Promise<void> {
  if (timer === undefined) return Promise.resolve()
  clearTimeout(timer)
  return flush()
}

// A page being closed or hidden will not wait for the timer.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flushPending())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushPending()
  })
}

function schedule(key: Key, value: number): void {
  setOverlay({ ...overlay, pending: { ...overlay.pending, [key]: clamp01(value) } })
  timer ??= setTimeout(() => void flush(), WRITE_EVERY_MS)
}

export const setLayer = (layer: NoiseLayer, volume: number): void => schedule(layer, volume)
export const setMaster = (volume: number): void => schedule('master', volume)
export const setMusicVolume = (volume: number): void => schedule('music', volume)

const PLAY = { enabled: true, device: { playing: true, pausedSession: null } }

/** Puts one layer at `volume` and plays (the "Sound: Rain" commands). */
export async function playLayer(layer: NoiseLayer, volume: number): Promise<void> {
  forget([layer])
  await change((m) => ({ ...m, layers: { ...m.layers, [layer]: clamp01(volume) } }))
  await updateSettings({ sound: PLAY })
}

/**
 * Play or Pause. `sounding` is what the caller shows (`useWantsSound`); without it, it is worked out
 * here. Pause also records the active session, so "start with focus" stays quiet for the rest of it.
 * Play with nothing in the mix starts brown noise at 40% (what the sound key always did), so it is heard.
 */
export async function toggleSound(sounding?: boolean): Promise<void> {
  const [{ sound }, session] = await Promise.all([getSettings(), getActiveSession()])
  const mix = withOverlay(effectiveMixer(sound), overlay)
  const device = sound.device
  const now =
    sounding ??
    wantsSound(sound.enabled, mix, device?.playing ?? false, session, device?.pausedSession)
  if (now) {
    await updateSettings({
      sound: { device: { playing: false, pausedSession: session?.id ?? null } },
    })
    return
  }
  if (isSilent(mix)) {
    forget(['noise'])
    await change((m) => ({ ...m, layers: { noise: 0.4 }, noiseColor: 'brown' }))
  }
  await updateSettings({ sound: PLAY })
}

/** Picks the lofi style (or 'off'). Choosing one while sound is off also starts playing, so it is heard. */
export async function setStyle(style: LofiStyle | 'off'): Promise<void> {
  if (style !== 'off') void unlockAudio()
  await change((m) => ({ ...m, music: { ...m.music, style } }))
  if (style !== 'off') await updateSettings({ sound: PLAY })
}

export const setNoiseColor = (color: NoiseColor): Promise<void> =>
  change((m) => ({ ...m, noiseColor: color })).then(() => undefined)

export const setWithFocus = (on: boolean): Promise<void> =>
  change((m) => ({ ...m, withFocus: on })).then(() => undefined)

/** Saves the mix as it sounds now (unsaved slider moves included) under `name`. */
export async function saveCurrentMix(name: string): Promise<'saved' | 'full' | 'empty'> {
  if (!name.trim()) return 'empty'
  const sent = overlay
  let full = false
  await change((m) => {
    full = m.presets.length >= MAX_PRESETS
    return full ? m : savePreset(withOverlay(m, sent), name, newId)
  })
  return full ? 'full' : 'saved'
}

/** Plays a saved mix: one write replaces the whole mix, and slider moves it supersedes are forgotten. */
export async function applyMix(id: string): Promise<void> {
  clearTimeout(timer)
  timer = undefined
  setOverlay(EMPTY)
  const row = await change((m) => applyPreset(m, id))
  if (!isSilent(effectiveMixer(row.sound))) {
    void unlockAudio()
    await updateSettings({ sound: PLAY })
  }
}

export const renameMix = (id: string, name: string): Promise<void> =>
  change((m) => renamePreset(m, id, name)).then(() => undefined)

/** Removes a saved mix. `undo` puts it back where it was. */
export async function deleteMix(id: string): Promise<{ undo: () => Promise<void> }> {
  let removed: { at: number; preset: SoundMixer['presets'][number] } | undefined
  await change((m) => {
    const at = m.presets.findIndex((p) => p.id === id)
    if (at >= 0) removed = { at, preset: m.presets[at]! }
    return deletePreset(m, id)
  })
  return {
    undo: () =>
      change((m) => {
        if (!removed || m.presets.length >= MAX_PRESETS || m.presets.some((p) => p.id === id))
          return m
        const presets = [...m.presets]
        presets.splice(removed.at, 0, removed.preset)
        return { ...m, presets }
      }).then(() => undefined),
  }
}

export async function setSectionOpen(
  section: 'lofi' | 'sounds' | 'mixes',
  open: boolean,
): Promise<void> {
  await updateSettings({ sound: { device: { open: { [section]: open } } } })
}

/** Turns every noise layer off. `undo` puts them back as they were. */
export async function resetLayers(): Promise<{ undo: () => Promise<void> }> {
  clearTimeout(timer)
  timer = undefined
  const { sound } = await getSettings()
  const before = withOverlay(effectiveMixer(sound), overlay).layers
  // The overlay shows the layers off at once; the write carries any other pending value too.
  const pending = { ...overlay.pending }
  for (const l of Object.keys(before) as NoiseLayer[]) pending[l] = 0
  const sent = { ...overlay, pending }
  setOverlay(sent)
  try {
    const row = await change((m) => ({ ...withOverlay(m, sent), layers: {} }))
    markLanded(sent, row.updatedAt)
  } catch (e) {
    dropSent(sent)
    throw e
  }
  return {
    undo: async () => {
      forget(Object.keys(before) as NoiseLayer[])
      await change((m) => ({ ...m, layers: { ...before } }))
    },
  }
}

/**
 * Whether this device should be making sound: the sounds switch is on and the play switch, or "start
 * with focus" during a running focus session (unless Pause was pressed in that session).
 */
export function wantsSound(
  enabled: boolean,
  mix: SoundMixer | undefined,
  playing: boolean,
  session: { id?: ID; kind: string; status: string } | null,
  pausedSession?: ID | null,
): boolean {
  if (!enabled || !mix || isSilent(mix)) return false
  if (playing) return true
  return (
    mix.withFocus &&
    session?.kind === 'focus' &&
    session.status === 'running' &&
    !(pausedSession && session.id === pausedSession)
  )
}

/** Test helper: forgets all unsaved slider values. */
export function clearOverlay(): void {
  clearTimeout(timer)
  timer = undefined
  setOverlay(EMPTY)
}
