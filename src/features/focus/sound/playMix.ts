/** The audio calls behind `SoundHost`. The audio code loads here, on first use, never with the app. */
import { recordError } from '@/app/reportError'
import type { Mix } from '@/db/types'

/**
 * Starts or updates the mix. Arms the unlock first: if the browser still blocks audio (no click yet)
 * the next click or key press starts it. Never throws; a failure is recorded.
 */
export async function playMix(mix: Mix): Promise<void> {
  try {
    const audio = await import('@/lib/audio')
    audio.armAudioUnlock()
    await audio.applyMix(mix, {
      onLayerError: (_layer, e) => recordError(e, 'sound.layer'),
      onMusicError: (_style, e) => recordError(e, 'sound.music'),
    })
  } catch (e) {
    recordError(e, 'sound.apply')
  }
}

export async function stopPlaying(): Promise<void> {
  try {
    const audio = await import('@/lib/audio')
    await audio.stopMix()
  } catch (e) {
    recordError(e, 'sound.stop')
  }
}
