import { LifeBuoy, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { useShortcutHandler } from '@/app/shortcuts'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { useToast } from '@/ui/Toast'
import { LifeHappenedDialog } from './LifeHappenedDialog'
import { PlanSettingsDialog } from './PlanSettingsDialog'
import { ProposalsBanner } from './ProposalsBanner'
import { useGoal, usePendingProposals } from '../queries'
import styles from './goal.module.css'

/**
 * The planner's contribution to the top of a goal page (`goal.header` slot): the pending proposals card
 * when there are any, and the "Life happened" and "Plan settings" buttons. It also owns the `shift+r`,
 * `shift+p` and `shift+e` handlers, which only exist while a goal page is on screen.
 */
export function PlanHeader({ goalId }: { goalId: string }) {
  const today = useToday()
  const toast = useToast()
  const goal = useGoal(goalId)
  const proposals = usePendingProposals(goalId, today)
  const [life, setLife] = useState({ open: false, session: 0 })
  const [settings, setSettings] = useState({ open: false, session: 0 })

  const openLife = () => setLife((s) => ({ open: true, session: s.session + 1 }))
  const openSettings = () => setSettings((s) => ({ open: true, session: s.session + 1 }))
  const reviewProposals = () => {
    const card = document.getElementById('plan-proposals')
    if (card) {
      card.scrollIntoView({ block: 'center' })
      card.focus()
    } else {
      toast.show({
        title: 'No plan proposals right now',
        description: 'Your plan is on track, or you set them aside.',
      })
    }
  }

  useShortcutHandler('planner.lifeHappened', openLife)
  useShortcutHandler('planner.reviewProposals', reviewProposals)
  useShortcutHandler('planner.settings', openSettings)

  if (!goal) return null
  return (
    <div className={styles.header}>
      {proposals && proposals.length > 0 ? (
        <ProposalsBanner goal={goal} proposals={proposals} />
      ) : null}
      <div className={styles.actions}>
        <Button size="sm" iconLeft={<LifeBuoy />} onClick={openLife} aria-keyshortcuts="Shift+R">
          Life happened <Kbd keys="shift+r" size="sm" />
        </Button>
        <Button
          size="sm"
          iconLeft={<SlidersHorizontal />}
          onClick={openSettings}
          aria-keyshortcuts="Shift+E"
        >
          Plan settings
        </Button>
      </div>
      {life.session > 0 ? (
        <LifeHappenedDialog
          key={life.session}
          goal={goal}
          today={today}
          open={life.open}
          onClose={() => setLife((s) => ({ ...s, open: false }))}
        />
      ) : null}
      {settings.session > 0 ? (
        <PlanSettingsDialog
          key={settings.session}
          goal={goal}
          open={settings.open}
          onClose={() => setSettings((s) => ({ ...s, open: false }))}
        />
      ) : null}
    </div>
  )
}
