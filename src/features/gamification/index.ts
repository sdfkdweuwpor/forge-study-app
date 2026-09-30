/**
 * Public API of the gamification feature. Other features import from `@/features/gamification` only.
 *
 * - `XpFloat`: the gold "+25 XP" pill (`variant="float"` rises and fades from where it sits; `"chip"`
 *   is still). For the focus session's end and anything else that pays XP.
 *
 * - `BadgesGrid`, `RecentBadges` (6C): every badge with its locked or unlocked state, and the newest few
 *   for the Progress page.
 *
 * Parts 6B (shop) and 6C (badges) add their own exports below.
 */
export { XpFloat } from './XpFloat'
export type { XpFloatProps } from './XpFloat'
export { BadgesGrid } from './BadgesGrid'
export { RecentBadges } from './BadgeRecent'
export type { RecentBadgesProps } from './BadgeRecent'
