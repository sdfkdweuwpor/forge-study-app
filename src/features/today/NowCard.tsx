import {
  CalendarDays,
  Check,
  Clock,
  Flag,
  ListChecks,
  Play,
  Plus,
  SkipForward,
  Sun,
} from 'lucide-react'
import { useOverlays } from '@/app/providers/OverlayProvider'
import { Slot, useSlotCount } from '@/app/registry'
import type { Priority, Task } from '@/db/types'
import { diffDays } from '@/logic/dates'
import { normalizeTag, tagColor } from '@/logic/tagColor'
import { dueLabel, subtaskProgress } from '@/logic/taskDisplay'
import { priorityLabel } from '@/logic/taskQuery'
import { estimateText, overdueText } from '@/logic/todayStats'
import { Button } from '@/ui/Button'
import { Kbd } from '@/ui/Kbd'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { Tooltip } from '@/ui/Tooltip'
import { openTask, useTaskActions, useTaskEnv, type TaskMotion } from '@/features/tasks'
import type { CourseLabel } from './queries'
import { startFocus } from './startFocus'
import styles from './NowCard.module.css'

export interface NowCardProps {
  /** The `pickNow` task, or `null` when nothing is actionable. */
  task: Task | null
  /** Set while the task is completing: the card shows it done for a moment. */
  motion: TaskMotion | undefined
  course: CourseLabel | undefined
  /** Tasks finished today, for the "clear" wording. */
  completedToday: number
}

const FLAG_TONE: Record<Priority, 'quiet' | 'warning' | 'danger'> = {
  0: 'quiet',
  1: 'quiet',
  2: 'quiet',
  3: 'warning',
  4: 'danger',
}

/** The single next task, with the big Start focus button. Empty variant when nothing is left. */
export function NowCard({ task, motion, course, completedToday }: NowCardProps) {
  return task ? (
    <TaskNow task={task} motion={motion} course={course} />
  ) : (
    <ClearNow completedToday={completedToday} />
  )
}

function TaskNow({
  task,
  motion,
  course,
}: {
  task: Task
  motion: TaskMotion | undefined
  course: CourseLabel | undefined
}) {
  const actions = useTaskActions()
  const { today, tagColors } = useTaskEnv()
  const extras = useSlotCount('today.now')

  const completing = motion !== undefined
  const struck = motion?.phase === 'struck' || motion?.phase === 'leaving'
  const due = dueLabel(task, today)
  const overdueDays = task.dueDate !== null ? diffDays(today, task.dueDate) : 0
  const dueText = due?.tone === 'overdue' ? overdueText(overdueDays) : due?.text
  const estimate = estimateText(task)
  const checklist = subtaskProgress(task.subtasks)
  const code = course?.code ?? null
  const tags = task.tags.filter((t) => code === null || normalizeTag(t) !== normalizeTag(code))

  return (
    <section
      className={styles.card}
      aria-labelledby="now-title"
      data-completing={completing || undefined}
    >
      <p className={styles.eyebrow}>
        <span>Now</span>
        {task.status === 'doing' ? <span className={styles.doing}>In progress</span> : null}
      </p>

      <h2 className={styles.title} id="now-title" data-done={struck || undefined}>
        <button type="button" className={styles.titleButton} onClick={() => openTask(task.id)}>
          {task.title}
        </button>
      </h2>

      <div className={styles.meta}>
        {code ? (
          <Tag size="sm" color={tagColor(code, tagColors)}>
            {code}
          </Tag>
        ) : course?.goalTitle ? (
          <span className={styles.chip}>{course.goalTitle}</span>
        ) : null}
        {tags.map((tag) => (
          <Tag key={tag} size="sm" color={tagColor(tag, tagColors)}>
            {tag}
          </Tag>
        ))}
        {estimate ? (
          <span className={styles.chip}>
            <Clock size={14} aria-hidden="true" />
            <span>{estimate}</span>
          </span>
        ) : null}
        {dueText ? (
          <span className={styles.chip} data-tone={due?.tone}>
            <CalendarDays size={14} aria-hidden="true" />
            <span>{dueText}</span>
          </span>
        ) : null}
        {checklist ? (
          <span className={styles.chip}>
            <ListChecks size={14} aria-hidden="true" />
            <span>{checklist.text}</span>
            <span className="sr-only"> steps done</span>
          </span>
        ) : null}
        {task.priority >= 3 ? (
          <span className={styles.chip} data-flag={FLAG_TONE[task.priority]}>
            <Flag size={14} aria-hidden="true" />
            <span>{priorityLabel(task.priority)}</span>
          </span>
        ) : null}
      </div>

      <div className={styles.actions}>
        <Button
          variant="primary"
          className={styles.start}
          iconLeft={<Play />}
          onClick={() => {
            // The task is finishing: there is nothing to focus on.
            if (!completing) startFocus(task)
          }}
        >
          Start focus
        </Button>
        <Tooltip content="Mark done" shortcut="shift+x">
          <Button
            variant="secondary"
            iconLeft={<Check />}
            aria-keyshortcuts="Shift+X"
            onClick={() => actions.complete(task)}
          >
            Done
          </Button>
        </Tooltip>
        <Tooltip content="Skip for today" shortcut="shift+n">
          <Button
            variant="ghost"
            iconLeft={<SkipForward />}
            aria-keyshortcuts="Shift+N"
            onClick={() => actions.skip(task)}
          >
            Skip
          </Button>
        </Tooltip>
      </div>

      {extras > 0 ? (
        <div className={styles.extras}>
          <Slot id="today.now" />
        </div>
      ) : null}

      {struck && motion && motion.xp > 0 ? (
        <span className={styles.xp} data-motion="opacity" aria-hidden="true">
          +{motion.xp} XP
        </span>
      ) : null}
    </section>
  )
}

function ClearNow({ completedToday }: { completedToday: number }) {
  const overlays = useOverlays()
  const extras = useSlotCount('today.now')
  return (
    <section className={styles.card} aria-labelledby="now-title" data-clear>
      <p className={styles.eyebrow}>
        <span>Now</span>
      </p>
      <div className={styles.clear}>
        <span className={styles.clearIcon} aria-hidden="true">
          <Sun />
        </span>
        <div className={styles.clearText}>
          <h2 className={styles.clearTitle} id="now-title">
            You’re clear for now
          </h2>
          <p className={styles.clearBody}>
            {completedToday > 0
              ? `You finished ${completedToday} ${completedToday === 1 ? 'task' : 'tasks'} today. Add another, or take the rest of the day.`
              : 'Nothing is planned for today. Add a task, or enjoy the space.'}
          </p>
        </div>
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" iconLeft={<Plus />} onClick={() => overlays.open('quickAdd')}>
          Add a task
        </Button>
        <span className={styles.hint}>
          or press <Kbd keys="q" size="sm" />
        </span>
      </div>
      {extras > 0 ? (
        <div className={styles.extras}>
          <Slot id="today.now" />
        </div>
      ) : null}
    </section>
  )
}

/** Placeholder with the card's footprint while tasks load. */
export function NowCardSkeleton() {
  return (
    <div className={styles.card} role="status" aria-busy="true" aria-label="Loading your next task">
      <Skeleton width={36} />
      <Skeleton width="62%" height={28} className={styles.skelTitle} />
      <Skeleton width="38%" />
      <Skeleton variant="block" width={148} height={40} className={styles.skelButton} />
    </div>
  )
}
