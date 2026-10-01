/**
 * Roving focus for radiogroups and tablists: which index an arrow/Home/End key moves to,
 * skipping disabled items and wrapping around. Returns null for other keys.
 */
export function nextIndex(
  key: string,
  current: number,
  disabled: readonly boolean[],
  orientation: 'horizontal' | 'both' = 'both',
): number | null {
  const n = disabled.length
  if (n === 0) return null
  const forward = key === 'ArrowRight' || (orientation === 'both' && key === 'ArrowDown')
  const back = key === 'ArrowLeft' || (orientation === 'both' && key === 'ArrowUp')
  const step = (from: number, dir: 1 | -1): number | null => {
    for (let i = 1; i <= n; i++) {
      const j = (((from + dir * i) % n) + n) % n
      if (!disabled[j]) return j
    }
    return null
  }
  if (forward) return step(current, 1)
  if (back) return step(current, -1)
  if (key === 'Home') return step(-1, 1)
  if (key === 'End') return step(n, -1)
  return null
}
