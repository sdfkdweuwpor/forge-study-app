/**
 * Plays the sound mix on every page, from one tab. It sits in `global.overlays` (renders nothing). The
 * mix plays while this device's Play switch is on, or "start with focus" is on and a focus session runs;
 * only the tab that wins the election (`ambientElection`) makes sound. If the browser still blocks audio
 * (no click yet), nothing throws: `armAudioUnlock` starts it on the next click or key press.
 */
import { useEffect, useState } from 'react'
import { recordError } from '@/app/reportError'
import { browserElection, electAmbientOwner } from '../ambientElection'
import { useTimer } from '../useTimer'
import { useMixer, useSoundDevice } from './hooks'
import { wantsSound } from './mixActions'

export function SoundHost(): null {
  const mix = useMixer()
  const playing = useSoundDevice()?.playing ?? false
  const { session } = useTimer()
  const wants = wantsSound(mix, playing, session)

  const [owner, setOwner] = useState(false)
  useEffect(() => {
    if (!wants) return undefined
    return electAmbientOwner(browserElection(), setOwner)
  }, [wants])
  const play = wants && owner

  useEffect(() => {
    if (!play || !mix) return
    void import('@/lib/audio')
      .then((audio) => {
        audio.armAudioUnlock()
        return audio.applyMix(mix, { onLayerError: (_l, e) => recordError(e, 'sound.layer') })
      })
      .catch((e: unknown) => recordError(e, 'sound.apply'))
  }, [play, mix])

  useEffect(() => {
    if (!play) return undefined
    return () => {
      void import('@/lib/audio').then((audio) => audio.stopMix()).catch(() => undefined)
    }
  }, [play])

  return null
}
