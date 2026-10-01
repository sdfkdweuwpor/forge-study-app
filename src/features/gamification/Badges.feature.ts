import { Award } from 'lucide-react'
import type { FeatureContribution } from './feature'
import { BadgeUnlockToaster } from './BadgeUnlockToaster'
import { badgeAppStart, badgeDomainHandlers } from './badgeHandlers'

/**
 * Badges (6C): earning them from history (session, course and streak events, and a reconcile at app
 * start), the unlock toast, and a palette command for the Badges tab of the Rewards page. The grid
 * itself (`BadgesGrid`) is rendered by that page.
 */
const feature: FeatureContribution = {
  domainHandlers: badgeDomainHandlers,
  onAppStart: badgeAppStart,
  slots: [
    { slot: 'global.overlays', id: 'badges.unlockToast', order: 30, component: BadgeUnlockToaster },
  ],
  commands: [
    {
      id: 'command.badges.open',
      title: 'Go to Badges',
      group: 'Go to',
      icon: Award,
      keywords: ['badges', 'achievements', 'unlocked', 'streak', 'early bird', 'night owl'],
      run: (c) => c.navigate('rewards', { tab: 'badges' }),
    },
  ],
}

export default feature
