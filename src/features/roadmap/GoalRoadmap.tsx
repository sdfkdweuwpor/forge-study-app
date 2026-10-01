import { useMemo } from 'react'
import { useToday } from '@/app/hooks/useToday'
import type { ID } from '@/db/types'
import { layoutRoadmap, monthScale } from '@/logic/roadmap'
import { Lane } from './Lane'
import { MonthRow } from './MonthRow'
import { useRoadmapGoal } from './queries'
import { useZoom } from './zoom'

/**
 * One goal's Roadmap lane, for the goal page (PLAN 5D): its courses, assessments, target and finish on
 * the same months as the Roadmap (and its zoom), without the title column the page already has.
 */
export function GoalRoadmap({ goalId }: { goalId: ID }) {
  const today = useToday()
  const entry = useRoadmapGoal(goalId)
  const [zoom] = useZoom()
  const scale = useMemo(() => monthScale(today, zoom), [today, zoom])
  const layout = useMemo(
    () => (entry ? layoutRoadmap([entry.input], scale)[0] : undefined),
    [entry, scale],
  )
  if (!entry || !layout || entry.input.courses.length === 0) return null
  return (
    <div>
      <MonthRow scale={scale} today={today} inline />
      <Lane
        goal={entry.input}
        layout={layout}
        scale={scale}
        today={today}
        projection={entry.goal.projection}
        status={entry.goal.status}
        inline
      />
    </div>
  )
}
