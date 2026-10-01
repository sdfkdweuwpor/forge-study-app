/**
 * The musical and random-event parts of the sounds, as plain data: which chime notes to play, and
 * when the next rain drop or café clink falls. Pure and seeded, so it is testable; the graph builders
 * turn these descriptions into oscillators.
 */
import type { BellEnvelope } from './envelope'
import { volumeToGain } from './envelope'
import type { Rng } from './noise'

// ─── Chime ──────────────────────────────────────────────────────────────────

/** One bell strike: a fundamental plus a couple of overtones, each with its own gain and decay. */
export interface ChimeNote {
  /** Fundamental in Hz. */
  freq: number
  /** Seconds after the chime begins. */
  start: number
  /** Seconds until the note has fully died away. */
  duration: number
  /** Peak gain of the fundamental (already scaled by the volume). */
  gain: number
}

export interface ChimePartial {
  /** Multiple of the fundamental. */
  ratio: number
  /** Relative level (fundamental = 1). */
  gain: number
  /** Decay time constant relative to the note's `tau`; overtones die faster, which is what makes it soft. */
  decay: number
}

/** A soft bell: a strong fundamental, a quiet octave and a faint twelfth that fades quickest. */
export const CHIME_PARTIALS: readonly ChimePartial[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2, gain: 0.22, decay: 0.55 },
  { ratio: 3.01, gain: 0.07, decay: 0.3 },
]

/** C5, E5, G5: a rising major triad. Friendly, and it never sounds like an alarm. */
const CHIME_PITCHES: readonly { freq: number; start: number; duration: number }[] = [
  { freq: 523.25, start: 0, duration: 1.0 },
  { freq: 659.25, start: 0.17, duration: 0.95 },
  { freq: 783.99, start: 0.36, duration: 0.85 },
]

/** Peak gain of a chime note at full volume, low enough that three overlapping notes stay well under 0 dBFS. */
const CHIME_LEVEL = 0.3

/** Seconds of the attack ramp: fast enough to sound struck, slow enough not to click. */
export const CHIME_ATTACK = 0.008

/** The notes of the chime at `volume` (0..1). Empty when muted. */
export function chimeSchedule(volume: number): ChimeNote[] {
  const gain = CHIME_LEVEL * volumeToGain(volume)
  if (gain <= 0) return []
  return CHIME_PITCHES.map((p) => ({ ...p, gain }))
}

/** The envelope of one partial of a note. */
export function partialEnvelope(note: ChimeNote, partial: ChimePartial): BellEnvelope {
  return {
    attack: CHIME_ATTACK,
    tau: (note.duration / 4.5) * partial.decay,
    duration: note.duration,
  }
}

/** Seconds from the start of the chime until the last note has died away. */
export function chimeLength(notes: readonly ChimeNote[]): number {
  return notes.reduce((end, n) => Math.max(end, n.start + n.duration), 0)
}

// ─── Random events (rain drops, café clinks) ────────────────────────────────

/**
 * The time of the next event of a Poisson process with `ratePerSec` events a second, after `after`.
 * Gaps are exponential, so events cluster and lull the way real drops do. `minGap` keeps two events
 * from stacking on top of each other.
 */
export function nextEventTime(rng: Rng, after: number, ratePerSec: number, minGap = 0): number {
  const u = Math.min(0.999999, Math.max(0, rng()))
  const gap = -Math.log(1 - u) / Math.max(1e-6, ratePerSec)
  return after + Math.max(minGap, gap)
}

export interface Droplet {
  /** Start pitch in Hz; the drop then glides down a little. */
  freq: number
  /** Peak gain, tiny: drops sit on top of the wash. */
  gain: number
  /** Seconds to fade out. */
  decay: number
}

export function dropletEvent(rng: Rng): Droplet {
  return {
    freq: 1800 + rng() * 3400,
    gain: 0.02 + rng() * 0.05,
    decay: 0.015 + rng() * 0.035,
  }
}

export interface Clink {
  /** Fundamental in Hz. A second partial sits at `CLINK_OVERTONE` times this. */
  freq: number
  gain: number
  decay: number
}

/** Ratio of the second partial of a small ceramic cup, which is what makes a clink sound like china rather than a beep. */
export const CLINK_OVERTONE = 2.76

export function clinkEvent(rng: Rng): Clink {
  return {
    freq: 2300 + rng() * 1900,
    gain: 0.01 + rng() * 0.02,
    decay: 0.12 + rng() * 0.22,
  }
}
