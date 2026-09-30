import { CalendarCheck } from 'lucide-react'
import { lazy } from 'react'
import { navigate } from '@/app/router'
import type { CommandDef, ShortcutDef } from '@/app/registry'
import type { FeatureContribution } from './feature'
import { WeeklyReviewPrompt } from './WeeklyReviewPrompt'

/**
 * The weekly review (7C): `/review/:weekStart?`, a Sunday card in Today's right-hand column, the palette
 * command "Weekly review" and `g v` (`g w` is My World's). On the page `[` and `]` step between weeks and
 * `shift+d` marks the review done; each of them is also a palette command that works while the page is
 * open. The page binds their handlers, so the keys do nothing anywhere else.
 */
const onReviewPage = (): boolean => window.location.pathname.startsWith('/review')

const shortcuts: ShortcutDef[] = [
  {
    id: 'go.weeklyReview',
    keys: 'g v',
    description: 'Go to Weekly review',
    group: 'Navigation',
    scope: 'global',
    run: () => navigate('weeklyReview'),
  },
  {
    id: 'weeklyReview.previous',
    keys: '[',
    description: 'Previous week',
    group: 'Progress',
    scope: 'progress',
  },
  {
    id: 'weeklyReview.next',
    keys: ']',
    description: 'Next week',
    group: 'Progress',
    scope: 'progress',
  },
  {
    id: 'weeklyReview.done',
    keys: 'shift+d',
    description: 'Mark weekly review done',
    group: 'Progress',
    scope: 'progress',
  },
]

const commands: CommandDef[] = [
  {
    id: 'command.weeklyReview.open',
    title: 'Weekly review',
    group: 'Go to',
    icon: CalendarCheck,
    keywords: ['review', 'week', 'wins', 'reflect', 'sunday', 'plan', 'next week'],
    shortcutId: 'go.weeklyReview',
    run: (c) => c.navigate('weeklyReview'),
  },
  {
    id: 'command.weeklyReview.previous',
    title: 'Previous week in the review',
    group: 'Review',
    icon: CalendarCheck,
    keywords: ['weekly review', 'earlier', 'last week'],
    shortcutId: 'weeklyReview.previous',
    when: onReviewPage,
    run: (c) => c.invoke('weeklyReview.previous'),
  },
  {
    id: 'command.weeklyReview.next',
    title: 'Next week in the review',
    group: 'Review',
    icon: CalendarCheck,
    keywords: ['weekly review', 'later'],
    shortcutId: 'weeklyReview.next',
    when: onReviewPage,
    run: (c) => c.invoke('weeklyReview.next'),
  },
  {
    id: 'command.weeklyReview.done',
    title: 'Mark weekly review done',
    group: 'Review',
    icon: CalendarCheck,
    keywords: ['weekly review', 'finish', 'complete', 'xp'],
    shortcutId: 'weeklyReview.done',
    when: onReviewPage,
    run: (c) => c.invoke('weeklyReview.done'),
  },
]

const feature: FeatureContribution = {
  routes: { weeklyReview: lazy(() => import('./WeeklyReviewPage')) },
  slots: [
    { slot: 'today.aside', id: 'weeklyReview.prompt', order: 5, component: WeeklyReviewPrompt },
  ],
  shortcuts,
  commands,
}

export default feature
