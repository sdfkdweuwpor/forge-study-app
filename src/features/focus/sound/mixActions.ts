/**
 * Writes to the sound mixer. Everything goes through the settings row (`sound.mixer`, and the
 * device-only `sound.device`). Slider moves (`setLayer`, `setMaster`) also land in an in-memory overlay
 * the player reads at once, so the audio follows the finger while the row is written at most every
 * 250 ms (the first move in a window schedules the write, so the last value always lands).
 */
import { recordError } from '@/app/reportError'
import { getSettings, replaceMixer, updateSettings } from '@/db/repos/settings'
import type { NoiseColor, NoiseLayer, SoundMixer } from '@/db/types'
import { clamp01 } from '@/lib/audio/envelope'
import { effectiveMixer, isSilent } from '@/logic/soundMix'

export const WRITE_EVERY_MS = 250

/** Slider values not yet in the row. Replaced, never mutated, so it works with `useSyncExternalStore`. */
export interface MixOverlay {
  layers: Partial<Record<NoiseLayer, number>>
  master?: number
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

/** The stored mixer with the unsaved slider values on top. */
export function withOverlay(mixer: SoundMixer, o: MixOverlay): SoundMixer {
  if (o === EMPTY) return mixer
  const layers = { ...mixer.layers }
  for (const [l, v] of Object.entries(o.layers) as [NoiseLayer, number][]) {
    if (v > 0) layers[l] = v
    else delete layers[l]
  }
  return { ...mixer, layers, master: o.master ?? mixer.master }
}

const change = (fn: (m: SoundMixer) => SoundMixer): Promise<void> =>
  replaceMixer(fn).then(() => undefined)

/** The stored mixer as last seen by `pruneOverlay`, to settle writes that change nothing. */
let lastStored: SoundMixer | undefined

/**
 * Drops overlay entries the stored mixer now shows (a missing layer equals 0). Call it when the stored
 * row changes: the overlay holds until then, so the mix never falls back to an old value in between.
 */
export function pruneOverlay(stored: SoundMixer): void {
  lastStored = stored
  const layers = { ...overlay.layers }
  for (const l of Object.keys(layers) as NoiseLayer[])
    if ((stored.layers[l] ?? 0) === layers[l]) delete layers[l]
  const master = overlay.master === stored.master ? undefined : overlay.master
  if (
    master === overlay.master &&
    Object.keys(layers).length === Object.keys(overlay.layers).length
  )
    return
  setOverlay(Object.keys(layers).length === 0 && master === undefined ? EMPTY : { layers, master })
}

/** Forgets overlay entries that equal `sent` (the write for them failed, or is known to be stored). */
function dropSent(sent: MixOverlay): void {
  const layers = { ...overlay.layers }
  for (const l of Object.keys(sent.layers) as NoiseLayer[])
    if (layers[l] === sent.layers[l]) delete layers[l]
  const master = overlay.master === sent.master ? undefined : overlay.master
  setOverlay(Object.keys(layers).length === 0 && master === undefined ? EMPTY : { layers, master })
}

async function flush(): Promise<void> {
  timer = undefined
  const sent = overlay
  try {
    await change((m) => withOverlay(m, sent))
    if (lastStored) pruneOverlay(lastStored) // a write that changed nothing never updates the row
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
  schedule({ ...overlay, layers: { ...overlay.layers, [layer]: clamp01(volume) } })
}

export function setMaster(volume: number): void {
  schedule({ ...overlay, master: clamp01(volume) })
}

export const setNoiseColor = (color: NoiseColor): Promise<void> =>
  change((m) => ({ ...m, noiseColor: color }))

export const setWithFocus = (on: boolean): Promise<void> => change((m) => ({ ...m, withFocus: on }))

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
  for (const l of Object.keys(before) as NoiseLayer[]) off[l] = 0
  const next = { ...sent, layers: off }
  setOverlay(next)
  try {
    await change((m) => ({ ...m, layers: {}, master: sent.master ?? m.master }))
    if (lastStored) pruneOverlay(lastStored)
  } catch (e) {
    dropSent(next)
    throw e
  }
  return { undo: () => change((m) => ({ ...m, layers: { ...before } })) }
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
  lastStored = undefined
  clearTimeout(timer)
  timer = undefined
  setOverlay(EMPTY)
}
