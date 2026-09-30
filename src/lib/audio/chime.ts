import { bellCurve } from './envelope'
import { CHIME_PARTIALS, chimeSchedule, partialEnvelope } from './schedule'
import { getContext, outputNode, resumeContext } from './engine'

/** Level used when the caller does not pass a volume. Matches the default in settings. */
export const DEFAULT_CHIME_VOLUME = 0.6

/**
 * A soft three-note bell (C5, E5, G5), about 1.2 seconds, made from sine oscillators with a struck
 * envelope. Resolves `true` as soon as the chime is sounding (it plays out by itself) and `false` when
 * it stays silent, so callers can tell whether something was heard (a notification should then not add
 * its own sound). It never rejects and never waits on a timer to report the outcome. If the browser is
 * still blocking audio (no click or key press yet on this page) it stays silent and resolves `false` at
 * once, rather than queueing a chime that would go off at some later, surprising moment.
 */
export async function playChime(volume: number = DEFAULT_CHIME_VOLUME): Promise<boolean> {
  const notes = chimeSchedule(volume)
  if (notes.length === 0) return false
  const ctx = getContext()
  if (!ctx) return false
  if (!(await resumeContext(ctx, 400))) return false

  const out = outputNode(ctx)
  const t0 = ctx.currentTime + 0.04
  for (const note of notes) {
    for (const partial of CHIME_PARTIALS) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = note.freq * partial.ratio
      const env = ctx.createGain()
      env.gain.value = 0
      const start = t0 + note.start
      env.gain.setValueCurveAtTime(
        bellCurve(partialEnvelope(note, partial), note.gain * partial.gain),
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
