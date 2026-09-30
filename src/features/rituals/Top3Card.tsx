import { Pencil } from 'lucide-react'
import { useId } from 'react'
import { useToday } from '@/app/hooks/useToday'
import { top3Progress } from '@/logic/rituals'
import { formatTimeOfDay } from '@/logic/taskDisplay'
import { planTime } from '@/logic/taskDates'
import { Checkbox } from '@/ui/Checkbox'
import { IconButton } from '@/ui/IconButton'
import { openTask, useTaskActions } from '@/features/tasks'
import { useRitual, useTasksByIds } from './queries'
import { openRitualDialog } from './store'
import styles from './Top3Card.module.css'

/**
 * Slot `today.header`: the top 3 you picked in the morning plan, pinned above the Now card, each with a
 * round checkbox (completing goes through the same action as anywhere else, so the XP toast and Undo are
 * the usual ones). It is only there when a top 3 exists. A task that was deleted since is left out.
 */
export function Top3Card() {
  const today = useToday()
  const ritual = useRitual('morning', today)
  const ids = ritual?.top3 ?? []
  const tasks = useTasksByIds(ids)
  const actions = useTaskActions()
  const headingId = useId()

  if (ritual === undefined || ritual === null || tasks === undefined) return null
  const present = tasks.flatMap((t) => (t ? [t] : []))
  if (present.length === 0) return null
  const { done, total } = top3Progress(present)

  return (
    <section className={styles.card} aria-labelledby={headingId} data-testid="top3-card">
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          Top 3 today
        </h2>
        <span className={styles.count} aria-live="polite">
          {done} of {total} done
        </span>
        <IconButton
          label="Change your top 3"
          icon={<Pencil />}
          size="xs"
          className={styles.edit}
          onClick={() => openRitualDialog('morning')}
        />
      </div>
      <ul className={styles.list}>
        {present.map((task) => {
          const time = planTime(task)
          return (
            <li key={task.id} className={styles.row}>
              <Checkbox
                variant="round"
                checked={task.status === 'done'}
                aria-label={`Done: ${task.title}`}
                onCheckedChange={() => actions.toggleComplete(task)}
                onCheckAnimationEnd={() => actions.checkAnimationEnd(task.id)}
              />
              <button
                type="button"
                className={styles.name}
                data-done={task.status === 'done'}
                onClick={() => openTask(task.id)}
              >
                {task.title}
              </button>
              {time !== null && task.doDate === today && task.status !== 'done' ? (
                <span className={styles.time}>{formatTimeOfDay(time)}</span>
              ) : null}
            </li>
          )
        })}
      </ul>
      {done === total ? (
        <p className={styles.quiet} role="status">
          All {total === 1 ? 'done' : `${total} done`}. Well played.
        </p>
      ) : null}
    </section>
  )
}
