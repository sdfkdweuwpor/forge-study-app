import { useMemo } from 'react'
import type { ISODate } from '@/db/types'
import { addDays } from '@/logic/dates'
import { estimateAccuracy } from '@/logic/stats'
import { accuracySentence } from '@/logic/statsLabels'
import { AccuracyScatter } from '@/ui/charts'
import { useAccuracyInputs } from '../queries'
import { ChartSkeleton, SectionBoundary } from './SectionStates'
import { useProgressEnv } from './useProgressEnv'
import styles from './sections.module.css'

const DAYS = 90

function AccuracyBody({ today }: { today: ISODate }) {
  const inputs = useAccuracyInputs(addDays(today, -(DAYS - 1)), today)
  const view = useMemo(() => {
    if (!inputs) return undefined
    const accuracy = estimateAccuracy(inputs.tasks, inputs.sessions)
    const titles = new Map(inputs.tasks.map((t) => [t.id, t.title]))
    return {
      accuracy,
      points: accuracy.points.map((p) => ({
        id: p.taskId,
        label: titles.get(p.taskId) ?? 'Task',
        planned: p.planned,
        actual: p.actual,
      })),
    }
  }, [inputs])
  if (!view) return <ChartSkeleton what="estimate accuracy" height={240} />

  const sentence = accuracySentence(view.accuracy)
  return (
    <>
      <AccuracyScatter
        title="Estimate accuracy"
        titleAs="h2"
        subtitle="Planned against actual pomodoros · last 90 days"
        points={view.points}
        empty={
          <p className={styles.note}>
            Give a task an estimate, focus on it and check it off: it’s compared with the time it
            took here.
          </p>
        }
      />
      {sentence && <p className={styles.note}>{sentence}</p>}
    </>
  )
}

/** Planned against actual pomodoros for finished tasks, and the share within ±20 %. */
export function AccuracySection() {
  const env = useProgressEnv()
  return (
    <section className={styles.section} aria-label="Estimate accuracy" data-section="accuracy">
      <SectionBoundary what="estimate accuracy">
        {env ? (
          <AccuracyBody today={env.today} />
        ) : (
          <ChartSkeleton what="estimate accuracy" height={240} />
        )}
      </SectionBoundary>
    </section>
  )
}
