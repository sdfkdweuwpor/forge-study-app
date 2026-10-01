/**
 * The level-up moment as pure functions of time (BRIEF §3.5): how visible the card is at each
 * millisecond, and where each confetti square is. The overlay only samples these on every animation
 * frame, so a test can check the whole moment without a browser, and a paused clock shows exactly one
 * frame of it. The moment is under 1.5 s; with reduced motion nothing moves (no confetti, no scale),
 * it only fades.
 */

/** The whole moment. BRIEF §3.5: under 1.5 s. */
export const LEVEL_UP_MS = 1400

const FADE_IN_MS = 200
const FADE_OUT_MS = 260
const REDUCED_FADE_IN_MS = 240
const REDUCED_FADE_OUT_MS = 300
/** The card starts a little smaller and settles to full size while it fades in. */
const SCALE_FROM = 0.94

/** How long the confetti flies before it has fully faded. */
export const CONFETTI_MS = 1200
const CONFETTI_FADE_MS = 320

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0
}

function smoothstep(x: number): number {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

export interface LevelUpFrame {
  /** 0..1, for the whole overlay. */
  opacity: number
  /** Scale of the card; always 1 with reduced motion. */
  scale: number
  /** Milliseconds into the confetti, or `null` when none is drawn (reduced motion, or after it ended). */
  confettiMs: number | null
  /** The moment is over: remove the overlay. */
  done: boolean
}

/** A click or Esc does not cut the moment: it fades out over this long, from wherever it is. */
export const DISMISS_FADE_MS = 140

/**
 * The overlay at `elapsedMs` after it appeared. `dismissedAtMs` is when it was dismissed early (a click
 * or Esc), or `null`/omitted.
 */
export function levelUpFrame(
  elapsedMs: number,
  reducedMotion: boolean,
  dismissedAtMs: number | null = null,
): LevelUpFrame {
  const t = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const fadeIn = reducedMotion ? REDUCED_FADE_IN_MS : FADE_IN_MS
  const fadeOut = reducedMotion ? REDUCED_FADE_OUT_MS : FADE_OUT_MS
  const natural = smoothstep(t / fadeIn) * (1 - smoothstep((t - (LEVEL_UP_MS - fadeOut)) / fadeOut))
  const sinceDismiss = dismissedAtMs === null ? 0 : Math.max(0, t - dismissedAtMs)
  const dismissed = dismissedAtMs !== null && sinceDismiss >= DISMISS_FADE_MS
  return {
    opacity:
      natural * (dismissedAtMs === null ? 1 : 1 - smoothstep(sinceDismiss / DISMISS_FADE_MS)),
    scale: reducedMotion ? 1 : SCALE_FROM + (1 - SCALE_FROM) * smoothstep(t / (fadeIn * 1.6)),
    confettiMs: reducedMotion || t >= CONFETTI_MS ? null : t,
    done: t >= LEVEL_UP_MS || dismissed,
  }
}

// ─── Confetti ───────────────────────────────────────────────────────────────

export interface ConfettiPiece {
  /** Index into the palette (the nine tag colours). */
  color: number
  /** Launch speed in viewport-heights per second, and direction in radians (up-and-outward fan). */
  speed: number
  angle: number
  /** Side of the square in CSS pixels. */
  size: number
  rotation: number
  /** Radians per second. */
  spin: number
  /** Seconds before it is launched; a burst of overlapping waves reads as more than one blob. */
  delay: number
}

export interface ConfettiPose {
  x: number
  y: number
  size: number
  rotation: number
  alpha: number
}

const GRAVITY = 1.9
const DRAG = 1.4

/** Small seeded generator (mulberry32): the same level always throws the same confetti. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `count` pieces spread evenly over `colors` palette entries, fanned out from the centre. */
export function makeConfetti(seed: number, count: number, colors: number): ConfettiPiece[] {
  const random = mulberry32(seed * 2654435761 + 1)
  const pieces: ConfettiPiece[] = []
  const palette = Math.max(1, Math.floor(colors))
  for (let i = 0; i < Math.max(0, Math.floor(count)); i++) {
    pieces.push({
      color: i % palette,
      speed: 0.55 + random() * 0.6,
      // Between "almost sideways" and "almost straight up", either side.
      angle: -Math.PI * (0.12 + random() * 0.76),
      size: 6 + Math.floor(random() * 6),
      rotation: random() * Math.PI * 2,
      spin: (random() < 0.5 ? -1 : 1) * (3 + random() * 6),
      delay: random() * 0.12,
    })
  }
  return pieces
}

/**
 * Where a piece is `ms` after the moment began, in a `width × height` viewport, or `null` while it has
 * not launched yet or once it has faded. Closed-form (gravity, and drag on the sideways speed), so it
 * needs no per-frame state.
 */
export function confettiPose(
  piece: ConfettiPiece,
  ms: number,
  width: number,
  height: number,
): ConfettiPose | null {
  const t = ms / 1000 - piece.delay
  if (!(t >= 0) || ms >= CONFETTI_MS) return null
  const unit = Math.min(width, height)
  const vx = Math.cos(piece.angle) * piece.speed * unit
  const vy = Math.sin(piece.angle) * piece.speed * unit
  const x = width / 2 + (vx * (1 - Math.exp(-DRAG * t))) / DRAG
  const y = height * 0.46 + vy * t + 0.5 * GRAVITY * unit * t * t
  const alpha = 1 - smoothstep((ms - (CONFETTI_MS - CONFETTI_FADE_MS)) / CONFETTI_FADE_MS)
  return { x, y, size: piece.size, rotation: piece.rotation + piece.spin * t, alpha }
}
