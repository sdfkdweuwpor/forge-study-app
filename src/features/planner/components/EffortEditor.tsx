import { ChevronRight } from 'lucide-react'
import { useState, type Dispatch } from 'react'
import type { SelfRating } from '@/db/types'
import {
  courseEffort,
  RATING_LABELS,
  RATINGS,
  type PlannerAction,
  type PlannerCourse,
  type PlannerDraft,
} from '@/logic/plannerDraft'
import { effortLabel } from '@/logic/plannerEffort'
import { SELF_RATING_FACTORS } from '@/logic/scheduler'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { HoursField } from './HoursField'
import { NumberField } from './NumberField'
import shared from '../shared.module.css'
import styles from './EffortEditor.module.css'

const RATING_OPTIONS = RATINGS.map((r) => ({ value: r, label: RATING_LABELS[r] }))
const UNIT_RATING_OPTIONS = [
  { value: 'course', label: 'Same' },
  ...RATINGS.map((r) => ({ value: r, label: RATING_LABELS[r] })),
] as const

const ratingNote = (r: SelfRating): string => {
  const f = SELF_RATING_FACTORS[r]
  return f === 1 ? 'the full estimate' : `${Math.round(f * 100)}% of the estimate`
}

export interface CourseEffortCardProps {
  course: PlannerCourse
  draft: PlannerDraft
  dispatch: Dispatch<PlannerAction>
  error?: string | undefined
}

/**
 * One course's effort: its hours, or its CUs times the multiplier; how well it is already known; and,
 * folded away, each unit's own hours and rating. The minutes that will be planned show live.
 */
export function CourseEffortCard({ course, draft, dispatch, error }: CourseEffortCardProps) {
  const [open, setOpen] = useState(false)
  const effort = courseEffort(course, draft.cuMultiplier)
  const label = course.code ? `${course.code} ${course.title}` : course.title || 'Untitled course'
  const patch = (p: Partial<Omit<PlannerCourse, 'key' | 'units' | 'assessments'>>) =>
    dispatch({ type: 'patchCourse', key: course.key, patch: p })
  const byCus = course.effortBy === 'cus'
  const cusHours = (course.cus ?? 0) * draft.cuMultiplier

  return (
    <section className={styles.card} aria-label={label}>
      <header className={styles.head}>
        <h2 className={styles.title}>{label}</h2>
        <p className={styles.total} aria-live="polite">
          <strong className={shared.num}>{effortLabel(effort.totalMinutes)}</strong>
          <span> to plan</span>
        </p>
      </header>

      <div className={styles.controls}>
        <div className={shared.field}>
          <span className={shared.fieldLabel}>Estimate by</span>
          <div className={styles.inline}>
            <SegmentedControl
              size="sm"
              label={`Estimate ${label} by`}
              value={course.effortBy}
              onValueChange={(v) => patch({ effortBy: v })}
              options={[
                { value: 'hours', label: 'Hours' },
                { value: 'cus', label: 'CUs' },
              ]}
            />
            {byCus ? (
              <NumberField
                label={`Competency units of ${label}`}
                value={course.cus}
                placeholder="3"
                unit="CUs"
                above={0}
                max={100}
                nullable
                invalidText="Try 3 or 4.5"
                onCommit={(cus) => patch({ cus })}
              />
            ) : (
              <HoursField
                label={`Hours for ${label}`}
                minutes={course.hours === null ? null : Math.round(course.hours * 60)}
                placeholder="40"
                onCommit={(m) => patch({ hours: m === null ? null : m / 60 })}
              />
            )}
          </div>
          {byCus ? (
            <p className={shared.hint}>
              {course.cus
                ? `${course.cus} CUs × ${draft.cuMultiplier} h = ${cusHours} h`
                : 'Enter the CUs.'}
            </p>
          ) : null}
        </div>

        <div className={shared.field}>
          <span className={shared.fieldLabel}>How well do you know it?</span>
          <SegmentedControl
            size="sm"
            label={`How well you know ${label}`}
            value={course.rating}
            onValueChange={(rating) =>
              dispatch({ type: 'setCourseRating', courseKey: course.key, rating })
            }
            options={RATING_OPTIONS}
          />
          <p className={shared.hint}>Plans {ratingNote(course.rating)}.</p>
        </div>
      </div>
      {error ? (
        <p className={shared.error} role="alert">
          {error}
        </p>
      ) : null}

      {course.units.length > 0 ? (
        <div className={styles.units}>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={open}
            aria-controls={`effort-units-${course.key}`}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight size={14} aria-hidden="true" data-open={open || undefined} />
            Fine-tune {course.units.length} {course.units.length === 1 ? 'unit' : 'units'}
          </button>
          {open ? (
            <ul id={`effort-units-${course.key}`} className={styles.unitList}>
              {course.units.map((u, i) => (
                <li key={u.key} className={styles.unit}>
                  <span className={styles.unitTitle}>{u.title || 'Untitled unit'}</span>
                  <HoursField
                    label={`Hours for ${u.title || 'unit'}`}
                    minutes={u.minutes}
                    placeholder={
                      effort.units[i] && u.minutes === null
                        ? String(Math.round((effort.units[i].baseMinutes / 60) * 10) / 10)
                        : ''
                    }
                    onCommit={(m) =>
                      dispatch({
                        type: 'patchUnit',
                        courseKey: course.key,
                        key: u.key,
                        patch: { minutes: m },
                      })
                    }
                  />
                  <SegmentedControl
                    size="sm"
                    label={`How well you know ${u.title || 'the unit'}`}
                    value={u.rating ?? 'course'}
                    onValueChange={(v) =>
                      dispatch({
                        type: 'patchUnit',
                        courseKey: course.key,
                        key: u.key,
                        patch: { rating: v === 'course' ? null : v },
                      })
                    }
                    options={UNIT_RATING_OPTIONS}
                  />
                  <span className={styles.unitMinutes}>
                    {effortLabel(effort.units[i]?.minutes ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
