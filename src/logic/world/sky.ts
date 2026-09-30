import { mixHex } from './palette'
import type { Theme } from './types'

export type SkyPhase = 'night' | 'dawn' | 'day' | 'dusk'

export interface Sky {
  phase: SkyPhase
  /** Gradient stops, top of the canvas first. `#rrggbb`. */
  top: string
  bottom: string
  /** 0 = full day, 1 = full night. */
  ambient: number
  /** Windows glow when it is more night than day. */
  windowsLit: boolean
}

interface Stop {
  top: string
  bottom: string
}

interface SkyColours {
  day: Stop
  mid: Stop
  night: Stop
}

/** Calm colours, no neon. The dark theme uses deeper variants of each. */
const COLOURS: Record<Theme, SkyColours> = {
  light: {
    day: { top: '#dcebf5', bottom: '#f4f1ea' },
    mid: { top: '#e8c9a8', bottom: '#f2e3d0' },
    night: { top: '#141a26', bottom: '#2a2f3a' },
  },
  dark: {
    day: { top: '#a9c3d6', bottom: '#cfcbc1' },
    mid: { top: '#b99a7c', bottom: '#c9b8a2' },
    night: { top: '#0c1119', bottom: '#1c202a' },
  },
}

/** Phase boundaries, in minutes after midnight. */
export const DAWN_START = 5 * 60
export const DAY_START = 7 * 60 + 30
export const DUSK_START = 18 * 60
export const NIGHT_START = 20 * 60 + 30

const MINUTES_PER_DAY = 24 * 60

function blend(a: Stop, b: Stop, t: number): Stop {
  return { top: mixHex(a.top, b.top, t), bottom: mixHex(a.bottom, b.bottom, t) }
}

/** day -> mid -> night, for `ambient` 0..1 (the middle stop sits at 0.5). */
function atAmbient(c: SkyColours, ambient: number): Stop {
  return ambient <= 0.5
    ? blend(c.day, c.mid, ambient * 2)
    : blend(c.mid, c.night, (ambient - 0.5) * 2)
}

/**
 * The sky at a time of day. Night runs 20:30-05:00, dawn 05:00-07:30, day 07:30-18:00 and dusk
 * 18:00-20:30; colours interpolate linearly through dawn and dusk. `minutes` is minutes after local
 * midnight (any number; it wraps).
 */
export function skyAt(minutes: number, theme: Theme): Sky {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const colours = COLOURS[theme]
  let phase: SkyPhase
  let ambient: number
  if (m >= NIGHT_START || m < DAWN_START) {
    phase = 'night'
    ambient = 1
  } else if (m < DAY_START) {
    phase = 'dawn'
    ambient = 1 - (m - DAWN_START) / (DAY_START - DAWN_START)
  } else if (m < DUSK_START) {
    phase = 'day'
    ambient = 0
  } else {
    phase = 'dusk'
    ambient = (m - DUSK_START) / (NIGHT_START - DUSK_START)
  }
  const stop = atAmbient(colours, ambient)
  return { phase, top: stop.top, bottom: stop.bottom, ambient, windowsLit: ambient > 0.5 }
}
