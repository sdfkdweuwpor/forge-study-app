/**
 * Pure envelope and level math for the audio module. Nothing here touches Web Audio, so it is unit
 * tested in Node; `engine.ts`, `chime.ts` and `mixer.ts` are thin wrappers that feed these numbers
 * to AudioParams.
 */

/** Clamps to 0..1; NaN and non-finite input become 0. */
export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
}

/**
 * A 0..1 volume setting to a linear gain. The square taper matches how loudness is heard, so the
 * lower half of a slider is not almost identical to the top half. 0 is silent, 1 is unity.
 */
export function volumeToGain(volume: number): number {
  const v = clamp01(volume)
  return v * v
}

/** 0 → 0, 1 → 1, with zero slope at both ends. */
export function smoothstep(x: number): number {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

/** Equal-power crossfade weights at position `x` (0..1): `[fadingIn, fadingOut]`. Their squares sum to 1. */
export function equalPowerPair(x: number): readonly [number, number] {
  const a = (clamp01(x) * Math.PI) / 2
  return [Math.sin(a), Math.cos(a)]
}

/**
 * A gain fade for `AudioParam.setTargetAtTime`. That call approaches its target exponentially, so
 * the time constant is a fifth of the fade: the level is within 1% of the target at the end.
 */
export function fadeTimeConstant(fadeMs: number): number {
  return Math.max(0.005, fadeMs / 5000)
}

/** How long to wait before tearing a faded-out graph down: past the point the fade is inaudible. */
export function fadeStopDelayMs(fadeMs: number): number {
  return Math.max(0, fadeMs) * 1.3 + 60
}

export interface BellEnvelope {
  /** Seconds to rise from silence to the peak (a quarter sine, so there is no click). */
  attack: number
  /** Exponential decay time constant in seconds. */
  tau: number
  /** Total length in seconds. The last `release` seconds are tapered so the curve ends at exactly 0. */
  duration: number
  /** Seconds of final taper; defaults to 60 ms or a fifth of the duration, whichever is smaller. */
  release?: number
}

/** Gain (0..1) of a struck-bell envelope at time `t` seconds after the note starts. */
export function bellGain(t: number, env: BellEnvelope): number {
  if (t <= 0 || t >= env.duration) return 0
  const release = env.release ?? Math.min(0.06, env.duration * 0.2)
  const rise = env.attack > 0 && t < env.attack ? Math.sin((t / env.attack) * (Math.PI / 2)) : 1
  const decay = Math.exp(-Math.max(0, t - env.attack) / env.tau)
  const taper = t > env.duration - release ? (env.duration - t) / release : 1
  return rise * decay * taper
}

/** The bell envelope sampled into a curve for `setValueCurveAtTime`, scaled to `peak`. */
export function bellCurve(env: BellEnvelope, peak = 1, points = 96): Float32Array {
  const n = Math.max(2, Math.floor(points))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = peak * bellGain((i / (n - 1)) * env.duration, env)
  return out
}
