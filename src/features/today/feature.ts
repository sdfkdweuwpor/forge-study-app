import { CalendarArrowUp, Check, SkipForward } from 'lucide-react'
import { lazy } from 'react'
import type { FeatureManifest, ShortcutDef } from '@/app/registry'
import { MilestoneCountdown, MiniHeatmap } from './Aside'
import { DailyGoalStat, StreakStat, XpTodayStat } from './HeaderStats'
import { requestTodayAction } from './todayActions'

/**
 * Today's own shortcuts. They live in the `today` scope, so they only exist while the page is open,
 * and act on the Now card and the Rolled over group; `j k x e enter` come from the tasks feature.
 */
const shortcuts: ShortcutDef[] = [
  {
    id: 'today.nowDone',
    keys: 'shift+x',
    description: 'Complete the Now task',
    group: 'Today',
    scope: 'today',
  },
  {
    id: 'today.nowSkip',
    keys: 'shift+n',
    description: 'Skip the Now task for today',
    group: 'Today',
    scope: 'today',
  },
  {
    id: 'today.moveRolledOver',
    keys: 'shift+t',
    description: 'Move all rolled-over tasks to today',
    group: 'Today',
    scope: 'today',
  },
]

/**
 * Slot defaults: the stat row (`today.header`: daily goal ring, streak flame, XP today) and the aside
 * (`today.aside`: milestone countdown, 14-day heatmap). Later phases add their own contributions
 * with other ids and orders (10, 20, 30… leave room), or re-point the hooks in `queries.ts`.
 */
const manifest: FeatureManifest = {
  id: 'today',
  routes: { today: lazy(() => import('./TodayPage')) },
  shortcuts,
  commands: [
    {
      id: 'command.today.completeNow',
      title: 'Complete the Now task',
      group: 'Focus',
      icon: Check,
      keywords: ['done', 'finish', 'next task', 'today'],
      shortcutId: 'today.nowDone',
      run: () => requestTodayAction('completeNow'),
    },
    {
      id: 'command.today.skipNow',
      title: 'Skip the Now task for today',
      group: 'Focus',
      icon: SkipForward,
      keywords: ['later', 'next task', 'postpone', 'today'],
      shortcutId: 'today.nowSkip',
      run: () => requestTodayAction('skipNow'),
    },
    {
      id: 'command.today.moveRolledOver',
      title: 'Move rolled-over tasks to today',
      group: 'Review',
      icon: CalendarArrowUp,
      keywords: ['overdue', 'reschedule', 'catch up', 'slipped'],
      shortcutId: 'today.moveRolledOver',
      run: () => requestTodayAction('moveRolledOver'),
    },
  ],
  slots: [
    { slot: 'today.header', id: 'today.stat.goal', order: 10, component: DailyGoalStat },
    { slot: 'today.header', id: 'today.stat.streak', order: 20, component: StreakStat },
    { slot: 'today.header', id: 'today.stat.xp', order: 30, component: XpTodayStat },
    { slot: 'today.aside', id: 'today.targets', order: 10, component: MilestoneCountdown },
    { slot: 'today.aside', id: 'today.heatmap', order: 20, component: MiniHeatmap },
  ],
}

export default manifest
