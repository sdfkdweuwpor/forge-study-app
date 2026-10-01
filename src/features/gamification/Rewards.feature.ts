import { Gift, Plus } from 'lucide-react'
import { lazy } from 'react'
import type { CommandDef } from '@/app/registry'
import type { FeatureContribution } from './feature'
import { rewardsShortcuts } from './RewardsShortcuts'

const commands: CommandDef[] = [
  {
    id: 'command.rewards.new',
    title: 'New reward',
    group: 'Create',
    icon: Plus,
    keywords: ['create', 'add', 'reward', 'treat', 'price', 'xp'],
    shortcutId: 'rewards.new',
    // On the Rewards page `n` does this; from anywhere else the page opens with the row ready.
    run: (c) => c.navigate('rewards', { tab: 'shop' }, { query: { new: '1' } }),
  },
  {
    id: 'command.rewards.shop',
    title: 'Go to Rewards shop',
    group: 'Go to',
    icon: Gift,
    keywords: ['rewards', 'shop', 'store', 'spend', 'buy', 'redeem', 'xp'],
    run: (c) => c.navigate('rewards', { tab: 'shop' }),
  },
  {
    id: 'command.rewards.history',
    title: 'Go to Redemption history',
    group: 'Go to',
    icon: Gift,
    keywords: ['rewards', 'history', 'redeemed', 'spent', 'purchases'],
    run: (c) => c.navigate('rewards', { tab: 'history' }),
  },
]

/** The rewards shop (6B): the `/rewards/:tab?` page (Shop, Badges, History), its palette commands and `n`. */
const feature: FeatureContribution = {
  routes: { rewards: lazy(() => import('./RewardsPage')) },
  commands,
  shortcuts: rewardsShortcuts,
}

export default feature
