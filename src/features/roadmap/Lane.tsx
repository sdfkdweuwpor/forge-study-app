/**
 * One goal's lane: its icon, title, % complete and finish on the left, and on the right its bar from
 * the start to the projected finish, with the days past the target hatched, course segments, assessment
 * markers and weekly milestone ticks. Clicking the lane opens the goal; the segments and markers take
 * keyboard focus and show a tooltip with dates and hours. Nothing here is red: a later finish is a
 * quiet hatched span and a sentence.
 */
import type { CSSProperties, MouseEvent, ReactElement } from 'react'
import { Link, navigate } from '@/app/router'
import { COURSE_STATUS_LABELS, formatDay, plural, summarizeFinish } from '@/logic/goalDisplay'
import { dayX, type LaneLayout, type RoadmapGoal, type Scale, type Span } from '@/logic/roadmap'
import type { GoalProjection } from '@/db/types'
import { ProgressBar } from '@/ui/ProgressBar'
import { Tooltip, type TooltipTriggerProps } from '@/ui/Tooltip'
import styles from './Lane.module.css'

const pct = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`

function spanStyle(span: Span): { left: string; width: string } {
  return { left: pct(span.x0), width: pct(span.x1 - span.x0) }
}

const MARKER_LABEL = { exam: 'Exam', project: 'Project', quiz: 'Quiz' } as const

interface LaneProps {
  goal: RoadmapGoal
  layout: LaneLayout
  scale: Scale
  today: string
  projection: GoalProjection | null
  status: 'active' | 'paused' | 'done' | 'archived'
  /** On the goal's own page: the track alone, with no title column and no click through to the goal. */
  inline?: boolean
}

/** A focusable stop with a tooltip; the accessible name is the tooltip text. */
function Stop({
  label,
  children,
}: {
  label: string
  children: (props: { 'aria-label': string; tabIndex: 0 }) => ReactElement<TooltipTriggerProps>
}) {
  return (
    <Tooltip content={label} describe={false} delay={150}>
      {children({ 'aria-label': label, tabIndex: 0 })}
    </Tooltip>
  )
}

export function Lane({
  goal,
  layout,
  scale,
  today,
  projection,
  status,
  inline = false,
}: LaneProps) {
  const finish = summarizeFinish({ projection, targetDate: goal.targetDate, status }, today)
  const open = () => navigate('goal', { goalId: goal.id })
  const onLaneClick = (e: MouseEvent) => {
    if (!e.defaultPrevented) open()
  }
  const day = (d: string) => formatDay(d, today)

  const barLabel =
    layout.finish === null
      ? `${goal.title}: no finish date yet`
      : `${goal.title}: ${day(goal.startDate)} to ${day(layout.finish)}, ${goal.percent}% complete`
  const barSpan = layout.bar
  const todayX = dayX(scale, today) + 0.5 / scale.days

  // The target and the assessment markers share one row of the track. They go in the DOM from left to
  // right, so Tab meets them in the order the eye does (the layout hands them over by course). The
  // "Target →" label at an edge rides above the bar, so it comes before it.
  const edge: ReactElement | null =
    layout.targetEdge && goal.targetDate ? (
      <Stop
        label={`Target ${day(goal.targetDate)}, ${layout.targetEdge === 'after' ? 'after' : 'before'} the months shown`}
      >
        {(a11y) => (
          <span
            {...a11y}
            className={styles.edge}
            data-side={layout.targetEdge}
            data-testid="lane-target-edge"
            role="img"
          >
            {layout.targetEdge === 'before' ? '← Target' : 'Target →'}
          </span>
        )}
      </Stop>
    ) : null
  const flags: { key: string; x: number; node: ReactElement }[] = []
  if (layout.target !== null && goal.targetDate !== null) {
    const targetX = layout.target
    flags.push({
      key: 'target',
      x: targetX,
      node: (
        <Stop key="target" label={`Target ${day(goal.targetDate)}`}>
          {(a11y) => (
            <span
              {...a11y}
              className={styles.targetMark}
              style={{ left: pct(targetX) }}
              data-testid="lane-target"
              role="img"
            />
          )}
        </Stop>
      ),
    })
  }
  for (const { assessment, x } of layout.markers) {
    flags.push({
      key: assessment.id,
      x,
      node: (
        <Stop
          key={assessment.id}
          label={`${MARKER_LABEL[assessment.kind]}: ${assessment.title}, ${
            assessment.date ? day(assessment.date) : ''
          }${assessment.done ? ', done' : ''}`}
        >
          {(a11y) => (
            <span
              {...a11y}
              className={styles.marker}
              style={{ left: pct(x) }}
              data-kind={assessment.kind}
              data-done={assessment.done || undefined}
              data-testid="lane-marker"
              role="img"
            />
          )}
        </Stop>
      ),
    })
  }
  flags.sort((a, b) => a.x - b.x)

  return (
    <section aria-label={`${goal.title} timeline`} className={styles.laneWrap}>
      {/* The whole lane opens the goal for a mouse; the title link is the keyboard's way in. */}
      <div
        role="presentation"
        className={styles.lane}
        data-inline={inline || undefined}
        onClick={inline ? undefined : onLaneClick}
      >
        {inline ? null : (
          <div className={styles.label}>
            <h2 className={styles.title}>
              <span className={styles.icon} aria-hidden="true">
                {goal.icon}
              </span>
              <Link to="goal" params={{ goalId: goal.id }} className={styles.link}>
                {goal.title}
              </Link>
            </h2>
            <div className={styles.progress}>
              <ProgressBar
                value={goal.percent}
                size="sm"
                label={`${goal.title} progress`}
                className={styles.bar}
              />
              <span className={styles.percent}>{goal.percent}% complete</span>
            </div>
            <p className={styles.finish} data-testid="lane-finish">
              {finish.headline}
            </p>
            {finish.target && finish.kind !== 'behind' ? (
              <p className={styles.target}>{finish.target}</p>
            ) : null}
          </div>
        )}

        <div className={styles.track} style={{ '--rows': layout.rowCount } as CSSProperties}>
          {scale.months.map((m) => (
            <span
              key={m.key}
              className={styles.gridline}
              style={{ left: pct(m.x) }}
              aria-hidden="true"
            />
          ))}
          <span className={styles.today} style={{ left: pct(todayX) }} aria-hidden="true" />

          {edge}

          {barSpan ? (
            <Stop label={barLabel}>
              {(a11y) => (
                <div
                  {...a11y}
                  className={styles.span}
                  style={spanStyle(barSpan)}
                  data-clip-start={barSpan.clipStart || undefined}
                  data-clip-end={barSpan.clipEnd || undefined}
                  data-testid="lane-bar"
                  role="img"
                >
                  <span
                    className={styles.spanFill}
                    style={{ width: `${Math.min(100, goal.percent)}%` }}
                  />
                </div>
              )}
            </Stop>
          ) : null}

          {layout.overrun && layout.finish ? (
            <Stop
              label={`Past the target: ${day(goal.targetDate ?? scale.from)} to ${day(layout.finish)}`}
            >
              {(a11y) => (
                <div
                  {...a11y}
                  className={styles.overrun}
                  style={spanStyle(layout.overrun as Span)}
                  data-clip-end={layout.overrun?.clipEnd || undefined}
                  data-testid="lane-overrun"
                  role="img"
                />
              )}
            </Stop>
          ) : null}

          {layout.ticks.map(({ milestone, x }) => (
            <span
              key={milestone.id}
              className={styles.tick}
              style={{ left: pct(x) }}
              title={`${milestone.title} · ${day(milestone.date)}`}
              role="img"
              aria-label={`Weekly milestone: ${milestone.title}, ${day(milestone.date)}`}
            />
          ))}

          {flags.map((flag) => flag.node)}

          <ul className={styles.courses} aria-label={`${goal.title} courses`}>
            {layout.courses.map(({ course, span, row }) => (
              <Stop
                key={course.id}
                label={`${[course.code, course.title].filter(Boolean).join(' ')}: ${day(course.start ?? '')} to ${day(course.end ?? '')}, ${course.hours} h, ${COURSE_STATUS_LABELS[course.status].toLowerCase()}`}
              >
                {(a11y) => (
                  <li
                    {...a11y}
                    className={styles.course}
                    style={{ ...spanStyle(span), '--row': row } as CSSProperties}
                    data-status={course.status}
                    data-clip-start={span.clipStart || undefined}
                    data-clip-end={span.clipEnd || undefined}
                    data-testid="lane-course"
                  >
                    <span className={styles.code}>{course.code ?? course.title}</span>
                  </li>
                )}
              </Stop>
            ))}
          </ul>

          {layout.before + layout.after > 0 ? (
            <p className={styles.offscreen}>
              {[
                layout.before > 0 ? `${plural(layout.before, 'course')} earlier` : null,
                layout.after > 0 ? `${plural(layout.after, 'course')} later` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
