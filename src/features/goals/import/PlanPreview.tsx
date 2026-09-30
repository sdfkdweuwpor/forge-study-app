import { format } from 'date-fns'
import { fromISODate } from '@/logic/dates'
import type { ImportPreview, PreviewCourse } from '@/logic/planImport'
import { Tag } from '@/ui/Tag'
import styles from './PlanPreview.module.css'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const day = (d: string): string => format(fromISODate(d), 'MMM d, yyyy')
const hours = (h: number): string => `${Math.round(h * 10) / 10}`

const CHANGE_TAG: Record<PreviewCourse['change'], { label: string; color: 'green' | 'blue' | 'gray' }> = {
  new: { label: 'New', color: 'green' },
  update: { label: 'Updated', color: 'blue' },
  same: { label: 'No change', color: 'gray' },
}

/**
 * What an import would do, before it does it: the goal, then one row per course. For a merge the rows
 * say whether each course is new, updated (and what changes) or already there.
 */
export function PlanPreview({ preview }: { preview: ImportPreview }) {
  const { goal, courses, totals, mode } = preview
  const merge = mode === 'merge'

  return (
    <div className={styles.preview}>
      <section aria-labelledby="import-preview-goal" className={styles.goal}>
        <h3 id="import-preview-goal" className={styles.heading}>
          {merge ? 'Goal' : 'New goal'}
        </h3>
        <p className={styles.goalTitle}>
          <span aria-hidden="true">{goal.icon}</span> {goal.title}
        </p>
        {merge ? <p className={styles.note}>The goal keeps its name and icon.</p> : null}
        <dl className={styles.facts}>
          <div>
            <dt>Target date</dt>
            <dd>{goal.targetDate ? day(goal.targetDate) : 'None'}</dd>
          </div>
          <div>
            <dt>Term</dt>
            <dd>{goal.term ? goal.term.label : 'None'}</dd>
          </div>
          <div>
            <dt>Study time</dt>
            <dd>
              {goal.availability}
              <span className={styles.muted}> · {goal.weeklyHours} a week</span>
              {goal.availabilityIsDefault ? (
                <span className={styles.muted}>. The plan gave none, so this is a starting point you can change.</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Days off</dt>
            <dd>{goal.daysOff === 'no days off' ? 'None' : goal.daysOff}</dd>
          </div>
        </dl>
        {preview.goalChanges.length > 0 ? (
          <>
            <h4 className={styles.subheading}>Changes to the goal</h4>
            <ul className={styles.changes}>
              {preview.goalChanges.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section aria-labelledby="import-preview-courses" className={styles.courses}>
        <h3 id="import-preview-courses" className={styles.heading}>
          Courses
        </h3>
        <div className={styles.tableWrap} role="region" aria-label="Scrollable course table">
          <table className={styles.table} aria-label="Courses in this plan">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Course</th>
                <th scope="col" className={styles.num}>
                  CUs
                </th>
                <th scope="col">Type</th>
                <th scope="col" className={styles.num}>
                  Hours
                </th>
                <th scope="col" className={styles.num}>
                  Units
                </th>
                <th scope="col">Prerequisites</th>
                {merge ? <th scope="col">Status</th> : null}
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => {
                const tag = CHANGE_TAG[c.change]
                return (
                  <tr key={c.code}>
                    <th scope="row" className={styles.code}>
                      {c.code}
                    </th>
                    <td className={styles.name}>{c.name}</td>
                    <td className={styles.num}>{c.cus ?? '–'}</td>
                    <td>{c.type ?? '–'}</td>
                    <td className={styles.num}>{hours(c.hours)}</td>
                    <td className={styles.num}>
                      {c.unitCount}
                      {merge && c.unitsAdded > 0 && c.change !== 'new' ? (
                        <span className={styles.muted}> (+{c.unitsAdded})</span>
                      ) : null}
                    </td>
                    <td>{c.prerequisites.length > 0 ? c.prerequisites.join(', ') : '–'}</td>
                    {merge ? (
                      <td>
                        <Tag color={tag.color} size="sm">
                          {tag.label}
                        </Tag>
                        {c.change === 'update' && c.changed.length + c.unitsUpdated + c.unitsAdded > 0 ? (
                          <span className={styles.changed}>
                            {[
                              ...c.changed,
                              ...(c.unitsAdded > 0 ? [`${plural(c.unitsAdded, 'new unit')}`] : []),
                              ...(c.unitsUpdated > 0 ? [`${plural(c.unitsUpdated, 'unit estimate')}`] : []),
                            ].join(', ')}
                          </span>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className={styles.totals}>
          {plural(totals.courses, 'course')} · {hours(totals.hours)} h
          {totals.cus > 0 ? ` · ${totals.cus} CUs` : ''}
          {totals.units > 0 ? ` · ${plural(totals.units, 'unit')}` : ''}
        </p>
        {merge ? (
          <p className={styles.note}>A dash means the plan does not say, so the goal keeps its current value.</p>
        ) : null}
        {totals.assessments > 0 ? (
          <p className={styles.note}>
            The plan also lists {plural(totals.assessments, 'assessment')}. This import does not save assessments yet.
          </p>
        ) : null}
      </section>
    </div>
  )
}
