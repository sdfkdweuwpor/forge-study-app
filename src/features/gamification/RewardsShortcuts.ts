import type { ShortcutDef } from '@/app/registry'

/**
 * The rewards keyboard map. `n` opens the new-reward row; it exists only while the Rewards page is on
 * screen (scope `rewards`), and the page binds it with `useShortcutHandler`. Going to the shop is the
 * palette's "Go to Rewards shop" and the shell's `g r`.
 */
export const rewardsShortcuts: ShortcutDef[] = [
  { id: 'rewards.new', keys: 'n', description: 'New reward', group: 'Rewards', scope: 'rewards' },
]
