/**
 * Pressing Play from anywhere (panel, mini player, shortcut, palette). `unlockAudio` is a static import
 * and runs before the first `await`, while the click or key press still counts as a gesture. Pressing
 * Play also turns the sounds switch on (SoundHost respects it).
 */
import { getSettings, replaceMixer, updateSettings } from '@/db/repos/settings'
import type { NoiseLayer } from '@/db/types'
import { unlockAudio } from '@/lib/audio/engine'

/** Plays or pauses. Pass the state the caller shows when it has one; otherwise it is read. */
export async function togglePlay(playing?: boolean): Promise<void> {
  if (playing !== true) void unlockAudio()
  const now = playing ?? (await getSettings()).sound.device?.playing ?? false
  await updateSettings({ sound: { ...(now ? {} : { enabled: true }), device: { playing: !now } } })
}

/** Puts one layer at `volume` and plays (the "Sound: Rain" commands). */
export async function playLayer(layer: NoiseLayer, volume: number): Promise<void> {
  void unlockAudio()
  await replaceMixer((m) => ({ ...m, layers: { ...m.layers, [layer]: volume } }))
  await updateSettings({ sound: { enabled: true, device: { playing: true } } })
}
