/** The short line under "Level 8". Warm and about the work, never about what was missed. */
export const LEVEL_UP_LINES: readonly string[] = [
  'You’re building something real.',
  'That’s what steady work looks like.',
  'Every session adds up.',
  'Look how far you’ve come.',
  'One more step toward the finish line.',
]

/** The line for `level`: it changes from level to level, and is always the same for the same level. */
export function levelUpLine(level: number): string {
  const n = LEVEL_UP_LINES.length
  const i = Number.isFinite(level) ? (((Math.floor(level) - 2) % n) + n) % n : 0
  return LEVEL_UP_LINES[i] ?? 'You’re building something real.'
}
