/**
 * `/roadmap`: every active goal over the coming months on one timeline. Header with the zoom (3 / 6 / 12
 * months), a month scale, one lane per goal, and a small legend. On a phone the lanes become a vertical
 * list, each with a compact mini-timeline.
 */
import { useMemo } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useToday } from '@/app/hooks/useToday'
import { dayX, layoutRoadmap, monthScale, ZOOMS } from '@/logic/roadmap'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Kbd } from '@/ui/Kbd'
import { Lane } from './Lane'
import { useRoadmapGoals } from './queries'
import { RoadmapEmpty, RoadmapError, RoadmapSkeleton } from './states'
import { useZoom } from './zoom'
import styles from './RoadmapPage.module.css'

function Legend() {
  return (
    <ul className={styles.legend} aria-label="Legend">
      <li>
        <span className={styles.keyBar} aria-hidden="true" />
        Start to projected finish
      </li>
      <li>
        <span className={styles.keyHatch} aria-hidden="true" />
        After the target date
      </li>
      <li>
        <span className={styles.keyExam} aria-hidden="true" />
        Exam
      </li>
      <li>
        <span className={styles.keyProject} aria-hidden="true" />
        Project
      </li>
      <li>
        <span className={styles.keyTick} aria-hidden="true" />
        Weekly milestone
      </li>
      <li>
        <span className={styles.keyToday} aria-hidden="true" />
        Today
      </li>
    </ul>
  )
}

function RoadmapScreen() {
  const today = useToday()
  const goals = useRoadmapGoals()
  const [zoom, setZoom] = useZoom()
  const scale = useMemo(() => monthScale(today, zoom), [today, zoom])
  const lanes = useMemo(
    () =>
      goals
        ? layoutRoadmap(
            goals.map((g) => g.input),
            scale,
          )
        : [],
    [goals, scale],
  )
  const todayX = dayX(scale, today) + 0.5 / scale.days

  return (
    <>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Roadmap</h1>
          <p className={styles.subtitle}>
            Your goals over the months, and when each is on course to finish.
          </p>
        </div>
        <div className={styles.zoom}>
          <SegmentedControl
            label="Zoom"
            size="sm"
            value={String(zoom) as '3' | '6' | '12'}
            onValueChange={(v) => setZoom(ZOOMS.find((z) => String(z) === v) ?? 6)}
            options={[
              { value: '3', label: '3 months' },
              { value: '6', label: '6 months' },
              { value: '12', label: '12 months' },
            ]}
          />
          <span className={styles.hint} aria-hidden="true">
            <Kbd keys="z" size="sm" />
          </span>
        </div>
      </header>

      {goals === undefined ? (
        <RoadmapSkeleton />
      ) : goals.length === 0 ? (
        <RoadmapEmpty />
      ) : (
        <div className={styles.chart}>
          <div className={styles.monthRow} aria-hidden="true">
            <div className={styles.months}>
              {scale.months.map((m) => (
                <span key={m.key} className={styles.month} style={{ left: `${m.x * 100}%` }}>
                  {m.label}
                </span>
              ))}
              <span className={styles.todayLabel} style={{ left: `${todayX * 100}%` }}>
                Today
              </span>
            </div>
          </div>
          {goals.map((entry, i) => {
            const layout = lanes[i]
            if (!layout) return null
            return (
              <Lane
                key={entry.goal.id}
                goal={entry.input}
                layout={layout}
                scale={scale}
                today={today}
                projection={entry.goal.projection}
                status={entry.goal.status}
              />
            )
          })}
          <Legend />
        </div>
      )}
    </>
  )
}

export default function RoadmapPage() {
  return (
    <div className={styles.root}>
      <ErrorBoundary
        fallback={(_error, reset) => (
          <>
            <header className={styles.header}>
              <h1 className={styles.title}>Roadmap</h1>
            </header>
            <RoadmapError onRetry={reset} />
          </>
        )}
      >
        <RoadmapScreen />
      </ErrorBoundary>
    </div>
  )
}
