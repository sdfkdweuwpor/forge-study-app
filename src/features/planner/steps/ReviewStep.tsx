import { ChevronRight, Plus, Smile, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type Dispatch } from 'react'
import type { ISODate } from '@/db/types'
import { newId } from '@/lib/ids'
import { plural } from '@/logic/goalDisplay'
import {
  courseEffort,
  draftEffort,
  type AssessmentKind,
  type DraftErrors,
  type PlannerAction,
  type PlannerAssessmentDraft,
  type PlannerCourse,
  type PlannerDraft,
  type PlannerUnit,
} from '@/logic/plannerDraft'
import { effortLabel } from '@/logic/plannerEffort'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/Checkbox'
import { DatePicker } from '@/ui/DatePicker'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { EmptyState } from '@/ui/EmptyState'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { EmojiGrid } from '@/ui/PageHeader'
import { Popover } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useToast } from '@/ui/Toast'
import { HoursField } from '../components/HoursField'
import { SortableList } from '../components/Sortable'
import shared from '../shared.module.css'
import styles from './ReviewStep.module.css'

export interface ReviewStepProps {
  draft: PlannerDraft
  dispatch: Dispatch<PlannerAction>
  errors: DraftErrors
  today: ISODate
}

const KIND_OPTIONS = [
  { value: 'exam', label: 'Exam' },
  { value: 'project', label: 'Project' },
  { value: 'quiz', label: 'Quiz' },
] as const satisfies readonly { value: AssessmentKind; label: string }[]

const shorten = (text: string, max = 40): string =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text

const courseName = (c: PlannerCourse): string =>
  [c.code, c.title].filter((s) => s.trim() !== '').join(' ') || 'Untitled course'

/**
 * The review screen: the whole outline, editable. Titles, hours and dates are edited in place, rows are
 * dragged (or moved with the keyboard on their handle) to reorder, deleted with an Undo, added, and
 * units can be marked optional (the first thing "cut scope" offers to drop). Nothing is scheduled here.
 */
export function ReviewStep({ draft, dispatch, errors, today }: ReviewStepProps) {
  const toast = useToast()
  const focusId = useRef<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    draft.courses.length > 4 ? new Set(draft.courses.slice(1).map((c) => c.key)) : new Set(),
  )

  // Move focus to a row that was just added.
  useEffect(() => {
    if (focusId.current === null) return
    const el = document.getElementById(focusId.current)
    if (el) {
      el.focus()
      focusId.current = null
    }
  }, [draft])

  const effort = draftEffort(draft)
  const units = draft.courses.reduce((n, c) => n + c.units.length, 0)
  const assessments = draft.courses.reduce((n, c) => n + c.assessments.length, 0)

  function addCourse() {
    const key = newId()
    dispatch({ type: 'addCourse', key })
    focusId.current = `course-title-${key}`
  }
  function addUnit(course: PlannerCourse, title?: string) {
    const key = newId()
    dispatch({ type: 'addUnit', courseKey: course.key, key, ...(title ? { title } : {}) })
    focusId.current = `unit-title-${key}`
    setCollapsed((s) => {
      if (!s.has(course.key)) return s
      const next = new Set(s)
      next.delete(course.key)
      return next
    })
  }
  function addAssessment(course: PlannerCourse) {
    const key = newId()
    dispatch({ type: 'addAssessment', courseKey: course.key, key })
    focusId.current = `assessment-title-${key}`
  }
  function removeCourse(course: PlannerCourse) {
    const index = draft.courses.findIndex((c) => c.key === course.key)
    dispatch({ type: 'removeCourse', key: course.key })
    toast.show({
      title: `Deleted ${shorten(courseName(course))}`,
      undo: () => dispatch({ type: 'insertCourse', index, course }),
    })
  }
  function removeUnit(course: PlannerCourse, unit: PlannerUnit) {
    dispatch({ type: 'removeUnit', courseKey: course.key, key: unit.key })
    toast.show({
      title: `Deleted “${shorten(unit.title || 'Untitled unit')}”`,
      undo: () => dispatch({ type: 'replaceCourse', course }),
    })
  }
  function removeAssessment(course: PlannerCourse, a: PlannerAssessmentDraft) {
    dispatch({ type: 'removeAssessment', courseKey: course.key, key: a.key })
    toast.show({
      title: `Deleted “${shorten(a.title || 'Untitled assessment')}”`,
      undo: () => dispatch({ type: 'replaceCourse', course }),
    })
  }

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className={shared.stack}>
      <div className={styles.titleRow}>
        <Popover
          label="Choose icon"
          align="start"
          trigger={(p) => (
            <button
              {...p}
              type="button"
              className={styles.iconButton}
              aria-label={`Icon: ${draft.icon}. Change`}
            >
              <span aria-hidden="true">{draft.icon || <Smile />}</span>
            </button>
          )}
        >
          {({ close }) => (
            <EmojiGrid
              current={draft.icon}
              onPick={(icon) => {
                dispatch({ type: 'patch', patch: { icon } })
                close()
              }}
            />
          )}
        </Popover>
        <Input
          label="Goal name"
          placeholder="B.S. Computer Science"
          value={draft.title}
          maxLength={120}
          error={errors.title}
          className={styles.titleInput}
          onChange={(e) => dispatch({ type: 'patch', patch: { title: e.target.value } })}
        />
      </div>

      <p className={shared.hint} aria-live="polite">
        {plural(draft.courses.length, 'course')}
        {units > 0 ? `, ${plural(units, 'unit')}` : ''}
        {assessments > 0 ? `, ${plural(assessments, 'assessment')}` : ''} ·{' '}
        <span className={shared.num}>{effortLabel(effort.totalMinutes)}</span> of study. Edit,
        reorder or delete anything: nothing is scheduled until you continue.
      </p>

      {draft.unparsed.length > 0 ? (
        <section className={styles.unparsed} aria-labelledby="review-unparsed">
          <h2 id="review-unparsed" className={shared.sectionTitle}>
            We couldn’t read these lines
          </h2>
          <ul>
            {draft.unparsed.map((u) => {
              const items: MenuEntry[] = draft.courses.map((c) => ({
                id: c.key,
                label: courseName(c),
                onSelect: () =>
                  dispatch({
                    type: 'unparsedToUnit',
                    line: u.line,
                    courseKey: c.key,
                    courseKeyNew: newId(),
                    unitKey: newId(),
                  }),
              }))
              return (
                <li key={u.line} className={styles.unparsedRow}>
                  <span className={styles.unparsedText}>
                    <span className={styles.lineNo}>Line {u.line}</span> {u.text}
                  </span>
                  <span className={shared.actions}>
                    {draft.courses.length > 1 ? (
                      <Dropdown
                        label={`Add “${shorten(u.text, 24)}” as a unit of…`}
                        align="end"
                        items={items}
                        trigger={(p) => (
                          <Button {...p} size="sm" iconLeft={<Plus />}>
                            Add as unit
                          </Button>
                        )}
                      />
                    ) : (
                      <Button
                        size="sm"
                        iconLeft={<Plus />}
                        onClick={() =>
                          dispatch({
                            type: 'unparsedToUnit',
                            line: u.line,
                            courseKey: draft.courses[0]?.key ?? null,
                            courseKeyNew: newId(),
                            unitKey: newId(),
                          })
                        }
                      >
                        Add as unit
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => dispatch({ type: 'dismissUnparsed', line: u.line })}
                    >
                      Ignore
                    </Button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {draft.courses.length === 0 ? (
        <EmptyState
          title="Nothing to review yet"
          description="Add a course, or go back and start from a template or a course list."
          action={
            <Button variant="primary" iconLeft={<Plus />} onClick={addCourse}>
              Add a course
            </Button>
          }
        />
      ) : (
        <>
          {errors.courses ? (
            <p className={shared.error} role="alert">
              {errors.courses}
            </p>
          ) : null}
          <SortableList
            items={draft.courses.map((c) => ({ id: c.key, course: c }))}
            aria-label="Courses"
            nameOf={(item) => courseName(item.course)}
            onReorder={(keys) => dispatch({ type: 'reorderCourses', keys })}
            rowClassName={styles.courseRow}
            renderRow={({ course }, { handle }) => {
              const open = !collapsed.has(course.key)
              const e = courseEffort(course, draft.cuMultiplier)
              const name = courseName(course)
              return (
                <section className={styles.course} aria-label={name}>
                  <div className={styles.courseHead}>
                    <span className={styles.handle}>{handle}</span>
                    <button
                      type="button"
                      className={styles.chevron}
                      aria-expanded={open}
                      aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
                      onClick={() => toggle(course.key)}
                    >
                      <ChevronRight size={16} aria-hidden="true" data-open={open || undefined} />
                    </button>
                    <Input
                      size="sm"
                      aria-label={`Code of ${name}`}
                      placeholder="C182"
                      maxLength={16}
                      value={course.code}
                      className={styles.code}
                      onChange={(ev) =>
                        dispatch({
                          type: 'patchCourse',
                          key: course.key,
                          patch: { code: ev.target.value },
                        })
                      }
                    />
                    <Input
                      id={`course-title-${course.key}`}
                      size="sm"
                      aria-label={`Title of ${name}`}
                      placeholder="Introduction to IT"
                      value={course.title}
                      error={errors[`course:${course.key}:title`]}
                      className={styles.courseTitle}
                      onChange={(ev) =>
                        dispatch({
                          type: 'patchCourse',
                          key: course.key,
                          patch: { title: ev.target.value },
                        })
                      }
                    />
                    <span className={styles.courseTotal} title="Study time planned for this course">
                      {effortLabel(e.totalMinutes)}
                    </span>
                    <span className={styles.courseDel}>
                      <IconButton
                        size="sm"
                        label={`Delete ${name}`}
                        icon={<Trash2 />}
                        onClick={() => removeCourse(course)}
                      />
                    </span>
                  </div>

                  {open ? (
                    <div className={styles.courseBody}>
                      {course.units.length > 0 ? (
                        <SortableList
                          items={course.units.map((u) => ({ id: u.key, unit: u }))}
                          aria-label={`Units of ${name}`}
                          nameOf={(item) => item.unit.title || 'Untitled unit'}
                          onReorder={(keys) =>
                            dispatch({ type: 'reorderUnits', courseKey: course.key, keys })
                          }
                          renderRow={({ unit }, state) => {
                            const i = course.units.findIndex((u) => u.key === unit.key)
                            const share = e.units[i]
                            return (
                              <div className={styles.unit}>
                                <span className={styles.handle}>{state.handle}</span>
                                <Input
                                  id={`unit-title-${unit.key}`}
                                  size="sm"
                                  aria-label={`Title of unit ${i + 1} of ${name}`}
                                  placeholder="Unit title"
                                  value={unit.title}
                                  error={errors[`unit:${unit.key}`]}
                                  className={styles.unitTitle}
                                  onChange={(ev) =>
                                    dispatch({
                                      type: 'patchUnit',
                                      courseKey: course.key,
                                      key: unit.key,
                                      patch: { title: ev.target.value },
                                    })
                                  }
                                  onKeyDown={(ev) => {
                                    if (
                                      ev.key === 'Enter' &&
                                      !ev.nativeEvent.isComposing &&
                                      i === course.units.length - 1 &&
                                      unit.title.trim() !== ''
                                    ) {
                                      ev.preventDefault()
                                      addUnit(course)
                                    }
                                  }}
                                />
                                <span className={styles.unitHours}>
                                  <HoursField
                                    label={`Hours for ${unit.title || `unit ${i + 1}`}`}
                                    minutes={unit.minutes}
                                    placeholder={
                                      unit.minutes === null && share && share.baseMinutes > 0
                                        ? String(Math.round((share.baseMinutes / 60) * 10) / 10)
                                        : '—'
                                    }
                                    onCommit={(m) =>
                                      dispatch({
                                        type: 'patchUnit',
                                        courseKey: course.key,
                                        key: unit.key,
                                        patch: { minutes: m },
                                      })
                                    }
                                  />
                                </span>
                                <span className={styles.unitOpt}>
                                  <Checkbox
                                    label="Optional"
                                    checked={unit.optional}
                                    onCheckedChange={(optional) =>
                                      dispatch({
                                        type: 'patchUnit',
                                        courseKey: course.key,
                                        key: unit.key,
                                        patch: { optional },
                                      })
                                    }
                                  />
                                </span>
                                <span className={styles.unitDel}>
                                  <IconButton
                                    size="sm"
                                    label={`Delete ${unit.title || `unit ${i + 1}`}`}
                                    icon={<Trash2 />}
                                    onClick={() => removeUnit(course, unit)}
                                  />
                                </span>
                              </div>
                            )
                          }}
                        />
                      ) : (
                        <p className={shared.hint}>
                          No units. Forge plans this course as one block of{' '}
                          {effortLabel(e.totalMinutes)}, or add units to split it up.
                        </p>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        iconLeft={<Plus />}
                        className={styles.add}
                        onClick={() => addUnit(course)}
                      >
                        Add a unit
                      </Button>

                      {course.assessments.length > 0 ? (
                        <ul className={styles.assessments} aria-label={`Assessments of ${name}`}>
                          {course.assessments.map((a, i) => (
                            <li key={a.key} className={styles.assessment}>
                              <SegmentedControl
                                size="sm"
                                label={`Kind of assessment ${i + 1} of ${name}`}
                                value={a.kind}
                                options={KIND_OPTIONS}
                                onValueChange={(kind) =>
                                  dispatch({
                                    type: 'patchAssessment',
                                    courseKey: course.key,
                                    key: a.key,
                                    patch: { kind },
                                  })
                                }
                              />
                              <Input
                                id={`assessment-title-${a.key}`}
                                size="sm"
                                aria-label={`Title of assessment ${i + 1} of ${name}`}
                                placeholder="Objective assessment"
                                value={a.title}
                                className={styles.assessmentTitle}
                                onChange={(ev) =>
                                  dispatch({
                                    type: 'patchAssessment',
                                    courseKey: course.key,
                                    key: a.key,
                                    patch: { title: ev.target.value },
                                  })
                                }
                              />
                              <DatePicker
                                size="sm"
                                label={`Date of ${a.title || `assessment ${i + 1}`}`}
                                value={a.date}
                                today={today}
                                error={errors[`assessment:${a.key}`]}
                                onChange={(date) =>
                                  dispatch({
                                    type: 'patchAssessment',
                                    courseKey: course.key,
                                    key: a.key,
                                    patch: { date },
                                  })
                                }
                              />
                              <IconButton
                                size="sm"
                                label={`Delete ${a.title || `assessment ${i + 1}`}`}
                                icon={<Trash2 />}
                                onClick={() => removeAssessment(course, a)}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        iconLeft={<Plus />}
                        className={styles.add}
                        onClick={() => addAssessment(course)}
                      >
                        Add an exam, project or quiz
                      </Button>
                    </div>
                  ) : (
                    <p className={styles.collapsedNote}>
                      {[
                        plural(course.units.length, 'unit'),
                        course.assessments.length > 0
                          ? plural(course.assessments.length, 'assessment')
                          : null,
                      ]
                        .filter((s) => s !== null)
                        .join(' · ')}
                    </p>
                  )}
                </section>
              )
            }}
          />
          <div>
            <Button variant="secondary" iconLeft={<Plus />} onClick={addCourse}>
              Add a course
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
