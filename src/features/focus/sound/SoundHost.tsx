/**
 * Plays the sound mix on every page, from one tab. It sits in `global.overlays` (renders nothing) and
 * loads lazily. The mix plays while the sounds switch is on and this device's Play switch is on, or
 * "start with focus" is on and a focus session runs; only the tab that wins the election
 * (`ambientElection`) makes sound. If the browser still blocks audio (no click yet), nothing throws:
 * `armAudioUnlock` starts it on the next click or key press.
 */
import { useEffect, useState } from 'react'
import { browserElection, electAmbientOwner } from '../ambientElection'
import { useMixer, useWantsSound } from './hooks'
import { playMix, stopPlaying } from './playMix'

export function SoundHost(): null {
  const mix = useMixer()
  const wants = useWantsSound()

  const [owner, setOwner] = useState(false)
  useEffect(() => {
    if (!wants) return undefined
    const stop = electAmbientOwner(browserElection(), setOwner)
    return () => {
      stop()
      setOwner(false)
    }
  }, [wants])
  const play = wants && owner

  useEffect(() => {
    if (play && mix) void playMix(mix)
  }, [play, mix])

  useEffect(() => {
    if (!play) return undefined
    return () => void stopPlaying()
  }, [play])

  return null
}
