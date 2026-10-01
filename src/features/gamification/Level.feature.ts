import { Trophy } from 'lucide-react'
import { lazy } from 'react'
import type { FeatureContribution } from './feature'
import { dailyGoalHandler, gamificationAppStart } from './handlers'
import { LevelUp } from './LevelUp'
import { DailyGoalToast } from './XpFloatToasts'

const LevelBadge = lazy(() => import('./LevelCompact').then((m) => ({ default: m.LevelBadge })))
const LevelRow = lazy(() => import('./LevelCompact').then((m) => ({ default: m.LevelRow })))

// The sidebar meter is drawn from a live query, so it is its own chunk (fetched while the shell paints,
// see app/bootPreload.ts) and not part of the first download.
const LevelMeter = lazy(() => import('./LevelMeter').then((m) => ({ default: m.LevelMeter })))

/**
 * XP and levels (6A): the level meter in the sidebar footer, the level-up moment, the daily-goal bonus
 * and its toast, and the palette command that opens the rewards page. `g r` (built in) is its shortcut.
 * Where the sidebar is not on screen the level is a ring beside the "Open sidebar" button (`sidebar.rail`,
 * collapsed desktop and tablet) and a row at the foot of the phone's More sheet (`more.footer`).
 */
const feature: FeatureContribution = {
  slots: [
    { slot: 'sidebar.footer', id: 'gamification.levelMeter', order: 10, component: LevelMeter },
    { slot: 'sidebar.rail', id: 'gamification.levelBadge', order: 10, component: LevelBadge },
    { slot: 'more.footer', id: 'gamification.levelRow', order: 10, component: LevelRow },
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
      keywords: ['level', 'xp', 'experience', 'points', 'rewards', 'balance'],
      shortcutId: 'go.rewards',
      run: (c) => c.navigate('rewards'),
    },
  ],
  domainHandlers: [dailyGoalHandler],
  onAppStart: gamificationAppStart,
}

export default feature
