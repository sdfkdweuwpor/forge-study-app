import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type Dispatch, type KeyboardEvent } from 'react'
import { newId } from '@/lib/ids'
import {
  parseUnits,
  prerequisiteOptions,
  type DraftCourse,
  type DraftErrors,
  type DraftGoal,
} from '@/logic/goalDraft'
import type { WizardAction } from '@/logic/goalWizard'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/Checkbox'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Textarea } from '@/ui/Textarea'
import { SortableList } from '../Sortable'
import styles from './wizard.module.css'

type CourseType = DraftCourse['courseType']

const TYPE_OPTIONS = [
  { value: '', label: '—', 'aria-label': 'Type not set' },
  { value: 'OA', label: 'OA', 'aria-label': 'OA exam' },
  { value: 'PA', label: 'PA', 'aria-label': 'PA project' },
  { value: 'OA+PA', label: 'Both', 'aria-label': 'OA and PA' },
] as const satisfies readonly { value: CourseType; label: string; 'aria-label': string }[]

interface RowProps {
  draft: DraftGoal
  course: DraftCourse
  index: number
  errors: DraftErrors
  dispatch: Dispatch<WizardAction>
  handle: React.ReactNode
  onEnterLast: () => void
}

function CourseRow({ draft, course, index, errors, dispatch, handle, onEnterLast }: RowProps) {
  const [open, setOpen] = useState(false)
  const at = `course:${course.key}`
  const before = prerequisiteOptions(draft.courses, course.key)
  const units = parseUnits(course.units).length
  const patch = (p: Partial<Omit<DraftCourse, 'key'>>) =>
    dispatch({ type: 'patchCourse', key: course.key, patch: p })
  const name = course.code.trim() || course.title.trim() || `course ${index + 1}`
  const isLast = index === draft.courses.length - 1
  const summary = [
    units > 0 ? `${units} ${units === 1 ? 'unit' : 'units'}` : null,
    course.prerequisiteKeys.length > 0
      ? `after ${course.prerequisiteKeys
          .map((k) => draft.courses.find((c) => c.key === k))
          .map((c) => c?.code.trim() || c?.title.trim() || '…')
          .join(', ')}`
      : null,
  ]
    .filter((s) => s !== null)
    .join(' · ')

  function onNameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.ctrlKey && !e.metaKey) {
      // Enter in the last row's name starts the next row; the flow's own Enter handling stays out.
      e.preventDefault()
      e.stopPropagation()
      if (isLast && course.title.trim() !== '') onEnterLast()
    }
  }

  return (
    <div className={styles.course}>
      <div className={styles.courseMain}>
        <span className={styles.handle}>{handle}</span>
        <Input
          size="sm"
          aria-label={`Code of course ${index + 1}`}
          placeholder="C182"
          maxLength={16}
          value={course.code}
          error={errors[`${at}:code`]}
          className={styles.cCode}
          onChange={(e) => patch({ code: e.target.value })}
        />
        <Input
          id={`course-name-${course.key}`}
          size="sm"
          aria-label={`Name of course ${index + 1}`}
          placeholder="Introduction to IT"
          value={course.title}
          error={errors[`${at}:title`]}
          className={styles.cName}
          onChange={(e) => patch({ title: e.target.value })}
          onKeyDown={onNameKey}
        />
        <Input
          size="sm"
          aria-label={`Estimated hours of course ${index + 1}`}
          placeholder="40"
          inputMode="decimal"
          value={course.hours}
          error={errors[`${at}:hours`]}
          className={styles.cHours}
          trailing={<span className={styles.unit}>h</span>}
          onChange={(e) => patch({ hours: e.target.value })}
        />
        <Input
          size="sm"
          aria-label={`Competency units of course ${index + 1}`}
          placeholder="3"
          inputMode="numeric"
          value={course.cus}
          error={errors[`${at}:cus`]}
          className={styles.cCus}
          trailing={<span className={styles.unit}>CUs</span>}
          onChange={(e) => patch({ cus: e.target.value })}
        />
        <IconButton
          size="sm"
          label={`Remove ${name}`}
          icon={<Trash2 />}
          className={styles.cRemove}
          onClick={() => dispatch({ type: 'removeCourse', key: course.key })}
        />
      </div>
      <div className={styles.courseSub}>
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={open}
          aria-controls={`course-more-${course.key}`}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={14} aria-hidden="true" data-open={open || undefined} />
          Units and prerequisites
          {summary !== '' ? <span className={styles.disclosureSummary}>{summary}</span> : null}
        </button>
        <SegmentedControl
          size="sm"
          label={`Type of ${name}`}
          options={TYPE_OPTIONS}
          value={course.courseType}
          className={styles.cType}
          onValueChange={(courseType) => patch({ courseType })}
        />
      </div>
      {open ? (
        <div id={`course-more-${course.key}`} className={styles.moreBody}>
          <Textarea
            label="Units or chapters"
            hint="One per line. Leave empty to plan the course as one block of study."
            minRows={3}
            maxRows={8}
            value={course.units}
            error={errors[`${at}:units`]}
            onChange={(e) => patch({ units: e.target.value })}
          />
          {before.length > 0 ? (
            <fieldset className={styles.prereqs}>
              <legend className={styles.fieldLabel}>Comes after</legend>
              {before.map((c) => (
                <Checkbox
                  key={c.key}
                  label={
                    [c.code.trim(), c.title.trim()].filter(Boolean).join(' ') || 'Untitled course'
                  }
                  checked={course.prerequisiteKeys.includes(c.key)}
                  onCheckedChange={() =>
                    dispatch({ type: 'togglePrerequisite', key: course.key, prerequisite: c.key })
                  }
                />
              ))}
            </fieldset>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export interface CoursesStepProps {
  draft: DraftGoal
  dispatch: Dispatch<WizardAction>
  errors: DraftErrors
  onLoadTemplate: () => void
}

/** Courses as rows you add inline and reorder by their handle; units and prerequisites are optional. */
export function CoursesStep({ draft, dispatch, errors, onLoadTemplate }: CoursesStepProps) {
  const focusKey = useRef<string | null>(null)
  const count = draft.courses.length

  // A row added from the keyboard gets the caret in its name.
  useEffect(() => {
    const key = focusKey.current
    if (key === null) return
    focusKey.current = null
    document.getElementById(`course-name-${key}`)?.focus()
  }, [count])

  function add() {
    const key = newId()
    focusKey.current = key
    dispatch({ type: 'addCourse', key })
  }

  return (
    <div className={styles.step}>
      {count === 0 ? (
        <div className={styles.emptyCourses}>
          <p className={styles.hint}>
            List the courses or milestones this goal is made of. Hours are what the plan is built
            from; CUs and OA or PA are for WGU.
          </p>
          <div className={styles.emptyActions}>
            <Button variant="primary" iconLeft={<Plus />} onClick={add}>
              Add a course
            </Button>
            <Button onClick={onLoadTemplate}>Load WGU template</Button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.courseHead} aria-hidden="true">
            <span />
            <span>Code</span>
            <span>Course</span>
            <span>Hours</span>
            <span>CUs</span>
            <span />
          </div>
          <SortableList
            items={draft.courses.map((c) => ({ id: c.key, course: c }))}
            nameOf={({ course }) => course.code.trim() || course.title.trim() || 'course'}
            onReorder={(keys) => dispatch({ type: 'reorderCourses', keys })}
            rowClassName={styles.courseItem}
            renderRow={({ course }, { handle }) => (
              <CourseRow
                draft={draft}
                course={course}
                index={draft.courses.indexOf(course)}
                errors={errors}
                dispatch={dispatch}
                handle={handle}
                onEnterLast={add}
              />
            )}
          />
          <div className={styles.courseActions}>
            <Button variant="ghost" size="sm" iconLeft={<Plus />} onClick={add}>
              Add course
            </Button>
          </div>
        </>
      )}
      {errors.courses ? (
        <p className={styles.error} role="alert">
          {errors.courses}
        </p>
      ) : null}
    </div>
  )
}
