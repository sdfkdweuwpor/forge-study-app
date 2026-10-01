import { Flame } from 'lucide-react'
import type { FeatureContribution } from './feature'
import { streakDomainHandlers, streaksAppStart } from './handlers'
import { StreakFlame } from './StreakFlame'
import { StreakToaster } from './StreakToaster'

/**
 * Streaks (7A): the `streakDays` handlers and the start-up rebuild, milestone XP, the flame in the
 * sidebar footer (under 6A's level meter, order 10), the milestone toast and a palette command for the
 * Progress page (`g p`, built in, is its shortcut). Today's streak stat and 14-day heatmap read the same
 * data through `useStreak` (`@/db/hooks/useStreak`) in the today feature's `queries.ts`.
 */
const feature: FeatureContribution = {
  domainHandlers: streakDomainHandlers,
  onAppStart: streaksAppStart,
  slots: [
    { slot: 'sidebar.footer', id: 'streaks.flame', order: 20, component: StreakFlame },
    { slot: 'global.overlays', id: 'streaks.milestoneToast', order: 40, component: StreakToaster },
  ],
  commands: [
    {
      id: 'command.streaks.show',
      title: 'Show streak',
      group: 'Go to',
      icon: Flame,
      keywords: ['streak', 'flame', 'days in a row', 'freeze', 'best streak'],
      shortcutId: 'go.progress',
      run: (c) => c.navigate('progress'),
    },
  ],
}

export default feature
