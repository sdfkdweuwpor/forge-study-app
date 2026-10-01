import { useState } from 'react'
import { recordError } from '@/app/reportError'
import { applyProposal, dismissProposal, rollForwardGoal } from '@/db/repos/proposals'
import type { Goal, PlanProposal } from '@/db/types'
import { plural } from '@/logic/goalDisplay'
import { Button } from '@/ui/Button'
import { useToast } from '@/ui/Toast'
import styles from './goal.module.css'

export interface ProposalsBannerProps {
  goal: Goal
  proposals: readonly PlanProposal[]
}

/** The calm card's first line: what changed, in words about the plan and never about the person. */
export function bannerTitle(
  goal: Pick<Goal, 'projection'>,
  proposals: readonly PlanProposal[],
): string {
  if (proposals.every((p) => p.kind === 'lifeHappened'))
    return 'A re-plan for this week is waiting.'
  const slip = goal.projection?.slipDays ?? null
  return slip !== null && slip > 0
    ? `You’re about ${plural(slip, 'day')} behind. Choose what to do:`
    : 'The plan has slipped a little. Choose what to do:'
}

/**
 * Pending proposals for a goal (far behind, or a "life happened" re-plan waiting). Nothing changes until
 * an option is chosen; each choice can be undone, and "Not now" sets them all aside (also with Undo).
 */
export function ProposalsBanner({ goal, proposals }: ProposalsBannerProps) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  async function choose(p: PlanProposal) {
    setBusy(p.id)
    try {
      const r = await applyProposal(p.id)
      if (r.status === 'applied') {
        toast.show({
          title: `Done: ${p.title}`,
          description: 'Your plan was updated.',
          undo: r.undo,
        })
      } else if (r.status === 'stale') {
        toast.show({
          title: 'The plan changed since these were worked out',
          description: 'Forge is recalculating the options.',
        })
        await rollForwardGoal(goal.id)
      } else {
        toast.error('That choice is no longer available', { description: 'Nothing was changed.' })
      }
    } catch (error) {
      recordError(error, 'applyProposal')
      toast.error('Couldn’t change the plan', { description: 'Nothing was changed. Try again.' })
    } finally {
      setBusy(null)
    }
  }

  async function notNow() {
    try {
      const undos = (await Promise.all(proposals.map((p) => dismissProposal(p.id)))).flatMap((u) =>
        u ? [u] : [],
      )
      toast.show({
        title: 'Set aside for now',
        description: 'Forge keeps your plan as it is. Nothing was rewritten.',
        undo: async () => {
          for (const u of undos) await u.undo()
        },
      })
    } catch (error) {
      recordError(error, 'dismissProposal')
      toast.error('Couldn’t set that aside', { description: 'Try again.' })
    }
  }

  return (
    <section
      className={styles.banner}
      aria-labelledby="plan-proposals-title"
      id="plan-proposals"
      tabIndex={-1}
    >
      <h2 id="plan-proposals-title" className={styles.bannerTitle}>
        {bannerTitle(goal, proposals)}
      </h2>
      <ul className={styles.options}>
        {proposals.map((p) => {
          const moved = p.preview.moved.length
          return (
            <li key={p.id} className={styles.option}>
              <div className={styles.optionText}>
                <span className={styles.optionTitle}>{p.title}</span>
                <span className={styles.optionDetail}>
                  {p.detail}
                  {moved > 0 ? ` ${plural(moved, 'session')} would move.` : ''}
                </span>
              </div>
              <Button
                size="sm"
                loading={busy === p.id}
                disabled={busy !== null && busy !== p.id}
                aria-label={`Choose: ${p.title}`}
                onClick={() => void choose(p)}
              >
                Choose
              </Button>
            </li>
          )
        })}
      </ul>
      <div className={styles.bannerFoot}>
        <Button variant="ghost" size="sm" onClick={() => void notNow()}>
          Not now
        </Button>
        <span className={styles.bannerNote}>Nothing changes unless you choose.</span>
      </div>
    </section>
  )
}
