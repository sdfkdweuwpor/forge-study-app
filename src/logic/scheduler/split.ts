/**
 * Splitting work into sessions (pure). A unit becomes near-equal sessions close to the target length,
 * each within [min, max] and on the grain. A unit shorter than `min` is one short session.
 */
import { ceilTo, floorTo } from './capacity'

export interface SplitRules {
  /** Preferred session length. */
  target: number
  min: number
  max: number
  grain: number
}

/**
 * `total` minutes (rounded up to the grain) as session lengths, longest first. The count is the one
 * closest to `total / target` that keeps every piece within [min, max]; pieces differ by at most one
 * grain. Deterministic.
 */
export function splitMinutes(total: number, rules: SplitRules): number[] {
  const grain = Math.max(1, Math.round(rules.grain))
  const max = Math.max(grain, floorTo(rules.max, grain))
  const min = Math.min(max, Math.max(grain, ceilTo(rules.min, grain)))
  const target = Math.min(max, Math.max(min, rules.target))
  if (!Number.isFinite(total) || total <= 0) return []
  const t = ceilTo(total, grain)
  if (t <= max) return [t]
  const fewest = Math.ceil(t / max)
  const most = Math.max(fewest, Math.floor(t / min))
  const n = Math.min(most, Math.max(fewest, Math.round(t / target)))
  const grains = t / grain
  const base = Math.floor(grains / n)
  const extra = grains - base * n
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) * grain)
}
