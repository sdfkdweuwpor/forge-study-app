/** Look-ahead lofi player: a 100 ms timer schedules whole bars a little ahead of the audio clock. */
import type { LofiStyle } from '@/db/types'
import { fadeStopDelayMs, fadeTimeConstant } from '../envelope'
import { gain, stopAll } from '../graph'
import { createComposer, type NoteEvent } from './composer'
import {
  playBass,
  playHat,
  playKeys,
  playKick,
  playPad,
  playPiano,
  playPluck,
  playRim,
  playSnare,
  startTexture,
  type Source,
} from './instruments'
import { STYLES } from './styles'

export interface MusicHandle {
  stop(fadeMs: number): void
}

const TICK_MS = 100
const AHEAD_BARS = 2
const FADE_IN_MS = 2000
const MAX_VOICES = 32
const HEADROOM = 0.5

const DRUMS = { kick: playKick, snare: playSnare, hat: playHat, rim: playRim }
const MELODIC = { keys: playKeys, pad: playPad, bass: playBass, pluck: playPluck, piano: playPiano }

export function startMusic(ctx: AudioContext, out: AudioNode, style: LofiStyle): MusicHandle {
  const bus = gain(ctx, 0)
  bus.connect(out)
  bus.gain.setTargetAtTime(HEADROOM, ctx.currentTime, fadeTimeConstant(FADE_IN_MS))
  const textures = STYLES[style].texture.map((k) => startTexture(ctx, bus, k))

  const composer = createComposer(style, Math.floor(Math.random() * 0xffffffff))
  const spb = 60 / composer.bpm
  const barDur = spb * 4
  let next = ctx.currentTime + 0.1
  /** Voices scheduled and not yet over; the cap counts those sounding at a note's time. */
  let live: { sources: Source[]; start: number; until: number }[] = []

  const play = (ev: NoteEvent, time: number) => {
    const sources =
      'drum' in ev ? DRUMS[ev.drum](ctx, bus, time, ev) : MELODIC[ev.inst](ctx, bus, time, ev)
    live.push({ sources, start: time, until: time + ('dur' in ev ? ev.dur : 0.4) + 1 })
  }

  const tick = () => {
    const now = ctx.currentTime
    live = live.filter((v) => v.until > now)
    // Throttled tab: drop the missed bars and resume on the next bar boundary after now.
    if (next < now) next += Math.ceil((now - next) / barDur) * barDur
    while (next < now + AHEAD_BARS * barDur) {
      // Loudest first, so the voice cap drops the quietest notes.
      const events = composer.nextBar().sort((a, b) => b.vel - a.vel)
      for (const ev of events) {
        const at = next + ev.at * spb
        if (live.filter((v) => v.start <= at && v.until > at).length >= MAX_VOICES) continue
        play(ev, at)
      }
      next += barDur
    }
  }
  tick()
  const timer = setInterval(tick, TICK_MS)

  return {
    stop(fadeMs) {
      clearInterval(timer)
      const now = ctx.currentTime
      bus.gain.cancelScheduledValues(now)
      bus.gain.setValueAtTime(bus.gain.value, now)
      bus.gain.setTargetAtTime(0, now, fadeTimeConstant(fadeMs))
      setTimeout(() => {
        stopAll(live.flatMap((v) => v.sources))
        live = []
        for (const t of textures) t.stop()
        bus.disconnect()
      }, fadeStopDelayMs(fadeMs))
    },
  }
}
