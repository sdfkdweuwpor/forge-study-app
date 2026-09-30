import { CalendarArrowUp, Check, Play, SkipForward } from 'lucide-react'
import { lazy } from 'react'
import type { FeatureManifest, ShortcutDef } from '@/app/registry'
import { StartFocusHotkey } from './StartFocusHotkey'
import { requestTodayAction } from './todayActions'

// Slot components load as their own chunks (fetched while the page does, see app/bootPreload.ts), so the
// first download holds the shell and not every page's cards.
const MilestoneCountdown = lazy(() =>
  import('./Aside').then((m) => ({ default: m.MilestoneCountdown })),
)
const MiniHeatmap = lazy(() => import('./Aside').then((m) => ({ default: m.MiniHeatmap })))
const DailyGoalStat = lazy(() =>
  import('./HeaderStats').then((m) => ({ default: m.DailyGoalStat })),
)
const StreakStat = lazy(() => import('./HeaderStats').then((m) => ({ default: m.StreakStat })))
const XpTodayStat = lazy(() => import('./HeaderStats').then((m) => ({ default: m.XpTodayStat })))
const TimePerGoalCard = lazy(() =>
  import('./TimeAside').then((m) => ({ default: m.TimePerGoalCard })),
)

/**
 * Today's own shortcuts. They live in the `today` scope, so they only exist while the page is open,
 * and act on the Now card and the Carried over group; `j k x e enter` come from the tasks feature.
 */
const shortcuts: ShortcutDef[] = [
  {
    id: 'today.startFocus',
    keys: 'shift+s',
    description: 'Start focus on the Now task',
    group: 'Focus',
    // From any page: it reads the Now task itself (see StartFocusHotkey).
    scope: 'global',
  },
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
    id: 'today.moveCarriedOver',
    keys: 'shift+t',
    description: 'Move all carried-over tasks to today',
    group: 'Today',
    scope: 'today',
  },
]

/**
 * Slot defaults: the stat row (`today.header`: daily goal ring, streak flame, XP today) and the aside
 * (`today.aside`: milestone countdown, time per goal, 14-day heatmap). Later phases add their own contributions
 * with other ids and orders (10, 20, 30… leave room), or re-point the hooks in `queries.ts`.
 */
const manifest: FeatureManifest = {
  id: 'today',
  routes: { today: lazy(() => import('./TodayPage')) },
  shortcuts,
  commands: [
    {
      id: 'command.today.startFocus',
      title: 'Start focus',
      group: 'Focus',
      icon: Play,
      keywords: ['timer', 'pomodoro', 'begin', 'now task', 'session'],
      shortcutId: 'today.startFocus',
      run: (c) => c.invoke('today.startFocus'),
    },
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
      id: 'command.today.moveCarriedOver',
      title: 'Move carried-over tasks to today',
      group: 'Review',
      icon: CalendarArrowUp,
      keywords: ['rolled over', 'overdue', 'reschedule', 'catch up', 'slipped', 'earlier'],
      shortcutId: 'today.moveCarriedOver',
      run: () => requestTodayAction('moveCarriedOver'),
    },
  ],
  slots: [
    {
      slot: 'global.overlays',
      id: 'today.startFocusHotkey',
      order: 5,
      component: StartFocusHotkey,
    },
    { slot: 'today.header', id: 'today.stat.goal', order: 10, component: DailyGoalStat },
    { slot: 'today.header', id: 'today.stat.streak', order: 20, component: StreakStat },
    { slot: 'today.header', id: 'today.stat.xp', order: 30, component: XpTodayStat },
    { slot: 'today.aside', id: 'today.targets', order: 10, component: MilestoneCountdown },
    { slot: 'today.aside', id: 'today.heatmap', order: 20, component: MiniHeatmap },
    { slot: 'today.aside', id: 'today.timePerGoal', order: 15, component: TimePerGoalCard },
  ],
}

export default manifest
