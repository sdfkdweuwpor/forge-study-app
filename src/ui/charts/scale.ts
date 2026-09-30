/**
 * Pure geometry and text helpers shared by the charts. No React, no DOM: every function is a number
 * or a string in and out, so they are all tested in Node (`scale.test.ts`).
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Maps `domain` onto `range` linearly. A zero-width domain maps everything to the start of the range. */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): (value: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  if (span === 0) return () => r0
  return (value) => r0 + ((value - d0) / span) * (r1 - r0)
}

export interface TickOptions {
  /** Whole-number steps only (counts of tasks). */
  integer?: boolean
}

/** The 1-2-5 step at or above `raw`. */
function niceStep(raw: number): number {
  const exponent = Math.floor(Math.log10(raw))
  const base = 10 ** exponent
  const fraction = raw / base
  const nice = fraction <= 1 + 1e-9 ? 1 : fraction <= 2 + 1e-9 ? 2 : fraction <= 5 + 1e-9 ? 5 : 10
  return nice * base
}

/**
 * Axis ticks from 0 up to the first "nice" value at or above `max`, in 1-2-5 steps, about `count`
 * intervals (so `count = 3` for a max of 47 gives 0, 20, 40, 60). With no positive max it is `[0]`.
 * Floats are cleaned (0.1 steps do not come out as 0.30000000000000004).
 */
export function niceTicks(max: number, count: number, options: TickOptions = {}): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0]
  const intervals = Math.max(1, Math.floor(count))
  let step = niceStep(max / intervals)
  if (options.integer) step = Math.max(1, Math.ceil(step))
  const top = Math.ceil(max / step - 1e-9)
  const ticks: number[] = []
  for (let i = 0; i <= top; i++) ticks.push(Math.round(i * step * 1e9) / 1e9)
  return ticks
}

const num = (n: number): string => String(Math.round(n * 100) / 100)

/**
 * A bar with a rounded top and a square base, as an SVG path. `(x, y)` is the top-left corner, `h` runs
 * down to the baseline. The radius never exceeds half the width or the height, so a sliver of a bar
 * stays a valid shape. Empty for a bar with no size.
 */
export function barPath(x: number, y: number, w: number, h: number, r: number): string {
  if (!(w > 0) || !(h > 0)) return ''
  const rad = Math.max(0, Math.min(r, w / 2, h))
  const bottom = y + h
  if (rad === 0) return `M${num(x)},${num(bottom)}V${num(y)}H${num(x + w)}V${num(bottom)}Z`
  return (
    `M${num(x)},${num(bottom)}V${num(y + rad)}` +
    `A${num(rad)},${num(rad)} 0 0 1 ${num(x + rad)},${num(y)}` +
    `H${num(x + w - rad)}` +
    `A${num(rad)},${num(rad)} 0 0 1 ${num(x + w)},${num(y + rad)}` +
    `V${num(bottom)}Z`
  )
}

/** "12a", "6a", "12p", "6p": the axis label of an hour, 0–23 (24 reads as midnight). */
export function formatHourLabel(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  if (h === 0) return '12a'
  if (h === 12) return '12p'
  return h < 12 ? `${h}a` : `${h - 12}p`
}

/** "9–10 AM", "11 AM–12 PM", "12–1 AM": the hour that starts at `hour`, for tooltips and tables. */
export function hourRangeLabel(hour: number): string {
  const start = ((Math.floor(hour) % 24) + 24) % 24
  const end = (start + 1) % 24
  const clock = (h: number): number => h % 12 || 12
  const suffix = (h: number): string => (h < 12 ? 'AM' : 'PM')
  const from = clock(start)
  const to = clock(end)
  return suffix(start) === suffix(end)
    ? `${from}–${to} ${suffix(end)}`
    : `${from} ${suffix(start)}–${to} ${suffix(end)}`
}

/** A rough width of `text` in px at `fontPx` (Inter averages about 0.56 em per character, digits 0.6). */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * 0.58
}

/** `text` cut with an ellipsis so it is estimated to fit in `maxPx`. */
export function truncateLabel(text: string, maxPx: number, fontPx: number): string {
  if (estimateTextWidth(text, fontPx) <= maxPx) return text
  const chars = Math.max(1, Math.floor(maxPx / (fontPx * 0.58)) - 1)
  return `${text.slice(0, chars).trimEnd()}…`
}

/**
 * How many bars apart to label so labels of `labelPx` do not touch when the bars are `pitchPx` apart.
 * Every `n`-th label is shown, counted back from the last bar (which is "today", so it always has one).
 */
export function tickStep(pitchPx: number, labelPx: number, gapPx = 10): number {
  if (!(pitchPx > 0)) return 1
  return Math.max(1, Math.ceil((labelPx + gapPx) / pitchPx))
}

/** Whether bar `index` of `length` gets an axis label, given `step` from `tickStep`, anchored at the end. */
export function showsTick(index: number, length: number, step: number): boolean {
  return (length - 1 - index) % step === 0
}

export interface BandLayout {
  /** Distance between bar starts. */
  pitch: number
  barWidth: number
  /** Left edge of bar `i`, centred in its band. */
  barX: (i: number) => number
  /** Left edge of band `i`. */
  bandX: (i: number) => number
  /** The band a pointer at `x` is over, clamped to the chart. */
  indexAt: (x: number) => number
}

/**
 * Evenly spaced bars across `[left, left + width]`. Each bar is as wide as its band less a 2px gap, but
 * never wider than `maxBar` (thin marks: the rest is air).
 */
export function bandLayout(
  count: number,
  left: number,
  width: number,
  maxBar = 24,
  gap = 2,
): BandLayout {
  const n = Math.max(1, count)
  const pitch = Math.max(0, width) / n
  const barWidth = Math.max(1, Math.min(maxBar, pitch - gap))
  return {
    pitch,
    barWidth,
    barX: (i) => left + i * pitch + (pitch - barWidth) / 2,
    bandX: (i) => left + i * pitch,
    indexAt: (x) => clamp(Math.floor((x - left) / pitch), 0, n - 1),
  }
}

/** A straight line through `points` as an SVG path. */
export function linePath(points: readonly (readonly [number, number])[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${num(x)},${num(y)}`).join('')
}

/** The same line closed down to `baseline`, for an area wash. */
export function areaPath(points: readonly (readonly [number, number])[], baseline: number): string {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return ''
  return `${linePath(points)}L${num(last[0])},${num(baseline)}L${num(first[0])},${num(baseline)}Z`
}

/** The index of the point nearest `(x, y)`, or -1 for no points. Ties go to the earlier one. */
export function nearestPoint(
  points: readonly (readonly [number, number])[],
  x: number,
  y: number,
): number {
  let best = -1
  let bestDistance = Infinity
  points.forEach(([px, py], i) => {
    const distance = (px - x) ** 2 + (py - y) ** 2
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  })
  return best
}

/** Steps that read well on a time axis, in minutes: 15 and 30 min, then whole hours. */
const TIME_STEPS: readonly number[] = [60, 120, 180, 240, 360, 480, 720, 1440]

/**
 * Ticks for an axis in minutes: up to an hour they are the usual 1-2-5 steps (0, 20, 40, 60); beyond it they
 * are whole hours (0, 1 h, 2 h, 3 h) with the smallest step that needs no more than `count` intervals.
 */
export function niceTimeTicks(max: number, count: number): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0]
  if (max <= 60) return niceTicks(max, count)
  const intervals = Math.max(1, Math.floor(count))
  const step =
    TIME_STEPS.find((s) => Math.ceil(max / s - 1e-9) <= intervals) ??
    TIME_STEPS[TIME_STEPS.length - 1] ??
    1440
  const top = Math.ceil(max / step - 1e-9)
  return Array.from({ length: top + 1 }, (_, i) => i * step)
}
