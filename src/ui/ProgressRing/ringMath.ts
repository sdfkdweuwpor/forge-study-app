/** Geometry of an SVG progress ring: the stroke sits inside `size`, dashoffset draws `value/max`. */
export interface RingGeometry {
  /** Centre (x = y) in the size×size viewBox. */
  center: number
  radius: number
  circumference: number
  /** 0–1, clamped. */
  fraction: number
  /** stroke-dashoffset for the progress arc (dasharray = circumference). */
  offset: number
}

export function ringGeometry(size: number, stroke: number, value: number, max = 100): RingGeometry {
  const center = size / 2
  const radius = Math.max(0, (size - stroke) / 2)
  const circumference = 2 * Math.PI * radius
  const fraction =
    Number.isFinite(value) && Number.isFinite(max) && max > 0
      ? Math.min(Math.max(value / max, 0), 1)
      : 0
  return { center, radius, circumference, fraction, offset: circumference * (1 - fraction) }
}
