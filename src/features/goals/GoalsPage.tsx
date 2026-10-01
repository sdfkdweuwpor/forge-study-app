/**
 * `/goals`: the goals list (BRIEF §5.4). One row per goal: icon, title, how much of the work is done, the
 * projected finish against the target, and CUs this term. Creating a goal is the planner's page,
 * `/goals/new` (see `newGoal.ts`).
 */
import { MoreHorizontal, ExternalLink, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useToday } from '@/app/hooks/useToday'
import { Link, navigate } from '@/app/router'
import { useShortcutHandler, useShortcutScope } from '@/app/shortcuts'
import { DEFAULT_ICON } from '@/logic/goalDraft'
import { percent, plural, summarizeFinish, termProgress } from '@/logic/goalDisplay'
import { formatHours } from '@/logic/goalDisplay'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { IconButton } from '@/ui/IconButton'
import { ProgressBar } from '@/ui/ProgressBar'
import { useGoalActions } from './actions'
import { FinishLine } from './FinishLine'
import { ImportGoalButton } from './import'
import { NewGoalButton } from './NewGoalButton'
import { openNewGoalFlow } from './newGoal'
import { useGoalOverviews, type GoalOverview } from './queries'
import { GoalsEmpty, GoalsError, GoalsSkeleton } from './states'
import styles from './GoalsPage.module.css'

function GoalRow({ overview, today }: { overview: GoalOverview; today: string }) {
  const { goal, courses, work } = overview
  const actions = useGoalActions()
  const done = percent(work.doneMinutes, work.totalMinutes)
  const finish = summarizeFinish(goal, today)
  const term = termProgress(goal.terms, courses, today)
  const cus = courses.reduce((sum, c) => sum + (c.cus ?? 0), 0)
  const open = courses.filter((c) => c.status !== 'done').length
  const detailLine = [
    finish.target,
    term !== null && term.total > 0 ? `${term.done} of ${term.total} CUs this term` : null,
  ]
    .filter((s) => s !== null)
    .join(' · ')

  const items: MenuEntry[] = [
    {
      id: 'open',
      label: 'Open',
      icon: <ExternalLink />,
      onSelect: () => navigate('goal', { goalId: goal.id }),
    },
    { type: 'separator', id: 'sep' },
    {
      id: 'trash',
      label: 'Move to trash',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => void actions.trashGoal(goal),
    },
  ]

  return (
    <li className={styles.item}>
      <span className={styles.icon} aria-hidden="true">
        {goal.icon || DEFAULT_ICON}
      </span>
      <div className={styles.main}>
        <h2 className={styles.title}>
          <Link to="goal" params={{ goalId: goal.id }} className={styles.link}>
            {goal.title}
          </Link>
        </h2>
        <p className={styles.sub}>
          {plural(courses.length, 'course')}
          {cus > 0 ? ` · ${cus} CUs` : ''}
          {courses.length > 0 && open < courses.length ? ` · ${open} to go` : ''}
        </p>
        <div className={styles.progress}>
          <ProgressBar
            value={done}
            size="sm"
            label={`${goal.title} hours done`}
            valueText={`${done}% of ${formatHours(work.totalMinutes)} hours done`}
          />
          <span className={styles.percent}>{done}% of hours done</span>
        </div>
        <div className={styles.meta}>
          <FinishLine summary={finish} size="sm" detail={false} />
          {detailLine !== '' ? <p className={styles.term}>{detailLine}</p> : null}
        </div>
      </div>
      <div className={styles.actions}>
        <Dropdown
          label={`Actions for ${goal.title}`}
          align="end"
          items={items}
          trigger={(p) => (
            <IconButton
              {...p}
              className={styles.more}
              label={`Actions for ${goal.title}`}
              icon={<MoreHorizontal />}
              size="sm"
              tooltip={false}
            />
          )}
        />
      </div>
    </li>
  )
}

function GoalsScreen() {
  const today = useToday()
  const overviews = useGoalOverviews()

  // The list's own keys: `n` starts a goal (the planner, at /goals/new).
  useShortcutScope('goal')
  useShortcutHandler('goals.new', () => openNewGoalFlow())

  const body = useMemo(() => {
    if (overviews === undefined) return <GoalsSkeleton />
    if (overviews.length === 0) return <GoalsEmpty />
    return (
      <ul className={styles.list} aria-label="Goals">
        {overviews.map((o) => (
          <GoalRow key={o.goal.id} overview={o} today={today} />
        ))}
      </ul>
    )
  }, [overviews, today])

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Goals</h1>
        {/* An empty list offers both in its empty state; the header keeps out of the way. */}
        {overviews === undefined || overviews.length > 0 ? (
          <div className={styles.headerActions}>
            <ImportGoalButton />
            <NewGoalButton showKey />
          </div>
        ) : null}
      </header>
      {body}
    </div>
  )
}

export default function GoalsPage() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <div className={styles.root}>
          <header className={styles.header}>
            <h1 className={styles.heading}>Goals</h1>
          </header>
          <GoalsError onRetry={reset} />
        </div>
      )}
    >
      <GoalsScreen />
    </ErrorBoundary>
  )
}
