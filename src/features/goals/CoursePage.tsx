/**
 * `/goals/:goalId/courses/:courseId` (BRIEF §5.4): breadcrumbs `Goals / <goal> / C182 Introduction to IT`,
 * cover, icon and editable title, the course's facts (status, code, CUs, type, hours, what it comes after),
 * its units, its scheduled tasks, and notes. "Mark course complete" updates the status and re-plans, which
 * pulls the later courses forward. `course.panels` is the slot other features add to.
 */
import { Check, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useToday } from '@/app/hooks/useToday'
import { Slot } from '@/app/registry'
import { href, navigate, useParams, usePageTitle } from '@/app/router'
import { useShortcutHandler, useShortcutScope } from '@/app/shortcuts'
import { dayOf } from '@/logic/dates'
import {
  COURSE_STATUS_LABELS,
  COURSE_TYPE_LABELS,
  courseLabel,
  formatDay,
  formatHours,
  plural,
} from '@/logic/goalDisplay'
import { parseCus, parseHours } from '@/logic/goalDraft'
import type { Milestone } from '@/db/types'
import { Breadcrumbs } from '@/ui/Breadcrumbs'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/Checkbox'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { IconButton } from '@/ui/IconButton'
import { PageHeader, type PageCover } from '@/ui/PageHeader'
import { Popover } from '@/ui/Popover'
import { useGoalActions } from './actions'
import { ChoiceField, type Choice } from './ChoiceField'
import { CourseTasks } from './CourseTasks'
import { renderCrumbLink } from './crumbs'
import { InlineField } from './InlineField'
import { NotesEditor } from './NotesEditor'
import { useCourseData, useCoverValue, type CourseData } from './queries'
import { GoalsError, NotFoundState, PageSkeleton } from './states'
import { UnitsList } from './UnitsList'
import styles from './CoursePage.module.css'

type Status = Milestone['status']
type CourseType = '' | NonNullable<Milestone['courseType']>

const STATUS_CHOICES: readonly Choice<Status>[] = (['todo', 'active', 'done'] as const).map(
  (s) => ({
    value: s,
    label: COURSE_STATUS_LABELS[s],
  }),
)

const TYPE_CHOICES: readonly Choice<CourseType>[] = [
  { value: '', label: 'Not set' },
  { value: 'OA', label: COURSE_TYPE_LABELS.OA },
  { value: 'PA', label: COURSE_TYPE_LABELS.PA },
  { value: 'OA+PA', label: COURSE_TYPE_LABELS['OA+PA'] },
]

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.factLabel}>{label}</dt>
      <dd className={styles.factValue}>{children}</dd>
    </div>
  )
}

function CourseBody({ data }: { data: CourseData }) {
  const { goal, course, units, tasks, work, siblings } = data
  const today = useToday()
  const actions = useGoalActions()
  const cover = useCoverValue(course.cover)
  const [unitFocus, setUnitFocus] = useState(0)
  const label = courseLabel(course)
  const done = course.status === 'done'
  const doneUnits = units.filter((u) => u.status === 'done').length

  useShortcutScope('course')
  useShortcutHandler('course.newUnit', () => setUnitFocus((n) => n + 1))
  useShortcutHandler('course.complete', () => void toggleComplete())
  useShortcutHandler('course.trash', () => void trash())

  async function toggleComplete() {
    await actions.setCourseStatus(course, done ? 'active' : 'done')
  }

  async function trash() {
    if (await actions.trashCourse(course)) navigate('goal', { goalId: goal.id })
  }

  const menu: MenuEntry[] = [
    {
      id: 'trash',
      label: 'Move to trash',
      icon: <Trash2 />,
      shortcut: 'mod+backspace',
      danger: true,
      onSelect: () => void trash(),
    },
  ]

  const setCover = (next: PageCover | null) => {
    if (next === null) void actions.updateCourse(course.id, { cover: null })
    else if (next.kind === 'gradient') {
      void actions.updateCourse(course.id, { cover: { kind: 'gradient', preset: next.preset } })
    }
  }

  const after = useMemo(
    () => siblings.filter((s) => course.prerequisiteIds.includes(s.id)),
    [siblings, course.prerequisiteIds],
  )
  const total = work?.totalMinutes ?? course.estimateHours * 60

  return (
    <div className={styles.root}>
      <div className={styles.topbar}>
        <Breadcrumbs
          className={styles.crumbs}
          renderLink={renderCrumbLink}
          items={[
            { label: 'Goals', href: href('goals') },
            {
              label: goal.title,
              icon: goal.icon || undefined,
              href: href('goal', { goalId: goal.id }),
            },
            { label },
          ]}
        />
        <div className={styles.topActions}>
          {done ? (
            <Button size="sm" iconLeft={<RotateCcw />} onClick={() => void toggleComplete()}>
              Mark not complete
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              iconLeft={<Check />}
              aria-keyshortcuts="Shift+D"
              onClick={() => void toggleComplete()}
            >
              Mark course complete
            </Button>
          )}
          <Dropdown
            label={`Actions for ${label}`}
            align="end"
            items={menu}
            trigger={(p) => (
              <IconButton
                {...p}
                label="More actions"
                icon={<MoreHorizontal />}
                size="md"
                tooltip={false}
              />
            )}
          />
        </div>
      </div>

      <PageHeader
        title={course.title}
        onTitleChange={(title) => void actions.updateCourse(course.id, { title })}
        icon={course.icon}
        onIconChange={(icon) => void actions.updateCourse(course.id, { icon })}
        cover={cover}
        onCoverChange={setCover}
        meta={
          <dl className={styles.facts}>
            <Fact label="Status">
              <ChoiceField
                label={`Status of ${label}`}
                value={course.status}
                choices={STATUS_CHOICES}
                fit
                onChange={(status) => void actions.setCourseStatus(course, status)}
              />
            </Fact>
            <Fact label="Code">
              <InlineField
                label="Course code"
                value={course.code ?? ''}
                placeholder="Add code"
                maxLength={16}
                size={9}
                onCommit={(code) => void actions.updateCourse(course.id, { code })}
              />
            </Fact>
            <Fact label="CUs">
              <InlineField
                label="Competency units"
                value={course.cus === null ? '' : String(course.cus)}
                placeholder="Add"
                inputMode="numeric"
                size={4}
                accept={(text) => parseCus(text).ok}
                onCommit={(text) => {
                  const parsed = parseCus(text)
                  if (parsed.ok) void actions.updateCourse(course.id, { cus: parsed.value })
                }}
              />
            </Fact>
            <Fact label="Type">
              <ChoiceField
                label="Course type"
                value={(course.courseType ?? '') as CourseType}
                choices={TYPE_CHOICES}
                fit
                display={
                  <span>
                    {course.courseType === null ? 'Not set' : COURSE_TYPE_LABELS[course.courseType]}
                  </span>
                }
                onChange={(type) =>
                  void actions.updateCourse(course.id, { courseType: type === '' ? null : type })
                }
              />
            </Fact>
            <Fact label="Hours">
              <InlineField
                label="Estimated hours"
                value={String(course.estimateHours)}
                display={
                  <>
                    {formatHours(work?.doneMinutes ?? 0)} / {formatHours(total)} h
                  </>
                }
                inputMode="decimal"
                size={6}
                accept={(text) => parseHours(text) !== null}
                onCommit={(text) => {
                  const hours = parseHours(text)
                  if (hours !== null) void actions.updateCourse(course.id, { estimateHours: hours })
                }}
              />
            </Fact>
            <Fact label={done ? 'Finished' : 'Due'}>
              <span className={styles.plain}>
                {done && course.completedAt !== null
                  ? formatDay(dayOf(course.completedAt), today)
                  : course.projectedEnd !== null
                    ? formatDay(course.projectedEnd, today)
                    : '—'}
              </span>
            </Fact>
            {siblings.length > 0 ? (
              <Fact label="Comes after">
                <Popover
                  label="Comes after"
                  align="start"
                  trigger={(p) => (
                    <button {...p} type="button" className={styles.afterButton}>
                      {after.length === 0
                        ? 'Nothing'
                        : after.map((s) => s.code ?? s.title).join(', ')}
                    </button>
                  )}
                >
                  <div className={styles.afterList}>
                    {siblings.map((s) => (
                      <Checkbox
                        key={s.id}
                        label={courseLabel(s)}
                        checked={course.prerequisiteIds.includes(s.id)}
                        onCheckedChange={(on) =>
                          void actions.updateCourse(course.id, {
                            prerequisiteIds: on
                              ? [...course.prerequisiteIds, s.id]
                              : course.prerequisiteIds.filter((p) => p !== s.id),
                          })
                        }
                      />
                    ))}
                  </div>
                </Popover>
              </Fact>
            ) : null}
          </dl>
        }
      />

      <section className={styles.section} aria-labelledby="units-heading">
        <h2 id="units-heading" className={styles.sectionTitle}>
          Units
          {units.length > 0 ? (
            <span className={styles.sectionCount}>
              {doneUnits} of {units.length}
            </span>
          ) : null}
        </h2>
        {done && units.some((u) => u.status !== 'done') ? (
          <p className={styles.note}>
            This course is marked complete, so its remaining units are not scheduled.
          </p>
        ) : null}
        <UnitsList course={course} units={units} focusRequest={unitFocus} />
      </section>

      <section className={styles.section} aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className={styles.sectionTitle}>
          Tasks
          {tasks.length > 0 ? (
            <span className={styles.sectionCount}>
              {plural(tasks.filter((t) => t.status !== 'done').length, 'open task')}
            </span>
          ) : null}
        </h2>
        <CourseTasks tasks={tasks} courseDone={done} />
      </section>

      <Slot id="course.panels" goalId={goal.id} courseId={course.id} />

      <section className={styles.section} aria-labelledby="course-notes-heading">
        <h2 id="course-notes-heading" className={styles.sectionTitle}>
          Notes
        </h2>
        <NotesEditor
          key={course.id}
          initial={course.notes}
          label={`Notes for ${label}`}
          onSave={(notes) => actions.updateCourse(course.id, { notes })}
        />
      </section>
    </div>
  )
}

function CourseScreen() {
  const { goalId, courseId } = useParams<'course'>()
  const data = useCourseData(goalId, courseId)
  usePageTitle(data ? courseLabel(data.course) : undefined)
  if (data === undefined) return <PageSkeleton label="Loading course" />
  if (data === null) return <NotFoundState what="course" />
  return <CourseBody data={data} />
}

/** `/goals/:goalId/courses/:courseId`. */
export default function CoursePage() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <div className={styles.root}>
          <GoalsError what="course" onRetry={reset} />
        </div>
      )}
    >
      <CourseScreen />
    </ErrorBoundary>
  )
}
