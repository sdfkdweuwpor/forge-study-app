/**
 * Writes to the sound mixer. Everything goes through the settings row (`sound.mixer`, and the
 * device-only `sound.device`). Slider moves (`setLayer`, `setMaster`) also land in an in-memory overlay
 * the player reads at once, so the audio follows the finger while the row is written at most every
 * 250 ms (the first move in a window schedules the write, so the last value always lands).
 */
import { recordError } from '@/app/reportError'
import { getSettings, replaceMixer, updateSettings } from '@/db/repos/settings'
import type { LofiStyle, NoiseColor, NoiseLayer, Settings, SoundMixer } from '@/db/types'
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

/**
 * Slider values not yet in the row. Replaced, never mutated, so it works with `useSyncExternalStore`.
 * `landed` says when a value's write reached the row (that row's `updatedAt`).
 */
export interface MixOverlay {
  layers: Partial<Record<NoiseLayer, number>>
  master?: number
  music?: number
  landed?: { layers: Partial<Record<NoiseLayer, number>>; master?: number; music?: number }
}

const EMPTY: MixOverlay = { layers: {} }
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

/**
 * The stored mixer with the unsaved slider values on top. `rowAt` is the `updatedAt` of the settings row
 * `mixer` was read from. Every mounted view reads its own copy of the row, so one can still hold the
 * row from before a write another view already saw; an entry is therefore dropped per view, never for
 * all: only when this view's row is newer than the write that carried the value, or is that write's row
 * (its value matches). A value changed after a write was sent has no `landed` mark and always shows.
 */
export function withOverlay(mixer: SoundMixer, o: MixOverlay, rowAt?: number): SoundMixer {
  if (o === EMPTY) return mixer
  const caughtUp = (landedAt: number | undefined, same: boolean): boolean =>
    rowAt !== undefined &&
    landedAt !== undefined &&
    (rowAt > landedAt || (rowAt === landedAt && same))
  const layers = { ...mixer.layers }
  for (const [l, v] of Object.entries(o.layers) as [NoiseLayer, number][]) {
    if (caughtUp(o.landed?.layers[l], (mixer.layers[l] ?? 0) === v)) continue
    if (v > 0) layers[l] = v
    else delete layers[l]
  }
  const master =
    o.master !== undefined && !caughtUp(o.landed?.master, mixer.master === o.master)
      ? o.master
      : mixer.master
  const volume =
    o.music !== undefined && !caughtUp(o.landed?.music, mixer.music.volume === o.music)
      ? o.music
      : mixer.music.volume
  return { ...mixer, layers, master, music: { ...mixer.music, volume } }
}

const change = (fn: (m: SoundMixer) => SoundMixer): Promise<Settings> => replaceMixer(fn)

const without = <T extends object>(o: T | undefined, key: keyof T): T | undefined => {
  if (!o) return o
  const { [key]: _drop, ...rest } = o
  return rest as T
}

/** Marks the values of `sent` that are still current as written, at the row time `at`. */
function markLanded(sent: MixOverlay, at: number): void {
  const layers = { ...overlay.landed?.layers }
  for (const l of Object.keys(sent.layers) as NoiseLayer[])
    if (overlay.layers[l] === sent.layers[l]) layers[l] = at
  const master =
    sent.master !== undefined && overlay.master === sent.master ? at : overlay.landed?.master
  const music =
    sent.music !== undefined && overlay.music === sent.music ? at : overlay.landed?.music
  setOverlay({ ...overlay, landed: { layers, master, music } })
}

/** Forgets overlay entries that equal `sent` (the write for them failed). */
function dropSent(sent: MixOverlay): void {
  const layers = { ...overlay.layers }
  const landed = { ...overlay.landed?.layers }
  for (const l of Object.keys(sent.layers) as NoiseLayer[])
    if (layers[l] === sent.layers[l]) {
      delete layers[l]
      delete landed[l]
    }
  const master = overlay.master === sent.master ? undefined : overlay.master
  const music = overlay.music === sent.music ? undefined : overlay.music
  setOverlay(
    Object.keys(layers).length === 0 && master === undefined && music === undefined
      ? EMPTY
      : {
          layers,
          master,
          music,
          landed: {
            layers: landed,
            master: master === undefined ? undefined : overlay.landed?.master,
            music: music === undefined ? undefined : overlay.landed?.music,
          },
        },
  )
}

async function flush(): Promise<void> {
  timer = undefined
  const sent = overlay
  try {
    const row = await change((m) => withOverlay(m, sent))
    markLanded(sent, row.updatedAt)
  } catch (e) {
    recordError(e, 'sound.mixer.write')
    dropSent(sent)
  }
}

function schedule(next: MixOverlay): void {
  setOverlay(next)
  timer ??= setTimeout(() => void flush(), WRITE_EVERY_MS)
}

export function setLayer(layer: NoiseLayer, volume: number): void {
  const landed = overlay.landed && {
    ...overlay.landed,
    layers: without(overlay.landed.layers, layer)!,
  }
  schedule({ ...overlay, layers: { ...overlay.layers, [layer]: clamp01(volume) }, landed })
}

export function setMaster(volume: number): void {
  const landed = overlay.landed && { ...overlay.landed, master: undefined }
  schedule({ ...overlay, master: clamp01(volume), landed })
}

export function setMusicVolume(volume: number): void {
  const landed = overlay.landed && { ...overlay.landed, music: undefined }
  schedule({ ...overlay, music: clamp01(volume), landed })
}

/** Picks the lofi style (or 'off'). Choosing one while sound is off also starts playing, so it is heard. */
export async function setStyle(style: LofiStyle | 'off'): Promise<void> {
  if (style !== 'off') void unlockAudio()
  await change((m) => ({ ...m, music: { ...m.music, style } }))
  if (style !== 'off') await updateSettings({ sound: { enabled: true, device: { playing: true } } })
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
    await updateSettings({ sound: { enabled: true, device: { playing: true } } })
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

export async function setPlaying(on: boolean): Promise<void> {
  await updateSettings({ sound: { device: { playing: on } } })
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
  const sent = overlay
  const { sound } = await getSettings()
  const before = withOverlay(effectiveMixer(sound), sent).layers
  // The overlay shows the layers off at once and holds until the row says so.
  const off = { ...sent.layers }
  const landed = { ...sent.landed?.layers }
  for (const l of Object.keys(before) as NoiseLayer[]) {
    off[l] = 0
    delete landed[l]
  }
  const next = { ...sent, layers: off, landed: { ...sent.landed, layers: landed } }
  setOverlay(next)
  try {
    const row = await change((m) => ({ ...m, layers: {}, master: sent.master ?? m.master }))
    markLanded(next, row.updatedAt)
  } catch (e) {
    dropSent(next)
    throw e
  }
  return { undo: () => change((m) => ({ ...m, layers: { ...before } })).then(() => undefined) }
}

/** Whether this device should be making sound: the sounds switch is on and the play switch, or "start with focus" during a running focus session. */
export function wantsSound(
  enabled: boolean,
  mix: SoundMixer | undefined,
  playing: boolean,
  session: { kind: string; status: string } | null,
): boolean {
  if (!enabled || !mix || isSilent(mix)) return false
  return playing || (mix.withFocus && session?.kind === 'focus' && session.status === 'running')
}

/** Test helper: forgets all unsaved slider values. */
export function clearOverlay(): void {
  clearTimeout(timer)
  timer = undefined
  setOverlay(EMPTY)
}
