import { Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { recordError } from '@/app/reportError'
import { Link } from '@/app/router'
import { useSettings } from '@/db/hooks/useSettings'
import { plannedMinutesOf } from '@/db/repos/reviews'
import { completeMorning } from '@/db/repos/rituals'
import { getSettings, updateSettings } from '@/db/repos/settings'
import { createTask } from '@/db/repos/tasks'
import type { ID, Task } from '@/db/types'
import { addDays } from '@/logic/dates'
import { TOP_MAX, dayWords, ritualDay, type TodayItem } from '@/logic/rituals'
import { durationText } from '@/logic/statsLabels'
import { formatTimeOfDay } from '@/logic/taskDisplay'
import { planTime } from '@/logic/taskDates'
import { isGoalWork } from '@/logic/today'
import { carriedFromText, estimateText } from '@/logic/todayStats'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/Checkbox'
import { IconButton } from '@/ui/IconButton'
import { Input } from '@/ui/Input'
import { Modal } from '@/ui/Modal'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/Toast'
import { useRitualActions } from './actions'
import { todayTaskDraft } from './addTask'
import { useRitual, useTodayLists } from './queries'
import { RoutineMenu } from './RoutineMenu'
import { StepHeading } from './Steps'
import { useDialogLifecycle } from './useDialog'
import styles from './Dialog.module.css'

const STEP_TITLES = [
  'Pick up to three that matter most',
  'Check today’s goal work',
  'Set today’s focus goal',
] as const
const GOAL_MIN = 1
const GOAL_MAX = 24

/** "10 AM · 45 min", "from Tue", … the quiet line under a task's title. */
function metaText(item: TodayItem, today: string): string {
  const { task, carriedFrom } = item
  const parts: string[] = []
  if (carriedFrom !== null) parts.push(carriedFromText(carriedFrom, today))
  const time = planTime(task)
  if (carriedFrom === null && time !== null) parts.push(formatTimeOfDay(time))
  const length =
    task.durationMinutes !== null && task.durationMinutes > 0
      ? durationText(task.durationMinutes)
      : estimateText(task)
  if (length) parts.push(length)
  return parts.join(' · ')
}

/**
 * The morning plan (BRIEF §5.11), about two minutes in three steps: pick today's top 3 from Today's list
 * (and add a task or a routine right there), look over the goal work already planned for today, and set
 * today's focus goal. Done saves the top 3 (shown on Today) and the goal; nothing is saved before that
 * except tasks you add, which are real tasks at once.
 */
export function MorningPlan({ onGone, openedAt }: { onGone: () => void; openedAt: number }) {
  const { open, close } = useDialogLifecycle(onGone)
  // The day is fixed when the dialog opens, so one left open past midnight still plans the day it began.
  const today = ritualDay('morning', openedAt)
  const tomorrow = addDays(today, 1)
  const toast = useToast()
  const actions = useRitualActions()
  const settings = useSettings()
  const lists = useTodayLists(today)
  const ritual = useRitual('morning', today)

  const [step, setStep] = useState(0)
  const [edits, setEdits] = useState<ID[] | null>(null)
  const [goalEdit, setGoalEdit] = useState<number | null>(null)
  const [line, setLine] = useState('')
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const ready = lists !== undefined && ritual !== undefined && settings !== undefined
  const list = useRef<HTMLUListElement | null>(null)
  const focusedList = useRef(false)

  // What can be picked: today's open work, plus anything already in the top 3 that is finished.
  const pickable = useMemo<TodayItem[]>(() => {
    if (!lists) return []
    const stored = new Set(ritual?.top3 ?? [])
    const finished = lists.done
      .filter((t) => stored.has(t.id))
      .map((task): TodayItem => ({ task, carriedFrom: null }))
    return [...lists.open, ...finished]
  }, [lists, ritual])

  const selected = useMemo<ID[]>(() => {
    if (edits !== null) return edits
    const here = new Set(pickable.map((i) => i.task.id))
    return (ritual?.top3 ?? []).filter((id) => here.has(id))
  }, [edits, pickable, ritual])

  const full = selected.length >= TOP_MAX
  const goal = goalEdit ?? settings?.dailyGoalPomodoros ?? 6
  const pomodoroMin = settings?.timer.pomodoroMin ?? 25

  const goalWork = useMemo(
    () => (lists?.open ?? []).filter((i) => i.carriedFrom === null && isGoalWork(i.task)),
    [lists],
  )
  const goalWorkMinutes = goalWork.reduce(
    (sum, i) => sum + plannedMinutesOf(i.task, pomodoroMin),
    0,
  )

  // The dialog opens before the tasks have arrived, so the keyboard first lands on the "Add a task"
  // field. When the list appears, and nothing has been typed yet, move to its first task, so the
  // arrow-less flow is Space to pick, Tab to the next.
  useEffect(() => {
    if (!ready || focusedList.current || pickable.length === 0) return
    focusedList.current = true
    // Only from where the dialog put focus (the field, or nowhere yet): someone who has already
    // tabbed to another control, such as "Add a routine", keeps it.
    const held = document.activeElement
    const parked =
      !held ||
      held === document.body ||
      held.getAttribute('role') === 'dialog' ||
      held.getAttribute('aria-label') === 'Add a task for today'
    if (line === '' && parked)
      list.current
        ?.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.focus({ preventScroll: true })
  }, [ready, pickable.length, line])

  function toggle(id: ID): void {
    if (selected.includes(id)) setEdits(selected.filter((x) => x !== id))
    else if (!full) setEdits([...selected, id])
  }

  async function addTask(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (adding || !settings) return
    const draft = todayTaskDraft(line, {
      now: Date.now(),
      today,
      weekStartsOn: settings.weekStartsOn,
    })
    if (!draft) return
    setAdding(true)
    try {
      const task = await createTask(draft.input)
      setLine('')
      if (draft.day === today) {
        setNotice(null)
        if (!full) setEdits([...selected, task.id])
      } else {
        setNotice(`Added “${task.title}” for ${dayWords(draft.day, today)}.`)
      }
    } catch (error) {
      recordError(error, 'morningPlan.addTask')
      toast.error('Couldn’t add that task', { description: 'Nothing was changed. Try again.' })
    } finally {
      setAdding(false)
    }
  }

  async function finish(): Promise<void> {
    if (!settings || saving) return
    setSaving(true)
    const before = settings.dailyGoalPomodoros
    try {
      const change = await completeMorning(today, { top3: selected })
      if (goal !== before) {
        try {
          await updateSettings({ dailyGoalPomodoros: goal })
        } catch (error) {
          // Both or neither: put the plan back rather than leave it half saved.
          await change.undo()
          throw error
        }
      }
      toast.show({
        title: 'Morning plan saved',
        description:
          selected.length > 0
            ? `${selected.length === 1 ? 'Your top task is' : `Your top ${selected.length} are`} pinned on Today.`
            : 'Have a good day.',
        variant: 'success',
        undo: async () => {
          await change.undo()
          // Only take the goal back if nobody has changed it since.
          if (goal !== before && (await getSettings()).dailyGoalPomodoros === goal) {
            await updateSettings({ dailyGoalPomodoros: before })
          }
        },
      })
      close()
    } catch (error) {
      recordError(error, 'morningPlan.finish')
      toast.error('Couldn’t save your plan', { description: 'Nothing was changed. Try again.' })
      setSaving(false)
    }
  }

  const footer = (
    <>
      {step > 0 ? (
        <Button variant="ghost" onClick={() => setStep(step - 1)}>
          Back
        </Button>
      ) : null}
      {step < STEP_TITLES.length - 1 ? (
        <Button variant="primary" disabled={!ready} onClick={() => setStep(step + 1)}>
          Next
        </Button>
      ) : (
        <Button variant="primary" disabled={!ready} loading={saving} onClick={() => void finish()}>
          Done
        </Button>
      )}
    </>
  )

  return (
    <Modal
      open={open}
      onClose={close}
      title="Morning plan"
      description="About two minutes. You can change any of it later."
      footer={footer}
      closeOnEsc={!saving}
    >
      <div className={styles.body} data-testid="morning-plan" aria-busy={!ready || undefined}>
        <StepHeading step={step} total={STEP_TITLES.length} title={STEP_TITLES[step] ?? ''} />

        {step === 0 ? (
          <>
            <p className={styles.hint} role="status">
              {full
                ? 'Three is plenty. Uncheck one to swap.'
                : `${selected.length} of ${TOP_MAX} chosen`}
            </p>
            {!ready ? (
              <div className={styles.skeleton} role="status" aria-label="Loading today’s tasks">
                <Skeleton width="80%" />
                <Skeleton width="60%" />
                <Skeleton width="70%" />
              </div>
            ) : pickable.length === 0 ? (
              <p className={styles.quiet}>
                Nothing is planned for today yet. Add a task below, or add a routine.
              </p>
            ) : (
              <ul ref={list} className={styles.list} aria-label="Today’s tasks">
                {pickable.map((item) => {
                  const { task } = item
                  const rank = selected.indexOf(task.id)
                  const meta = metaText(item, today)
                  return (
                    <li key={task.id} className={styles.row}>
                      <Checkbox
                        className={styles.pick}
                        checked={rank !== -1}
                        disabled={rank === -1 && full}
                        onCheckedChange={() => toggle(task.id)}
                        aria-label={
                          rank === -1 ? task.title : `${task.title}, pick ${rank + 1} of ${TOP_MAX}`
                        }
                        label={
                          <span className={styles.pickLabel}>
                            <span className={styles.rowTitle} data-done={task.status === 'done'}>
                              {task.title}
                            </span>
                            {meta !== '' ? <span className={styles.rowMeta}>{meta}</span> : null}
                          </span>
                        }
                      />
                      {rank !== -1 ? (
                        <span className={styles.rank} aria-hidden="true">
                          {rank + 1}
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
            <form className={styles.addRow} onSubmit={(e) => void addTask(e)}>
              <Input
                className={styles.addField}
                aria-label="Add a task for today"
                placeholder="Add a task, e.g. Review C182 notes 30m"
                leadingIcon={<Plus />}
                value={line}
                onChange={(e) => setLine(e.target.value)}
                autoComplete="off"
                enterKeyHint="done"
              />
              <Button type="submit" disabled={line.trim() === '' || !ready} loading={adding}>
                Add
              </Button>
              <RoutineMenu day={today} today={today} />
            </form>
            {notice !== null ? (
              <p className={styles.notice} role="status">
                {notice}
              </p>
            ) : null}
          </>
        ) : null}

        {step === 1 ? (
          <>
            {!ready ? (
              <div className={styles.skeleton} role="status" aria-label="Loading goal work">
                <Skeleton width="75%" />
                <Skeleton width="55%" />
              </div>
            ) : goalWork.length === 0 ? (
              <p className={styles.quiet}>
                Nothing from your goals is planned for today. Plan sessions land here once a goal
                has study days.
              </p>
            ) : (
              <>
                <p className={styles.lede}>
                  {goalWork.length === 1 ? '1 session' : `${goalWork.length} sessions`}
                  {goalWorkMinutes > 0 ? `, about ${durationText(goalWorkMinutes)}` : ''}. Move one
                  to tomorrow if today is full.
                </p>
                <ul className={styles.list} aria-label="Goal work planned for today">
                  {goalWork.map(({ task }) => (
                    <GoalWorkRow
                      key={task.id}
                      task={task}
                      onOpen={close}
                      onMove={() =>
                        void actions.move([task.id], tomorrow, today, {
                          title: 'Moved to tomorrow',
                          description: task.title,
                        })
                      }
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className={styles.goal} role="group" aria-label="Daily focus goal">
              <IconButton
                label="Fewer pomodoros"
                icon={<Minus />}
                size="md"
                variant="secondary"
                disabled={!ready || goal <= GOAL_MIN}
                onClick={() => setGoalEdit(Math.max(GOAL_MIN, goal - 1))}
              />
              <output className={styles.goalValue} aria-live="polite">
                <span className={styles.goalNumber}>{goal}</span>
                {goal === 1 ? 'pomodoro' : 'pomodoros'}
              </output>
              <IconButton
                label="More pomodoros"
                icon={<Plus />}
                size="md"
                variant="secondary"
                disabled={!ready || goal >= GOAL_MAX}
                onClick={() => setGoalEdit(Math.min(GOAL_MAX, goal + 1))}
              />
            </div>
            <p className={styles.lede}>
              That is {durationText(goal * pomodoroMin)} of focus. It is the same daily goal as in
              Settings, and the ring on Today follows it.
            </p>
          </>
        ) : null}
      </div>
    </Modal>
  )
}

function GoalWorkRow({
  task,
  onOpen,
  onMove,
}: {
  task: Task
  onOpen: () => void
  onMove: () => void
}) {
  const time = planTime(task)
  const length =
    task.durationMinutes !== null ? durationText(task.durationMinutes) : estimateText(task)
  const meta = [time !== null ? formatTimeOfDay(time) : null, length].filter(Boolean).join(' · ')
  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.rowTitle}>{task.title}</span>
        {meta !== '' ? <span className={styles.rowMeta}>{meta}</span> : null}
      </div>
      <Link
        to="task"
        params={{ taskId: task.id }}
        className={styles.linkAction}
        onClick={onOpen}
        aria-label={`Open ${task.title}`}
      >
        Open
      </Link>
      <Button
        size="sm"
        variant="ghost"
        onClick={onMove}
        aria-label={`Move ${task.title} to tomorrow`}
      >
        Tomorrow
      </Button>
    </li>
  )
}
