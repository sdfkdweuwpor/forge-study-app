import { Trophy } from 'lucide-react'
import type { FeatureContribution } from './feature'
import { dailyGoalHandler, gamificationAppStart } from './handlers'
import { LevelMeter } from './LevelMeter'
import { LevelUp } from './LevelUp'
import { DailyGoalToast } from './XpFloatToasts'

/**
 * XP and levels (6A): the level meter in the sidebar footer, the level-up moment, the daily-goal bonus
 * and its toast, and the palette command that opens the rewards page. `g r` (built in) is its shortcut.
 */
const feature: FeatureContribution = {
  slots: [
    { slot: 'sidebar.footer', id: 'gamification.levelMeter', order: 10, component: LevelMeter },
    { slot: 'global.overlays', id: 'gamification.levelUp', order: 10, component: LevelUp },
    {
      slot: 'global.overlays',
      id: 'gamification.dailyGoalToast',
      order: 20,
      component: DailyGoalToast,
    },
  ],
  commands: [
    {
      id: 'command.gamification.showLevel',
      title: 'Show level & XP',
      group: 'Go to',
      icon: Trophy,
      keywords: ['level', 'xp', 'experience', 'points', 'rewards', 'balance', 'progress'],
      shortcutId: 'go.rewards',
      run: (c) => c.navigate('rewards'),
    },
  ],
  domainHandlers: [dailyGoalHandler],
  onAppStart: gamificationAppStart,
}

export default feature
