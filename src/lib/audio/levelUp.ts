import { bellCurve, volumeToGain, type BellEnvelope } from './envelope'
import { getContext, outputNode, resumeContext } from './engine'

/** Level used when the caller does not pass a volume. Matches the default in settings. */
export const DEFAULT_LEVEL_UP_VOLUME = 0.6

export interface LevelUpNote {
  /** Fundamental in Hz. */
  freq: number
  /** Seconds after the sound begins. */
  start: number
  /** Seconds until the note has fully died away. */
  duration: number
  /** Peak gain of the fundamental (already scaled by the volume). */
  gain: number
}

export interface LevelUpPartial {
  /** Multiple of the fundamental. */
  ratio: number
  /** Relative level (fundamental = 1). */
  gain: number
  /** Decay time constant relative to the note's `tau`. */
  decay: number
}

/** Warmer than the chime: a full fundamental, a soft octave and hardly any shimmer above it. */
export const LEVEL_UP_PARTIALS: readonly LevelUpPartial[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2, gain: 0.3, decay: 0.6 },
  { ratio: 3.01, gain: 0.04, decay: 0.25 },
]

/**
 * G4, C5, E5 (a C major arpeggio in second inversion): it climbs and lands on the third, so it sounds
 * glad and a little open rather than finished. The last note rings out.
 */
const PITCHES: readonly { freq: number; start: number; duration: number }[] = [
  { freq: 392.0, start: 0, duration: 0.8 },
  { freq: 523.25, start: 0.13, duration: 0.85 },
  { freq: 659.25, start: 0.27, duration: 1.15 },
]

/** Peak gain of one note at full volume; three overlapping notes stay well under 0 dBFS. */
const LEVEL_UP_GAIN = 0.28
const ATTACK = 0.012

/** The notes of the level-up sound at `volume` (0..1). Empty when muted. */
export function levelUpSchedule(volume: number): LevelUpNote[] {
  const gain = LEVEL_UP_GAIN * volumeToGain(volume)
  if (gain <= 0) return []
  return PITCHES.map((p) => ({ ...p, gain }))
}

/** The envelope of one partial of a note. */
export function levelUpEnvelope(note: LevelUpNote, partial: LevelUpPartial): BellEnvelope {
  return { attack: ATTACK, tau: (note.duration / 4) * partial.decay, duration: note.duration }
}

/** Seconds from the start until the last note has died away. */
export function levelUpLength(notes: readonly LevelUpNote[]): number {
  return notes.reduce((end, n) => Math.max(end, n.start + n.duration), 0)
}

/**
 * A warm, rising three-note arpeggio for the level-up moment, built like `playChime`: sine partials
 * with a struck envelope, through the shared limiter. Resolves `true` once it is sounding and `false`
 * when it stays silent (muted, unsupported, or the browser is still blocking audio: it is never queued
 * for later). It never rejects.
 */
export async function playLevelUp(volume: number = DEFAULT_LEVEL_UP_VOLUME): Promise<boolean> {
  const notes = levelUpSchedule(volume)
  if (notes.length === 0) return false
  const ctx = getContext()
  if (!ctx) return false
  if (!(await resumeContext(ctx, 400))) return false

  const out = outputNode(ctx)
  const t0 = ctx.currentTime + 0.04
  for (const note of notes) {
    for (const partial of LEVEL_UP_PARTIALS) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = note.freq * partial.ratio
      const env = ctx.createGain()
      env.gain.value = 0
      const start = t0 + note.start
      env.gain.setValueCurveAtTime(
        bellCurve(levelUpEnvelope(note, partial), note.gain * partial.gain),
        start,
        note.duration,
      )
      osc.connect(env).connect(out)
      osc.start(start)
      osc.stop(start + note.duration + 0.02)
    }
  }
  return true
}
