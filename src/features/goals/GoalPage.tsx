/**
 * `/goals/:goalId` (BRIEF §5.4, Notion style): cover, icon and an editable title; breadcrumbs; progress
 * as a share of hours; the projected finish in calm words; the timeline; the courses as a database table;
 * "CUs completed this term"; and free-form notes with the slash menu. Other features add to it through
 * the `goal.header` and `goal.panels` slots.
 */
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useToday } from '@/app/hooks/useToday'
import { Slot } from '@/app/registry'
import { href, navigate, useParams, usePageTitle } from '@/app/router'
import { useShortcutHandler, useShortcutScope } from '@/app/shortcuts'
import { formatHours, percent, plural, summarizeFinish, termProgress } from '@/logic/goalDisplay'
import { Breadcrumbs } from '@/ui/Breadcrumbs'
import { Dropdown, type MenuEntry } from '@/ui/Dropdown'
import { IconButton } from '@/ui/IconButton'
import { PageHeader, type PageCover } from '@/ui/PageHeader'
import { ProgressBar } from '@/ui/ProgressBar'
import { useGoalActions } from './actions'
import { CourseTable } from './CourseTable'
import { renderCrumbLink } from './crumbs'
import { FinishLine } from './FinishLine'
import { GoalTimeline } from './GoalTimeline'
import { NotesEditor } from './NotesEditor'
import { useCoverValue, useGoalData, type GoalData } from './queries'
import { GoalsError, NotFoundState, PageSkeleton } from './states'
import { TermProgressBar } from './TermProgressBar'
import styles from './GoalPage.module.css'

function GoalBody({ data }: { data: GoalData }) {
  const { goal, courses, work } = data
  const today = useToday()
  const actions = useGoalActions()
  const cover = useCoverValue(goal.cover)
  const [addRequest, setAddRequest] = useState(0)

  useShortcutScope('goal')
  useShortcutHandler('goals.addCourse', () => setAddRequest((n) => n + 1))
  useShortcutHandler('goals.trash', () => void trash())

  async function trash() {
    if (await actions.trashGoal(goal)) navigate('goals')
  }

  const done = percent(work.doneMinutes, work.totalMinutes)
  const finish = summarizeFinish(goal, today)
  const term = termProgress(goal.terms, courses, today)
  const cus = courses.reduce((sum, c) => sum + (c.cus ?? 0), 0)
  const minutesByCourse = new Map(work.courses.map((c) => [c.courseId, c.totalMinutes]))

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
    if (next === null) void actions.updateGoal(goal.id, { cover: null })
    else if (next.kind === 'gradient') {
      void actions.updateGoal(goal.id, { cover: { kind: 'gradient', preset: next.preset } })
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.topbar}>
        <Breadcrumbs
          className={styles.crumbs}
          renderLink={renderCrumbLink}
          items={[{ label: 'Goals', href: href('goals') }, { label: goal.title }]}
        />
        <div className={styles.topActions}>
          <Dropdown
            label={`Actions for ${goal.title}`}
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
        title={goal.title}
        onTitleChange={(title) => void actions.updateGoal(goal.id, { title })}
        icon={goal.icon || null}
        onIconChange={(icon) => void actions.updateGoal(goal.id, { icon: icon ?? '' })}
        cover={cover}
        onCoverChange={setCover}
        subtitle={[
          plural(courses.length, 'course'),
          cus > 0 ? `${cus} CUs` : null,
          work.totalMinutes > 0 ? `${formatHours(work.totalMinutes)} h of study` : null,
        ]
          .filter((s) => s !== null)
          .join(' · ')}
      />

      <Slot id="goal.header" goalId={goal.id} />

      <section className={styles.summary} aria-label="Progress">
        <div className={styles.progress}>
          <div className={styles.progressHead}>
            <h2 className={styles.progressTitle}>{done}% of hours done</h2>
            <span className={styles.progressHours}>
              {formatHours(work.doneMinutes)} of {formatHours(work.totalMinutes)} h
            </span>
          </div>
          <ProgressBar
            value={done}
            size="lg"
            label={`${goal.title} hours done`}
            valueText={`${done}% of hours done`}
          />
          <FinishLine summary={finish} />
          {/* 5D: the one-click catch-up sits here, under the projection. */}
        </div>
        {term !== null && term.total > 0 ? <TermProgressBar progress={term} /> : null}
      </section>

      <GoalTimeline courses={courses} hours={minutesByCourse} />

      <section className={styles.section} aria-labelledby="courses-heading">
        <h2 id="courses-heading" className={styles.sectionTitle}>
          Courses
        </h2>
        <CourseTable
          goalId={goal.id}
          courses={courses}
          work={work}
          today={today}
          addRequest={addRequest}
        />
      </section>

      <Slot id="goal.panels" goalId={goal.id} />

      <section className={styles.section} aria-labelledby="notes-heading">
        <h2 id="notes-heading" className={styles.sectionTitle}>
          Notes
        </h2>
        <NotesEditor
          key={goal.id}
          initial={goal.notes}
          label={`Notes for ${goal.title}`}
          onSave={(notes) => actions.updateGoal(goal.id, { notes })}
        />
      </section>

    </div>
  )
}

function GoalScreen() {
  const { goalId } = useParams<'goal'>()
  const data = useGoalData(goalId)
  usePageTitle(data?.goal.title)
  if (data === undefined) return <PageSkeleton label="Loading goal" />
  if (data === null) return <NotFoundState what="goal" />
  return <GoalBody data={data} />
}

/** `/goals/:goalId`. */
export default function GoalPage() {
  return (
    <ErrorBoundary
      fallback={(_error, reset) => (
        <div className={styles.root}>
          <GoalsError what="goal" onRetry={reset} />
        </div>
      )}
    >
      <GoalScreen />
    </ErrorBoundary>
  )
}
