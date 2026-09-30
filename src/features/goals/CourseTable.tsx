import {
  Check,
  Circle,
  CircleCheckBig,
  CircleDot,
  ExternalLink,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, navigate } from '@/app/router'
import type { ID, ISODate, Milestone } from '@/db/types'
import { dayOf } from '@/logic/dates'
import {
  COURSE_STATUS_LABELS,
  COURSE_TYPE_LABELS,
  courseLabel,
  formatDay,
  formatHours,
} from '@/logic/goalDisplay'
import { HOURS_MAX, parseCus, parseHours } from '@/logic/goalDraft'
import type { CourseWork, GoalWork } from '@/logic/scheduler'
import { Button } from '@/ui/Button'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { EmptyState } from '@/ui/EmptyState'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { Kbd } from '@/ui/Kbd'
import { useGoalActions } from './actions'
import { ChoiceField, type Choice } from './ChoiceField'
import { InlineField } from './InlineField'
import { SortableList } from './Sortable'
import styles from './CourseTable.module.css'

type Status = Milestone['status']
type CourseType = '' | NonNullable<Milestone['courseType']>

const STATUS_MARK: Record<Status, React.ReactNode> = {
  todo: <Circle className={styles.markTodo} size={14} aria-hidden="true" />,
  active: <CircleDot className={styles.markActive} size={14} aria-hidden="true" />,
  done: <CircleCheckBig className={styles.markDone} size={14} aria-hidden="true" />,
}

const STATUS_CHOICES: readonly Choice<Status>[] = (['todo', 'active', 'done'] as const).map(
  (s) => ({
    value: s,
    label: COURSE_STATUS_LABELS[s],
    mark: STATUS_MARK[s],
  }),
)

const TYPE_CHOICES: readonly Choice<CourseType>[] = [
  { value: '', label: 'Not set' },
  { value: 'OA', label: COURSE_TYPE_LABELS.OA },
  { value: 'PA', label: COURSE_TYPE_LABELS.PA },
  { value: 'OA+PA', label: COURSE_TYPE_LABELS['OA+PA'] },
]

interface RowProps {
  goalId: ID
  course: Milestone
  work: CourseWork | undefined
  today: ISODate
}

/** The cells after the handle: shared between the wide table and the stacked cards (CSS decides which). */
function CourseCells({ goalId, course, work, today }: RowProps) {
  const actions = useGoalActions()
  const label = courseLabel(course)
  const total = work?.totalMinutes ?? course.estimateHours * 60
  const done = work?.doneMinutes ?? 0
  const dueText =
    course.status === 'done'
      ? course.completedAt !== null
        ? `Done ${formatDay(dayOf(course.completedAt), today)}`
        : 'Done'
      : course.projectedEnd !== null
        ? formatDay(course.projectedEnd, today)
        : '—'

  const menu: MenuEntry[] = [
    {
      id: 'open',
      label: 'Open',
      icon: <ExternalLink />,
      onSelect: () => navigate('course', { goalId, courseId: course.id }),
    },
    course.status === 'done'
      ? {
          id: 'reopen',
          label: 'Mark not complete',
          icon: <RotateCcw />,
          onSelect: () => void actions.setCourseStatus(course, 'active'),
        }
      : {
          id: 'complete',
          label: 'Mark complete',
          icon: <Check />,
          onSelect: () => void actions.setCourseStatus(course, 'done'),
        },
    { type: 'separator', id: 'sep' },
    {
      id: 'trash',
      label: 'Move to trash',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => void actions.trashCourse(course),
    },
  ]

  return (
    <>
      <div className={styles.lead}>
        <div role="cell" className={styles.cell} data-cell="status">
          <ChoiceField
            label={`Status of ${label}`}
            value={course.status}
            choices={STATUS_CHOICES}
            quiet
            onChange={(status) => void actions.setCourseStatus(course, status)}
          />
        </div>
        <div role="cell" className={styles.cell} data-cell="code">
          <InlineField
            label={`Code of ${course.title}`}
            value={course.code ?? ''}
            placeholder="Code"
            maxLength={16}
            size={8}
            onCommit={(code) => void actions.updateCourse(course.id, { code })}
          />
        </div>
        <div
          role="cell"
          className={styles.cell}
          data-cell="name"
          data-done={course.status === 'done' || undefined}
        >
          <Link to="course" params={{ goalId, courseId: course.id }} className={styles.name}>
            {course.title}
          </Link>
        </div>
      </div>
      <div className={styles.meta}>
        <div role="cell" className={styles.cell} data-cell="cus" data-label="CUs">
          <InlineField
            label={`Competency units of ${label}`}
            value={course.cus === null ? '' : String(course.cus)}
            placeholder="—"
            inputMode="numeric"
            size={4}
            align="end"
            accept={(text) => parseCus(text).ok}
            onCommit={(text) => {
              const parsed = parseCus(text)
              if (parsed.ok) void actions.updateCourse(course.id, { cus: parsed.value })
            }}
          />
        </div>
        <div role="cell" className={styles.cell} data-cell="type" data-label="Type">
          <ChoiceField
            label={`Course type of ${label}`}
            value={(course.courseType ?? '') as CourseType}
            choices={TYPE_CHOICES}
            display={
              <span
                className={styles.typeText}
                data-empty={course.courseType === null || undefined}
              >
                {course.courseType === null ? '—' : COURSE_TYPE_LABELS[course.courseType]}
              </span>
            }
            quiet
            onChange={(type) =>
              void actions.updateCourse(course.id, { courseType: type === '' ? null : type })
            }
          />
        </div>
        <div role="cell" className={styles.cell} data-cell="hours" data-label="Hours">
          <InlineField
            label={`Estimated hours of ${label}`}
            value={String(course.estimateHours)}
            display={
              <>
                {formatHours(done)} / {formatHours(total)} h
              </>
            }
            inputMode="decimal"
            size={6}
            align="end"
            accept={(text) => parseHours(text) !== null}
            onCommit={(text) => {
              const hours = parseHours(text)
              if (hours !== null) void actions.updateCourse(course.id, { estimateHours: hours })
            }}
          />
        </div>
        <div
          role="cell"
          className={styles.cell}
          data-cell="due"
          data-label="Due"
          data-tone={course.status === 'done' ? 'done' : undefined}
        >
          {dueText}
        </div>
      </div>
      <div role="cell" className={styles.cell} data-cell="menu">
        <Dropdown
          label={`Actions for ${label}`}
          align="end"
          items={menu}
          trigger={(p) => (
            <IconButton
              {...p}
              className={styles.more}
              label={`Actions for ${label}`}
              icon={<MoreHorizontal />}
              size="xs"
              tooltip={false}
            />
          )}
        />
      </div>
    </>
  )
}

interface AddFormProps {
  goalId: ID
  onDone: () => void
}

/** A new course in one line: code, name, hours. Enter adds it, Esc closes the form. */
function AddCourseForm({ goalId, onDone }: AddFormProps) {
  const actions = useGoalActions()
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [hours, setHours] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    if (title.trim() === '') return setError('Name the course.')
    const h = parseHours(hours)
    if (h === null) return setError(`Estimated hours, from 0.5 to ${HOURS_MAX}.`)
    setSaving(true)
    const added = await actions.addCourse(goalId, { title, code, estimateHours: h })
    setSaving(false)
    if (!added) return
    setCode('')
    setTitle('')
    setHours('')
    setError(null)
    // Ready for the next one: the person is usually typing a whole list.
    nameRef.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onDone()
    }
  }

  return (
    <form className={styles.addForm} onSubmit={submit} aria-label="New course">
      <div className={styles.addFields}>
        <Input
          size="sm"
          aria-label="Course code"
          placeholder="C182"
          maxLength={16}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={styles.addCode}
          onKeyDown={onKeyDown}
        />
        <Input
          ref={nameRef as never}
          size="sm"
          aria-label="Course name"
          placeholder="Introduction to IT"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setError(null)
          }}
          className={styles.addName}
          onKeyDown={onKeyDown}
        />
        <Input
          size="sm"
          aria-label="Estimated hours"
          placeholder="Hours"
          inputMode="decimal"
          value={hours}
          onChange={(e) => {
            setHours(e.target.value)
            setError(null)
          }}
          className={styles.addHours}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className={styles.addActions}>
        <Button type="submit" size="sm" variant="primary" loading={saving}>
          Add course
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p className={styles.addError} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}

export interface CourseTableProps {
  goalId: ID
  /** In course order. */
  courses: readonly Milestone[]
  work: GoalWork
  today: ISODate
  /** Bump to open the add form (the `c` shortcut and its palette command). */
  addRequest: number
}

/**
 * The course list as a database table (BRIEF §5.4): status, code, name, CUs, type, hours done of total
 * and due date. Status, code, CUs, type and hours edit in place; the row's `⋮⋮` handle reorders (the
 * schedule follows the order) and its `…` menu opens, completes or trashes the course. Below 720px of
 * width the rows stack into cards.
 */
export function CourseTable({ goalId, courses, work, today, addRequest }: CourseTableProps) {
  const actions = useGoalActions()
  const [adding, setAdding] = useState(false)
  const [seenRequest, setSeenRequest] = useState(addRequest)
  if (addRequest !== seenRequest) {
    setSeenRequest(addRequest)
    setAdding(true)
  }
  const byCourse = new Map(work.courses.map((c) => [c.courseId, c]))

  return (
    <div className={styles.root}>
      {courses.length === 0 && !adding ? (
        <EmptyState
          size="sm"
          icon={<Plus />}
          title="No courses yet"
          description="Add the courses or milestones this goal is made of, with their hours."
          action={
            <Button variant="primary" iconLeft={<Plus />} onClick={() => setAdding(true)}>
              Add a course
            </Button>
          }
        />
      ) : (
        <div role="table" aria-label="Courses" className={styles.table}>
          <div role="row" className={styles.head}>
            <div role="columnheader" className={styles.hSpacer}>
              <span className="sr-only">Reorder</span>
            </div>
            <div role="columnheader" data-h="status">
              Status
            </div>
            <div role="columnheader" data-h="code">
              Code
            </div>
            <div role="columnheader" data-h="name">
              Course
            </div>
            <div role="columnheader" data-h="cus">
              CUs
            </div>
            <div role="columnheader" data-h="type">
              Type
            </div>
            <div role="columnheader" data-h="hours">
              Hours
            </div>
            <div role="columnheader" data-h="due">
              Due
            </div>
            <div role="columnheader" className={styles.hSpacer}>
              <span className="sr-only">Actions</span>
            </div>
          </div>
          <SortableList
            as="div"
            rowAs="div"
            role="rowgroup"
            rowRole="row"
            items={courses}
            nameOf={(c) => courseLabel(c)}
            onReorder={(ids) => void actions.reorderCourses(goalId, ids)}
            rowClassName={styles.row}
            renderRow={(course, { handle }) => (
              <>
                <div role="cell" className={styles.cell} data-cell="handle">
                  {handle}
                </div>
                <CourseCells
                  goalId={goalId}
                  course={course}
                  work={byCourse.get(course.id)}
                  today={today}
                />
              </>
            )}
          />
        </div>
      )}

      {adding ? (
        <AddCourseForm goalId={goalId} onDone={() => setAdding(false)} />
      ) : courses.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className={styles.addButton}
          iconLeft={<Plus />}
          onClick={() => setAdding(true)}
        >
          Add course
          <Kbd keys="c" size="sm" variant="plain" className={styles.addKey} />
        </Button>
      ) : null}
    </div>
  )
}
