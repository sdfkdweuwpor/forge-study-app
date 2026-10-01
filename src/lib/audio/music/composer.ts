import { createRng } from '../noise'
import { STYLES, type Instrument } from './styles'
import type { LofiStyle } from '@/db/types'

export type NoteEvent =
  | { at: number; dur: number; midi: number; vel: number; inst: Instrument }
  | { at: number; drum: 'kick' | 'snare' | 'hat' | 'rim'; vel: number }

/** Semitone offsets of each scale from its root. */
export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
}

const BARS_PER_PHRASE = 8

export function createComposer(
  style: LofiStyle,
  seed: number,
): { bpm: number; nextBar(): NoteEvent[] } {
  const def = STYLES[style]
  const rng = createRng(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1))
  const pick = <T>(a: readonly T[]) => a[int(0, a.length - 1)] as T
  const vel = () => 0.3 + rng() * 0.4
  const bpm = int(def.bpm[0], def.bpm[1])
  const scale = SCALES[def.key.scale]
  /** Scale degree (may exceed 6, wraps into higher octaves) to MIDI. */
  const deg = (d: number) => def.key.root + 12 * Math.floor(d / 7) + (scale[((d % 7) + 7) % 7] ?? 0)
  const has = (i: Instrument) => def.instruments.includes(i)
  const melodyInst = (['piano', 'pluck', 'keys'] as const).find(has)

  let bar = 0
  let phrase: number[] = []

  const newPhrase = () => {
    const p = pick(def.progressions)
    phrase = Array.from({ length: BARS_PER_PHRASE }, (_, i) => p[i % p.length] ?? 0)
    phrase[int(1, BARS_PER_PHRASE - 1)] = int(0, 6) // one substitution per phrase
  }

  const drums = (): NoteEvent[] => {
    const out: NoteEvent[] = []
    const d = (at: number, drum: 'kick' | 'snare' | 'hat' | 'rim', v: number) =>
      out.push({ at, drum, vel: Math.min(1, v) })
    const eighth = (i: number) => i * 0.5 + (i % 2 ? def.swing * 0.25 : 0)
    switch (def.drums) {
      case 'house':
        for (let b = 0; b < 4; b++) d(b, 'kick', 0.6 + rng() * 0.1)
        for (let b = 0; b < 4; b++) d(b + 0.5, 'hat', 0.25 + rng() * 0.15)
        d(1, 'snare', 0.4 + rng() * 0.1)
        d(3, 'snare', 0.4 + rng() * 0.1)
        break
      case 'brush':
        d(1, 'rim', 0.25 + rng() * 0.15)
        d(3, 'rim', 0.25 + rng() * 0.15)
        for (let i = 0; i < 8; i++) if (rng() < 0.6) d(eighth(i), 'hat', 0.15 + rng() * 0.15)
        if (rng() < 0.4) d(2.5, 'kick', 0.3 + rng() * 0.1)
        d(0, 'kick', 0.4 + rng() * 0.1)
        break
      case 'gated':
        d(0, 'kick', 0.6)
        d(2, 'kick', 0.55)
        d(1, 'snare', 0.55 + rng() * 0.1)
        d(3, 'snare', 0.55 + rng() * 0.1)
        for (let i = 0; i < 8; i++) d(eighth(i), 'hat', 0.2 + rng() * 0.15)
        if (rng() < 0.5) d(3.5, 'kick', 0.4)
        break
      case 'boombap':
        d(0, 'kick', 0.6 + rng() * 0.1)
        d(rng() < 0.5 ? 1.5 : 2.5, 'kick', 0.45 + rng() * 0.1)
        if (rng() < 0.4) d(eighth(5), 'kick', 0.4)
        d(1, 'snare', 0.5 + rng() * 0.1)
        d(3, 'snare', 0.5 + rng() * 0.1)
        for (let i = 0; i < 8; i++) if (rng() < 0.85) d(eighth(i), 'hat', 0.15 + rng() * 0.2)
        break
      case 'none':
        break
    }
    return out
  }

  return {
    bpm,
    nextBar() {
      if (bar % BARS_PER_PHRASE === 0) newPhrase()
      const root = phrase[bar % BARS_PER_PHRASE] ?? 0
      bar++
      const out: NoteEvent[] = []
      const chord = [0, 2, 4, 6].map((o) => deg(root + o))
      const fold = (m: number) => 36 + ((((m - 36) % 12) + 12) % 12) // bass window MIDI 36-47
      const lowRoot = fold(deg(root))
      if (has('pad')) {
        for (const midi of chord.slice(0, 3))
          out.push({ at: 0, dur: 4, midi, vel: 0.25 + rng() * 0.15, inst: 'pad' })
      }
      if (has('keys')) {
        const stabs = def.swing ? [0, 1.5, 2.5] : [0, 2]
        for (const at of stabs) {
          if (at && rng() < 0.4) continue
          for (const midi of chord)
            out.push({ at, dur: at ? 1 : 1.5, midi, vel: vel(), inst: 'keys' })
        }
      }
      if (has('bass')) {
        out.push({ at: 0, dur: 1.5, midi: lowRoot, vel: 0.5 + rng() * 0.2, inst: 'bass' })
        if (rng() < 0.7)
          out.push({
            at: 2,
            dur: 1.5,
            midi: rng() < 0.7 ? lowRoot : fold(deg(root + 4)),
            vel: 0.4 + rng() * 0.2,
            inst: 'bass',
          })
      }
      if (def.drums === 'none' && has('piano')) {
        // sparse arpeggio under the melody
        chord.forEach((midi, i) => {
          if (rng() < 0.7)
            out.push({ at: i, dur: 1.5, midi, vel: 0.3 + rng() * 0.2, inst: 'piano' })
        })
      }
      if (melodyInst && rng() < 0.5) {
        const slots = new Set<number>()
        for (let n = int(2, 4); n > 0; n--) slots.add(int(0, 7) * 0.5)
        for (const at of [...slots].sort((a, b) => a - b)) {
          out.push({
            at,
            dur: pick([0.5, 1, 1.5]),
            midi: deg(root + int(0, 7)),
            vel: vel(),
            inst: melodyInst,
          })
        }
      }
      return [...out, ...drums()]
    },
  }
}
