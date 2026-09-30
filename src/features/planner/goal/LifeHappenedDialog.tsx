import { useRef, useState } from 'react'
import { useSettings } from '@/db/hooks/useSettings'
import { recordError } from '@/app/reportError'
import {
  applyProposal,
  dismissProposal,
  parseProposalApply,
  proposeReplanWeek,
} from '@/db/repos/proposals'
import type { Goal, ISODate, PlanProposal } from '@/db/types'
import { eachDay, endOfWeekISO, fromISODate } from '@/logic/dates'
import { formatDay, plural } from '@/logic/goalDisplay'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Modal } from '@/ui/Modal'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Spinner } from '@/ui/Spinner'
import { Tag } from '@/ui/Tag'
import { useToast } from '@/ui/Toast'
import shared from '../shared.module.css'
import styles from './goal.module.css'

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const FACTORS = [
  { value: '1', label: '100%' },
  { value: '0.75', label: '75%' },
  { value: '0.5', label: '50%' },
  { value: '0.25', label: '25%' },
] as const

/** `'18:00'` → `'6:00 PM'`. */
export function timeLabel(t: string | null): string {
  if (t === null) return ''
  const [h, m] = t.split(':').map(Number)
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return t
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

const dayName = (d: ISODate): string => WEEKDAY[fromISODate(d).getDay()] ?? ''

export interface LifeHappenedDialogProps {
  goal: Goal
  today: ISODate
  open: boolean
  onClose: () => void
}

type Phase =
  | { name: 'choose' }
  | { name: 'working' }
  | { name: 'preview'; proposal: PlanProposal }
  | { name: 'error' }

/**
 * "Life happened": say which days this week are gone, or how much of the rest of the week is left, see
 * exactly which sessions would move, then confirm. The preview is a proposal in the database, so nothing
 * about the plan changes until Confirm; closing without confirming sets the proposal aside. Mount it with a
 * fresh `key` each time it opens, so it starts from scratch.
 */
export function LifeHappenedDialog({ goal, today, open, onClose }: LifeHappenedDialogProps) {
  const toast = useToast()
  const settings = useSettings()
  const weekStartsOn = settings?.weekStartsOn ?? 1
  const days = eachDay(today, endOfWeekISO(today, weekStartsOn))
  const [gone, setGone] = useState<ReadonlySet<ISODate>>(new Set())
  const [factor, setFactor] = useState('1')
  const [phase, setPhase] = useState<Phase>({ name: 'choose' })
  const [applying, setApplying] = useState(false)
  const pending = useRef<PlanProposal | null>(null)

  async function discard() {
    const p = pending.current
    pending.current = null
    if (p) {
      try {
        await dismissProposal(p.id)
      } catch (error) {
        recordError(error, 'dismissProposal')
      }
    }
  }

  async function close() {
    await discard()
    onClose()
  }

  async function preview() {
    setPhase({ name: 'working' })
    try {
      const proposal = await proposeReplanWeek(goal.id, {
        blockedDays: [...gone].sort(),
        capacityFactor: Number(factor),
      })
      if (!proposal) {
        setPhase({ name: 'error' })
        return
      }
      pending.current = proposal
      setPhase({ name: 'preview', proposal })
    } catch (error) {
      recordError(error, 'proposeReplanWeek')
      setPhase({ name: 'error' })
    }
  }

  async function confirm(p: PlanProposal) {
    setApplying(true)
    try {
      const r = await applyProposal(p.id)
      pending.current = null
      if (r.status === 'applied') {
        toast.show({ title: 'Re-planned this week', description: p.title, undo: r.undo })
        onClose()
      } else {
        toast.error('The plan changed while you were looking', {
          description: 'Nothing was changed. Try again.',
        })
        setPhase({ name: 'choose' })
      }
    } catch (error) {
      recordError(error, 'applyProposal')
      toast.error('Couldn’t re-plan the week', { description: 'Nothing was changed. Try again.' })
    } finally {
      setApplying(false)
    }
  }

  const nothing = gone.size === 0 && factor === '1'
  const toggleDay = (d: ISODate) =>
    setGone((s) => {
      const next = new Set(s)
      if (next.has(d)) next.delete(d)
      else next.add(d)
      return next
    })

  return (
    <Modal
      open={open}
      onClose={() => void close()}
      title="Life happened"
      description="Re-plan the rest of this week. Nothing changes until you confirm."
      size="md"
      footer={
        phase.name === 'preview' ? (
          <>
            <Button
              variant="ghost"
              onClick={() => void discard().then(() => setPhase({ name: 'choose' }))}
            >
              Back
            </Button>
            <Button
              variant="primary"
              loading={applying}
              disabled={
                phase.proposal.preview.moved.length +
                  phase.proposal.preview.added.length +
                  phase.proposal.preview.removed.length ===
                0
              }
              onClick={() => void confirm(phase.proposal)}
            >
              Confirm re-plan
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => void close()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={nothing || phase.name === 'working'}
              onClick={() => void preview()}
            >
              Preview
            </Button>
          </>
        )
      }
    >
      <div className={shared.stack}>
        {phase.name === 'choose' || phase.name === 'working' ? (
          <>
            <section className={shared.section} aria-labelledby="life-days">
              <h3 id="life-days" className={shared.sectionTitle}>
                Which days are gone?
              </h3>
              <div
                className={styles.dayChips}
                role="group"
                aria-label="Days this week you can’t study"
              >
                {days.map((d) => (
                  <Tag key={d} shape="pill" pressed={gone.has(d)} onClick={() => toggleDay(d)}>
                    {dayName(d)} {Number(d.slice(8))}
                    {d === today ? ' (today)' : ''}
                  </Tag>
                ))}
              </div>
            </section>
            <section className={shared.section} aria-labelledby="life-less">
              <h3 id="life-less" className={shared.sectionTitle}>
                Or reduce the rest of the week to
              </h3>
              <SegmentedControl
                label="Share of study time left this week"
                value={factor}
                onValueChange={setFactor}
                options={FACTORS}
              />
              <p className={shared.hint}>
                Pick either, or both. Forge moves what no longer fits to the next open time.
              </p>
            </section>
            {phase.name === 'working' ? (
              <p className={shared.hint} role="status">
                <Spinner /> Working out the new week…
              </p>
            ) : null}
          </>
        ) : null}

        {phase.name === 'error' ? (
          <EmptyState
            size="sm"
            title="Couldn’t work out a new week"
            description="Nothing was changed. Try again."
            action={<Button onClick={() => setPhase({ name: 'choose' })}>Back</Button>}
          />
        ) : null}

        {phase.name === 'preview' ? <Preview proposal={phase.proposal} today={today} /> : null}
      </div>
    </Modal>
  )
}

function Preview({ proposal, today }: { proposal: PlanProposal; today: ISODate }) {
  const { moved, added, removed } = proposal.preview
  const empty = moved.length + added.length + removed.length === 0
  const end = parseProposalApply(proposal.apply)?.projectedEnd ?? null
  return (
    <section className={shared.section} aria-labelledby="life-preview">
      <h3 id="life-preview" className={shared.sectionTitle}>
        {empty ? 'Nothing needs to move' : proposal.title}
      </h3>
      <p className={shared.hint}>
        {empty
          ? 'This week already fits with less time. Nothing was changed.'
          : `The rest of this week is lighter and the work moves to the next open time.${end ? ` The plan now finishes around ${formatDay(end, today)}.` : ''}`}
      </p>
      {moved.length > 0 ? (
        <ul className={styles.moves} aria-label="Sessions that would move">
          {moved.slice(0, 12).map((m) => (
            <li key={m.key} className={styles.move}>
              <span className={styles.moveTitle}>{m.title}</span>
              <span className={styles.moveWhen}>
                {formatDay(m.from.doDate, today)} {timeLabel(m.from.startTime)} →{' '}
                {formatDay(m.to.doDate, today)} {timeLabel(m.to.startTime)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {moved.length > 12 ? (
        <p className={shared.hint}>and {plural(moved.length - 12, 'more session')}.</p>
      ) : null}
      {added.length > 0 || removed.length > 0 ? (
        <p className={shared.hint}>
          {added.length > 0 ? `${plural(added.length, 'session')} added. ` : ''}
          {removed.length > 0 ? `${plural(removed.length, 'session')} no longer needed.` : ''}
        </p>
      ) : null}
    </section>
  )
}
