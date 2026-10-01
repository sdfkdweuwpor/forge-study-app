import type { LofiStyle } from '@/db/types'

export type Instrument = 'keys' | 'pad' | 'bass' | 'pluck' | 'piano'

export interface StyleDef {
  bpm: [number, number]
  swing: number
  key: { root: number; scale: 'minor' | 'major' | 'dorian' | 'lydian' }
  /** Scale degrees (0 = tonic) of the chord root, one per bar. */
  progressions: number[][]
  drums: 'boombap' | 'house' | 'gated' | 'brush' | 'none'
  instruments: Instrument[]
  texture: ('vinyl' | 'tape' | 'rain' | 'city')[]
}

export const STYLES: Record<LofiStyle, StyleDef> = {
  classic: {
    bpm: [70, 84],
    swing: 0.3,
    key: { root: 50, scale: 'minor' },
    progressions: [
      [0, 5, 2, 6],
      [0, 3, 5, 4],
      [5, 6, 0, 0],
      [0, 2, 5, 6],
    ],
    drums: 'boombap',
    instruments: ['keys', 'bass', 'pluck'],
    texture: ['vinyl'],
  },
  rainy: {
    bpm: [66, 76],
    swing: 0.25,
    key: { root: 52, scale: 'dorian' },
    progressions: [
      [0, 3, 0, 4],
      [1, 4, 0, 0],
      [0, 5, 3, 4],
    ],
    drums: 'brush',
    instruments: ['keys', 'pad', 'bass'],
    texture: ['rain', 'vinyl'],
  },
  coffee: {
    bpm: [80, 90],
    swing: 0.35,
    key: { root: 48, scale: 'major' },
    progressions: [
      [1, 4, 0, 5],
      [0, 5, 1, 4],
      [2, 5, 1, 4],
      [0, 2, 1, 4],
    ],
    drums: 'boombap',
    instruments: ['keys', 'bass', 'pluck'],
    texture: ['vinyl', 'tape'],
  },
  tokyo: {
    bpm: [84, 96],
    swing: 0.15,
    key: { root: 53, scale: 'major' },
    progressions: [
      [3, 4, 2, 5],
      [0, 2, 3, 4],
      [3, 2, 1, 4],
      [1, 4, 0, 5],
    ],
    drums: 'boombap',
    instruments: ['keys', 'pad', 'bass', 'pluck'],
    texture: ['city', 'tape'],
  },
  synthwave: {
    bpm: [90, 104],
    swing: 0,
    key: { root: 45, scale: 'minor' },
    progressions: [
      [0, 5, 2, 6],
      [0, 6, 5, 6],
      [0, 2, 6, 5],
    ],
    drums: 'gated',
    instruments: ['pad', 'bass', 'pluck'],
    texture: ['tape'],
  },
  electronic: {
    bpm: [112, 122],
    swing: 0,
    key: { root: 50, scale: 'minor' },
    progressions: [
      [0, 0, 5, 6],
      [0, 3, 5, 4],
      [0, 6, 5, 6],
    ],
    drums: 'house',
    instruments: ['keys', 'bass', 'pluck'],
    texture: [],
  },
  jazzhop: {
    bpm: [82, 92],
    swing: 0.4,
    key: { root: 50, scale: 'dorian' },
    progressions: [
      [1, 4, 0, 0],
      [0, 5, 1, 4],
      [2, 5, 1, 4],
      [0, 3, 1, 4],
    ],
    drums: 'boombap',
    instruments: ['keys', 'bass', 'piano'],
    texture: ['vinyl'],
  },
  piano: {
    bpm: [60, 70],
    swing: 0.1,
    key: { root: 48, scale: 'major' },
    progressions: [
      [0, 4, 5, 3],
      [0, 5, 3, 4],
      [5, 3, 0, 4],
    ],
    drums: 'none',
    instruments: ['piano', 'bass'],
    texture: ['tape'],
  },
  chillhop: {
    bpm: [92, 100],
    swing: 0.3,
    key: { root: 48, scale: 'major' },
    progressions: [
      [0, 5, 3, 4],
      [3, 4, 2, 5],
      [0, 2, 3, 4],
      [1, 4, 0, 5],
    ],
    drums: 'boombap',
    instruments: ['keys', 'bass', 'pluck'],
    texture: ['vinyl'],
  },
  space: {
    bpm: [50, 60],
    swing: 0,
    key: { root: 48, scale: 'lydian' },
    progressions: [
      [0, 1, 0, 4],
      [0, 4, 1, 0],
      [0, 2, 1, 0],
    ],
    drums: 'none',
    instruments: ['pad', 'pluck'],
    texture: ['tape'],
  },
}
