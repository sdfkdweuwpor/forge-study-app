import type { Theme } from './types'

/** The nine Notion-style hues (same names as the app's tag colours). */
export const HUES = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const
export type Hue = (typeof HUES)[number]

/** `bg` for walls and light faces, `text` for roofs and dark details. */
export interface HueColors {
  bg: string
  text: string
}

export interface WorldPalette {
  hues: Record<Hue, HueColors>
  /** The two grass checker colours. */
  grassA: string
  grassB: string
  /** The soft edge under the ground where the world ends. */
  soil: string
  road: string
  roadDash: string
  /** Gold accent: landmark spires and castle flags only. */
  gold: string
  windowLit: string
  water: string
  waterLight: string
}

const LIGHT: WorldPalette = {
  hues: {
    gray: { bg: '#e9e8e5', text: '#64615c' },
    brown: { bg: '#f5e4db', text: '#7a5a49' },
    orange: { bg: '#ffe2ca', text: '#8b541c' },
    yellow: { bg: '#f6e7bf', text: '#7f5b1d' },
    green: { bg: '#d8efdc', text: '#396d46' },
    blue: { bg: '#d5ecfb', text: '#24678d' },
    purple: { bg: '#ede2fb', text: '#715391' },
    pink: { bg: '#fcdfea', text: '#91496b' },
    red: { bg: '#ffdedb', text: '#9a4541' },
  },
  grassA: '#cfe3c4',
  grassB: '#c4dbb8',
  soil: '#c8b79c',
  road: '#d9d6cf',
  roadDash: '#f4f1ea',
  gold: '#be8226',
  windowLit: '#f2c66d',
  water: '#9ccbe8',
  waterLight: '#ddf1fb',
}

const DARK: WorldPalette = {
  hues: {
    gray: { bg: '#363533', text: '#adaba7' },
    brown: { bg: '#41322a', text: '#c0a699' },
    orange: { bg: '#482f18', text: '#cda27d' },
    yellow: { bg: '#423305', text: '#c2a77d' },
    green: { bg: '#263b2a', text: '#8fb696' },
    blue: { bg: '#233846', text: '#84b1cf' },
    purple: { bg: '#3a3046', text: '#b6a1d1' },
    pink: { bg: '#462d37', text: '#d399b2' },
    red: { bg: '#4a2c29', text: '#dc9892' },
  },
  grassA: '#23302a',
  grassB: '#1f2b25',
  soil: '#2c3029',
  road: '#3a3936',
  roadDash: '#55534f',
  gold: '#be8226',
  windowLit: '#f2c66d',
  water: '#4f7f9f',
  waterLight: '#8fbad3',
}

export function paletteFor(theme: Theme): WorldPalette {
  return theme === 'dark' ? DARK : LIGHT
}

// ─── Colour maths ───────────────────────────────────────────────────────────────────────────

const HEX = /^#([0-9a-f]{6})$/i

export function isHex(value: string): boolean {
  return HEX.test(value)
}

function parseHex(hex: string): [number, number, number] {
  const m = HEX.exec(hex)
  if (!m?.[1]) throw new Error(`Not a #rrggbb colour: ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** RGB 0-255 to HSL: h in degrees 0-360, s and l in 0-100. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l * 100]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return [(h * 60 + 360) % 360, s * 100, l * 100]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = ln - c / 2
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/**
 * Lightens (`pct > 0`) or darkens (`pct < 0`) a `#rrggbb` colour by `pct` points of HSL lightness,
 * clamped to 0-100. Hue and saturation are kept. Always returns lower-case `#rrggbb`.
 */
export function shade(hex: string, pct: number): string {
  const [r, g, b] = parseHex(hex)
  const [h, s, l] = rgbToHsl(r, g, b)
  const next = Math.max(0, Math.min(100, l + pct))
  const [nr, ng, nb] = hslToRgb(h, s, next)
  return toHex(nr, ng, nb)
}

/** Linear mix of two `#rrggbb` colours: `t = 0` is `a`, `t = 1` is `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t))
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  return toHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k)
}

/** `#rrggbb` and an alpha as an `rgba()` string, for translucent glows. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}
