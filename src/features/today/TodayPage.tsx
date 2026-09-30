/**
 * `/`: the Today screen (BRIEF §5.1). A greeting with the date, a stat row (daily goal, streak, XP
 * today), the Now card with the single next task, today's tasks in groups, and an aside with the next
 * target and a 14-day heatmap. The stat row and the aside are slots (`today.header`, `today.aside`)
 * whose defaults are registered in `feature.ts`; `today.now` and `today.main` take extra content.
 */
import { format } from 'date-fns'
import { useCallback, useMemo, useState } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useNow } from '@/app/hooks/useNow'
import { recordError } from '@/app/reportError'
import { Slot, useSlotCount } from '@/app/registry'
import { useShortcutHandler, useShortcutScope } from '@/app/shortcuts'
import { useSettings } from '@/db/hooks/useSettings'
import { useTasks } from '@/db/hooks/useTasks'
import { moveTask } from '@/db/repos/tasks'
import type { ID, Task } from '@/db/types'
import { groupToday, oneListToday, pickNow } from '@/logic/today'
import { greeting, carriedFromText } from '@/logic/todayStats'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useToast } from '@/ui/Toast'
import {
  TaskActionsProvider,
  openTask,
  useTaskActions,
  useTaskEnv,
  useTaskMotion,
  useTaskShortcuts,
} from '@/features/tasks'
import { NowCard } from './NowCard'
import { useCourseLabels, useHasGoals, useTaskXpToday } from './queries'
import { TodayEmpty, TodayError, TodaySkeleton } from './states'
import { CarriedOverGroup, CompletedGroup, TaskGroup, type GroupItem } from './TodayGroups'
import { useTodayLayout } from './todayLayout'
import { useTodayActionRequests, type TodayAction } from './todayActions'
import styles from './TodayPage.module.css'

/** Greeting and date. Below 640px the date wraps under the greeting (see the CSS). */
function Greeting() {
  const now = useNow('minute')
  const settings = useSettings()
  const date = new Date(now)
  const text = greeting(date.getHours(), settings?.profile.name)

  return (
    <header className={styles.header}>
      <h1 className={styles.title}>
        <span className={styles.greeting}>{text}</span>
        {/* Non-breaking space keeps the dash on the greeting's line; it is hidden once the date has its own line. */}
        <span className={styles.dash}>{' — '}</span>
        <time className={styles.date} dateTime={format(date, 'yyyy-MM-dd')}>
          {format(date, 'EEEE, MMM d')}
        </time>
      </h1>
    </header>
  )
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function TodayScreen() {
  const tasks = useTasks()
  const { today } = useTaskEnv()
  const motion = useTaskMotion()
  const actions = useTaskActions()
  const toast = useToast()
  const courses = useCourseLabels()
  const hasGoals = useHasGoals()
  const xpByTask = useTaskXpToday(today)
  const headerCount = useSlotCount('today.header')
  const asideCount = useSlotCount('today.aside')
  const mainCount = useSlotCount('today.main')

  const [selectedId, setSelectedId] = useState<ID | null>(null)
  const [byKeyboard, setByKeyboard] = useState(false)
  const [completedOpen, setCompletedOpen] = useState(false)
  const [carriedOpen, setCarriedOpen] = useState(true)
  const [layout, setLayout] = useTodayLayout()

  const data = useMemo(() => {
    if (!tasks) return undefined
    // Rows completing right now stay where they are, drawn as still open, until their motion ends.
    const pool = tasks.map((t) =>
      motion.has(t.id) && t.status === 'done' ? { ...t, status: 'todo' as const } : t,
    )
    const groups = groupToday(pool, { today })
    return {
      pool,
      groups,
      oneList: oneListToday(groups, { today }),
      now: pickNow(pool, { today }),
      brandNew: tasks.length === 0,
      carriedOver: groups.carriedOver.map<GroupItem>(({ task, from }) => ({
        task,
        dueText: carriedFromText(from, today),
      })),
    }
  }, [tasks, motion, today])

  const visibleIds = useMemo(() => {
    if (!data) return []
    const { fromGoals, yours, completedToday } = data.groups
    return [
      ...(layout === 'one' ? data.oneList : [...fromGoals, ...yours]),
      ...(carriedOpen ? data.groups.carriedOver.map((r) => r.task) : []),
      ...(completedOpen ? completedToday : []),
    ].map((t) => t.id)
  }, [data, completedOpen, carriedOpen, layout])

  const selected = selectedId !== null && visibleIds.includes(selectedId) ? selectedId : null
  const selectedTask = useMemo<Task | null>(
    () => (selected ? (data?.pool.find((t) => t.id === selected) ?? null) : null),
    [data, selected],
  )

  const select = useCallback((id: ID, viaKeyboard = false) => {
    setByKeyboard(viaKeyboard)
    setSelectedId(id)
  }, [])

  const nowTask = data?.now ?? null
  const carriedOver = data?.groups.carriedOver

  const moveAllToToday = useCallback(async () => {
    if (!carriedOver || carriedOver.length === 0) return
    try {
      const results = await Promise.all(
        carriedOver.map(({ task }) => moveTask(task.id, { doDate: today })),
      )
      const undos = results.flatMap((r) => (r ? [r.undo] : []))
      toast.show({
        title: `Moved ${plural(undos.length, 'task')} to today`,
        undo: async () => {
          await Promise.all(undos.map((undo) => undo()))
        },
      })
    } catch (error) {
      recordError(error, 'moveCarriedOver')
      toast.error('Couldn’t move the tasks', { description: 'Nothing was changed. Try again.' })
    }
  }, [carriedOver, today, toast])

  const completeNow = useCallback(() => {
    if (nowTask) actions.complete(nowTask)
  }, [actions, nowTask])
  const skipNow = useCallback(() => {
    if (nowTask) actions.skip(nowTask)
  }, [actions, nowTask])

  // Overlays (palette, dialogs, drawer) block the `today` scope through the shortcut controller.
  useShortcutScope('today')
  useShortcutHandler('today.nowDone', completeNow, nowTask !== null)
  useShortcutHandler('today.nowSkip', skipNow, nowTask !== null)
  useShortcutHandler(
    'today.moveCarriedOver',
    () => void moveAllToToday(),
    (carriedOver?.length ?? 0) > 0,
  )

  useTodayActionRequests((action: TodayAction) => {
    if (action === 'moveCarriedOver') {
      if (carriedOver && carriedOver.length > 0) void moveAllToToday()
      else toast.show({ title: 'Nothing carried over', description: 'Every task is on its day.' })
    } else if (nowTask) {
      if (action === 'completeNow') completeNow()
      else skipNow()
    } else {
      toast.show({ title: 'You’re clear for now', description: 'There is no task to act on.' })
    }
  }, data !== undefined)

  useTaskShortcuts({
    task: selectedTask,
    editTags: () => {
      if (selectedTask) openTask(selectedTask.id)
    },
    beforeLeave: (task) => {
      // Selection moves on to the neighbour so the keyboard never loses its place.
      const at = visibleIds.indexOf(task.id)
      setSelectedId(visibleIds[at + 1] ?? visibleIds[at - 1] ?? null)
    },
    list: {
      moveSelection: (step) => {
        if (visibleIds.length === 0) return
        const from = selected ? visibleIds.indexOf(selected) : -1
        const to =
          from === -1
            ? step === 1
              ? 0
              : visibleIds.length - 1
            : Math.min(visibleIds.length - 1, Math.max(0, from + step))
        const id = visibleIds[to]
        if (id) select(id, true)
      },
      open: () => {
        if (selected) openTask(selected)
      },
      // Today's order follows its groups; reordering lives on the Tasks page.
      reorder: () => undefined,
      escape: () => {
        if (!selected) return false
        setSelectedId(null)
        return true
      },
    },
  })

  if (data?.brandNew) {
    return (
      <>
        <Greeting />
        <TodayEmpty hasGoals={hasGoals === true} />
      </>
    )
  }

  const listProps = { selectedId: selected, onSelect: select, reveal: byKeyboard }
  const { fromGoals, yours, completedToday } = data?.groups ?? {
    fromGoals: [],
    yours: [],
    completedToday: [],
  }
  const items = (list: readonly Task[]): GroupItem[] => list.map((task) => ({ task }))

  return (
    <>
      <Greeting />
      {headerCount > 0 ? (
        <div className={styles.stats}>
          <Slot id="today.header" />
        </div>
      ) : null}

      <div className={styles.layout}>
        <div className={styles.main}>
          {data === undefined ? (
            <TodaySkeleton />
          ) : (
            <>
              <NowCard
                task={data.now}
                motion={data.now ? motion.get(data.now.id) : undefined}
                course={data.now?.milestoneId ? courses?.get(data.now.milestoneId) : undefined}
                completedToday={completedToday.length}
              />
              {fromGoals.length + yours.length > 0 || data.carriedOver.length > 0 ? (
                <div className={styles.toolbar}>
                  <SegmentedControl
                    label="Today’s layout"
                    size="sm"
                    value={layout}
                    onValueChange={setLayout}
                    options={[
                      { value: 'one', label: 'One list' },
                      { value: 'grouped', label: 'Grouped' },
                    ]}
                  />
                </div>
              ) : null}
              {layout === 'one' ? (
                data.oneList.length > 0 ? (
                  <TaskGroup
                    id="today"
                    label="Today"
                    items={items(data.oneList)}
                    showTime
                    today={today}
                    {...listProps}
                  />
                ) : null
              ) : (
                <>
                  {fromGoals.length > 0 ? (
                    <TaskGroup
                      id="fromGoals"
                      label="From your goals"
                      items={items(fromGoals)}
                      {...listProps}
                    />
                  ) : null}
                  {yours.length > 0 ? (
                    <TaskGroup id="yours" label="Your tasks" items={items(yours)} {...listProps} />
                  ) : null}
                </>
              )}
              {data.carriedOver.length > 0 ? (
                <CarriedOverGroup
                  items={data.carriedOver}
                  open={carriedOpen}
                  onOpenChange={setCarriedOpen}
                  onMoveAll={() => void moveAllToToday()}
                  {...listProps}
                />
              ) : null}
              {completedToday.length > 0 ? (
                <CompletedGroup
                  tasks={completedToday}
                  xpByTask={xpByTask}
                  open={completedOpen}
                  onOpenChange={setCompletedOpen}
                  {...listProps}
                />
              ) : null}
              {mainCount > 0 ? (
                <div className={styles.extra}>
                  <Slot id="today.main" />
                </div>
              ) : null}
            </>
          )}
        </div>

        {asideCount > 0 ? (
          <aside className={styles.aside} aria-label="Targets and activity">
            <Slot id="today.aside" />
          </aside>
        ) : null}
      </div>
    </>
  )
}

export default function TodayPage() {
  return (
    <TaskActionsProvider>
      <div className={styles.root}>
        <ErrorBoundary
          fallback={(_error, reset) => (
            <>
              <Greeting />
              <TodayError onRetry={reset} />
            </>
          )}
        >
          <TodayScreen />
        </ErrorBoundary>
      </div>
    </TaskActionsProvider>
  )
}
