/**
 * The app's one celebration queue (see `logic/celebrations.ts` for what it does). Features call
 * `celebrate()` where they used to call `toast.xp()`: a streak milestone and its badge come out as one
 * toast, and nothing shows while the level-up moment is open. `CelebrationHost` (mounted once, under
 * the toast provider) is what puts them on screen; until it mounts, toasts wait rather than vanish.
 */
import { createCelebrationQueue, type Celebration } from '@/logic/celebrations'

const queue = createCelebrationQueue()

/** Announces something worth a gold toast. Merged with anything sharing its `mergeKey`, then shown. */
export function celebrate(celebration: Celebration): void {
  queue.push(celebration)
}

/** The level-up moment is open: toasts wait until the returned function is called. */
export function holdCelebrations(): () => void {
  return queue.hold()
}

/** Connects the toast stack; returns the disconnect. Used by `CelebrationHost` only. */
export const attachCelebrationHost = queue.attach

/** Forgets everything waiting (tests). */
export const resetCelebrations = queue.reset
