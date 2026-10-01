/**
 * `/progress`: the Progress page (BRIEF §5.7). A header of four figures (streak, focus, tasks, level),
 * the year heatmap, then one section per chart in two columns (one on a phone), and whatever other
 * features add through the `progress.sections` slot. Every section reads its own data, so each has its
 * own loading, empty and error state, and one failing read leaves the rest of the page standing.
 * Brand-new users get one calm empty state instead of six empty charts.
 */
import { ChartColumn, CircleAlert } from 'lucide-react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useOverlays } from '@/app/providers/OverlayProvider'
import { Slot, useSlotCount } from '@/app/registry'
import { navigate } from '@/app/router'
import { useShortcutScope } from '@/app/shortcuts'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { useLifetimeTotals } from './queries'
import { AccuracySection } from './sections/AccuracySection'
import { BadgesSection } from './sections/BadgesSection'
import { FocusSection } from './sections/FocusSection'
import { HeatmapSection } from './sections/HeatmapSection'
import { HoursSection } from './sections/HoursSection'
import { SummarySection } from './sections/SummarySection'
import { TasksSection } from './sections/TasksSection'
import { TimeSection } from './sections/TimeSection'
import styles from './ProgressPage.module.css'

function ProgressEmpty() {
  const overlays = useOverlays()
  return (
    <EmptyState
      icon={<ChartColumn />}
      title="Your progress will grow here"
      description="Finish a focus session or check off a task and this page starts to fill in: a year of squares, the hours you focus best, and how your estimates compare with the time things take."
      action={
        <>
          <Button variant="primary" onClick={() => navigate('focus')}>
            Start focus
          </Button>
          <Button variant="secondary" onClick={() => overlays.open('quickAdd')}>
            Add a task
          </Button>
        </>
      }
    />
  )
}

function ProgressSkeleton() {
  return (
    <div className={styles.loading} role="status" aria-busy="true" aria-label="Loading progress">
      <Skeleton variant="block" height={64} />
      <Skeleton variant="block" height={150} />
      <div className={styles.skeletonPair}>
        <Skeleton variant="block" height={190} />
        <Skeleton variant="block" height={190} />
      </div>
    </div>
  )
}

function ProgressBody() {
  const totals = useLifetimeTotals()
  const extras = useSlotCount('progress.sections')

  if (totals === undefined) return <ProgressSkeleton />
  if (totals.sessions === 0 && totals.tasksDone === 0) return <ProgressEmpty />

  return (
    <>
      <SummarySection />
      <HeatmapSection />
      <div className={styles.grid}>
        <div className={styles.column}>
          <FocusSection />
          <TimeSection />
          <AccuracySection />
        </div>
        <div className={styles.column}>
          <TasksSection />
          <HoursSection />
          <BadgesSection />
        </div>
      </div>
      {extras > 0 && (
        <div className={styles.extras}>
          <Slot id="progress.sections" />
        </div>
      )}
    </>
  )
}

export default function ProgressPage() {
  useShortcutScope('progress')
  return (
    <div className={styles.page} data-testid="progress-page">
      <header className={styles.header}>
        <h1 className={styles.title}>Progress</h1>
        <p className={styles.lede}>Where your time went, and how it adds up.</p>
      </header>
      <ErrorBoundary
        fallback={(_error, reset) => (
          <EmptyState
            titleAs="h2"
            icon={<CircleAlert />}
            title="Couldn’t load your progress"
            description="Your data is safe on this device. Try again, or reload the page."
            action={
              <Button variant="secondary" onClick={reset}>
                Try again
              </Button>
            }
          />
        )}
      >
        <ProgressBody />
      </ErrorBoundary>
    </div>
  )
}
