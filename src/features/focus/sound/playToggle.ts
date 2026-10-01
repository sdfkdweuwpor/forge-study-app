/**
 * Pressing Play from anywhere (panel, mini player, shortcut, palette). `unlockAudio` is a static import
 * and runs before the first `await`, while the click or key press still counts as a gesture; the rest
 * (`./mixActions`, with the mixer logic) loads on first use, not with the app.
 */
import type { NoiseLayer } from '@/db/types'
import { unlockAudio } from '@/lib/audio/engine'

const actions = () => import('./mixActions')

/** Plays or pauses. Pass what the caller shows as sounding (`useWantsSound`) when it has it. */
export async function togglePlay(sounding?: boolean): Promise<void> {
  if (sounding !== true) void unlockAudio()
  await (await actions()).toggleSound(sounding)
}

/** Puts one layer at `volume` and plays (the "Sound: Rain" commands). */
export async function playLayer(layer: NoiseLayer, volume: number): Promise<void> {
  void unlockAudio()
  await (await actions()).playLayer(layer, volume)
}
