/** The emergency-unlock flow (BRIEF §5.8): wait 60 seconds, type the phrase, get 5 minutes. */

export const UNLOCK_PHRASE = 'I choose distraction over my goals'
export const UNLOCK_WAIT_SECONDS = 60

/** Exact match on the phrase, ignoring only whitespace at either end (a trailing space from autocomplete). */
export function isUnlockPhrase(typed: string): boolean {
  return typed.trim() === UNLOCK_PHRASE
}

/** Whole seconds until `deadline`, computed from timestamps so a throttled background tab cannot drift. */
export function waitSecondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

/** Picks a motivation line, or null when the list is empty. `random` is injectable for tests. */
export function pickMotivation(
  lines: readonly string[],
  random: () => number = Math.random,
): string | null {
  const usable = lines.map((l) => l.trim()).filter((l) => l.length > 0)
  if (usable.length === 0) return null
  const index = Math.min(usable.length - 1, Math.floor(random() * usable.length))
  return usable[index] ?? null
}
