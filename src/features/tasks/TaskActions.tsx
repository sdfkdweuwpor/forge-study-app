/**
 * Everything a task row can do, in one place: the environment rows read (today, tag colours, goals and
 * courses), the actions (complete with its motion and Undo toast, uncomplete, rename, prioritise,
 * reschedule, skip, duplicate, trash) and a small request bus so a shortcut can ask a row to open its
 * inline editor or a picker. Wrap any screen that shows `TaskRow`s in `TaskActionsProvider`.
 *
 * Completion motion (BRIEF §3.5), driven here so every list behaves the same:
 *   click      → the write starts at once; the checkbox fills (`checking`)
 *   ~300 ms    → the checkbox reports its animation done: the title is struck through and "+15 XP"
 *                floats up (`struck`)
 *   +600 ms    → the row slides out (`leaving`), 300 ms later it is released from the list
 * An Undo toast appears as soon as the write lands. Undo cancels the motion and reverses the write.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useMediaQuery } from '@/app/hooks/useMediaQuery'
import { useToday } from '@/app/hooks/useToday'
import { recordError } from '@/app/reportError'
import { useSettings } from '@/db/hooks/useSettings'
import {
  completeTask,
  duplicateTask,
  skipTask,
  trashTask,
  uncompleteTask,
  updateTask,
  type CompleteResult,
} from '@/db/repos/tasks'
import type { HHmm, ID, ISODate, Priority, TagColor, Task } from '@/db/types'
import { addDays } from '@/logic/dates'
import { formatXp, relativeDay } from '@/logic/taskDisplay'
import { useToast } from '@/ui/Toast'
import { flushNotes } from './notesSave'
import { useProjectIndex, type ProjectIndex } from './queries'

/** How long the struck-through row stays before it leaves (BRIEF §3.5). */
export const HOLD_MS = 600
/** The slide-out (`--dur-3`, 280 ms) plus a little slack. */
export const LEAVE_MS = 300
/** If the checkbox never reports its animation end, the motion continues anyway. */
const CHECK_FALLBACK_MS = 700

export type MotionPhase = 'checking' | 'struck' | 'leaving'

export interface TaskMotion {
  phase: MotionPhase
  /** XP the completion actually paid out (0 if none). Known once the write has landed. */
  xp: number
}

export type RowRequestKind = 'edit' | 'due' | 'priority' | 'move'

/** What a mounted row lets the rest of the screen ask of it. */
export interface RowHandle {
  /** Open the inline title editor. */
  edit(): void
  /** Open a picker (due date, priority, goal/course) anchored to the row's `…` button. */
  openPanel(kind: Exclude<RowRequestKind, 'edit'>): void
}

// ─── Environment ────────────────────────────────────────────────────────────

export interface TaskEnv {
  today: ISODate
  weekStartsOn: 0 | 1
  tagColors: Readonly<Record<string, TagColor>>
  /** `undefined` while goals and courses load. */
  projects: ProjectIndex | undefined
  /** A mouse is in use, so clicking a title edits it in place. Touch opens the task instead. */
  canEditInPlace: boolean
}

const TaskEnvContext = createContext<TaskEnv | null>(null)

export function useTaskEnv(): TaskEnv {
  const env = useContext(TaskEnvContext)
  if (!env) throw new Error('useTaskEnv must be used inside <TaskActionsProvider>')
  return env
}

// ─── Actions ────────────────────────────────────────────────────────────────

export interface TaskActions {
  complete(task: Task): void
  /** Reopens a done task (to To do, or to Doing) with a toast that takes the XP back and offers Undo. */
  uncomplete(task: Task, to?: 'todo' | 'doing'): void
  /** The checkbox: done → not done, not done → done, and undoes a completion still in motion. */
  toggleComplete(task: Task): void
  /** The checkbox's fill has finished: the strike-through and XP float can start. */
  checkAnimationEnd(id: ID): void
  rename(id: ID, title: string): Promise<void>
  setPriority(id: ID, priority: Priority): Promise<void>
  /** Sets or clears the day a task is planned for (its do date), and optionally its time. */
  setDate(id: ID, doDate: ISODate | null, doTime?: HHmm | null): Promise<void>
  /** Sets or clears only the planned time of day, leaving the date alone. */
  setTime(id: ID, doTime: HHmm | null): Promise<void>
  /** Sets or clears the hard deadline (and optionally its time). */
  setDeadline(id: ID, dueDate: ISODate | null, dueTime?: HHmm | null): Promise<void>
  /** Sets or clears only the deadline's time. */
  setDeadlineTime(id: ID, dueTime: HHmm | null): Promise<void>
  /** Plans the task for today (`t`). */
  dueToday(id: ID): Promise<void>
  /** Plans the task for tomorrow (`m`). */
  dueTomorrow(id: ID): Promise<void>
  skip(task: Task): void
  duplicate(id: ID): Promise<void>
  trash(task: Task): void
  /** Ask row `id` to open its title editor or a picker (keyboard shortcuts use this). No-op if it is not on screen. */
  request(id: ID, kind: RowRequestKind): void
  /** A mounted row registers itself so `request` can reach it. Returns the unregister function. */
  registerRow(id: ID, handle: RowHandle): () => void
}

const TaskActionsContext = createContext<TaskActions | null>(null)
const TaskMotionContext = createContext<ReadonlyMap<ID, TaskMotion>>(new Map())

export function useTaskActions(): TaskActions {
  const actions = useContext(TaskActionsContext)
  if (!actions) throw new Error('useTaskActions must be used inside <TaskActionsProvider>')
  return actions
}

/** Rows in the middle of a completion. A list keeps these visible even though they are already done. */
export function useTaskMotion(): ReadonlyMap<ID, TaskMotion> {
  return useContext(TaskMotionContext)
}

function shorten(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export function TaskActionsProvider({ children }: { children: ReactNode }) {
  const toast = useToast()
  const today = useToday()
  const settings = useSettings()
  const projects = useProjectIndex()
  const canEditInPlace = useMediaQuery('(hover: hover) and (pointer: fine)')

  const [motion, setMotionState] = useState<ReadonlyMap<ID, TaskMotion>>(() => new Map())

  // The source of truth for timing decisions; `motion` mirrors it for rendering.
  const phases = useRef(new Map<ID, TaskMotion>())
  const timers = useRef(new Map<ID, number[]>())
  const results = useRef(new Map<ID, Promise<CompleteResult | null>>())
  const undos = useRef(new Map<ID, () => Promise<void>>())
  const rows = useRef(new Map<ID, RowHandle>())

  // Leaving the screen mid-motion: stop the timers so nothing fires into an unmounted tree.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const handles of pending.values())
        for (const handle of handles) window.clearTimeout(handle)
      pending.clear()
    }
  }, [])

  const setPhase = useCallback((id: ID, next: TaskMotion | null) => {
    if (next) phases.current.set(id, next)
    else phases.current.delete(id)
    setMotionState(new Map(phases.current))
  }, [])

  const later = useCallback((id: ID, ms: number, fn: () => void) => {
    const handle = window.setTimeout(fn, ms)
    timers.current.set(id, [...(timers.current.get(id) ?? []), handle])
  }, [])

  /** Forgets a completion's motion entirely: timers, pending result and the held row. */
  const drop = useCallback(
    (id: ID) => {
      for (const handle of timers.current.get(id) ?? []) window.clearTimeout(handle)
      timers.current.delete(id)
      results.current.delete(id)
      undos.current.delete(id)
      setPhase(id, null)
    },
    [setPhase],
  )

  const advance = useCallback(
    async (id: ID) => {
      if (phases.current.get(id)?.phase !== 'checking') return
      const pending = results.current.get(id)
      const result = pending ? await pending : null
      // Undone, or failed, while we waited.
      if (phases.current.get(id)?.phase !== 'checking') return
      const xp = result?.xp ?? 0
      setPhase(id, { phase: 'struck', xp })
      later(id, HOLD_MS, () => setPhase(id, { phase: 'leaving', xp }))
      later(id, HOLD_MS + LEAVE_MS, () => drop(id))
    },
    [drop, later, setPhase],
  )

  const guard = useCallback(
    async (what: string, work: () => Promise<unknown>): Promise<void> => {
      try {
        await work()
      } catch (error) {
        recordError(error, what)
        toast.error(`Couldn’t ${what}`, { description: 'Nothing was changed. Try again.' })
      }
    },
    [toast],
  )

  const complete = useCallback(
    (task: Task) => {
      const id = task.id
      if (task.status === 'done' || phases.current.has(id)) return
      setPhase(id, { phase: 'checking', xp: 0 })
      const pending = completeTask(id).catch((error: unknown) => {
        recordError(error, 'completeTask')
        return null
      })
      results.current.set(id, pending)
      later(id, CHECK_FALLBACK_MS, () => void advance(id))

      void pending.then((result) => {
        if (!results.current.has(id)) return // undone while the write was in flight
        if (!result) {
          drop(id)
          toast.error('Couldn’t complete the task', {
            description: 'Nothing was changed. Try again.',
          })
          return
        }
        if (!result.task) {
          drop(id) // deleted elsewhere
          return
        }
        undos.current.set(id, result.undo)
        const parts = [
          result.xp > 0 ? formatXp(result.xp) : null,
          result.next?.doDate ? `Next: ${relativeDay(result.next.doDate, today)}` : null,
        ].filter((part): part is string => part !== null)
        toast.show({
          title: `Completed “${shorten(task.title)}”`,
          ...(parts.length > 0 ? { description: parts.join(' · ') } : {}),
          variant: result.xp > 0 ? 'xp' : 'success',
          undo: async () => {
            drop(id)
            await result.undo()
          },
        })
      })
    },
    [advance, drop, later, setPhase, toast, today],
  )

  const uncomplete = useCallback(
    (task: Task, to: 'todo' | 'doing' = 'todo') => {
      // A completion still in its motion is over the moment the task is reopened.
      if (phases.current.has(task.id)) drop(task.id)
      void guard('reopen the task', async () => {
        const result = await uncompleteTask(task.id, { to })
        toast.show({
          title:
            to === 'doing'
              ? `Moved “${shorten(task.title)}” to Doing`
              : `Reopened “${shorten(task.title)}”`,
          ...(result.xp < 0 ? { description: formatXp(result.xp) } : {}),
          undo: result.undo,
        })
      })
    },
    [drop, guard, toast],
  )

  const toggleComplete = useCallback(
    (task: Task) => {
      const undo = undos.current.get(task.id)
      if (phases.current.has(task.id)) {
        // Unchecking a row that is still in its completion motion is an undo.
        if (undo) {
          drop(task.id)
          void guard('undo the completion', undo)
        }
        return
      }
      if (task.status === 'done') uncomplete(task)
      else complete(task)
    },
    [complete, drop, guard, uncomplete],
  )

  const rename = useCallback(
    (id: ID, title: string) => guard('rename the task', () => updateTask(id, { title })),
    [guard],
  )

  const setPriority = useCallback(
    (id: ID, priority: Priority) => guard('set the priority', () => updateTask(id, { priority })),
    [guard],
  )

  const setDate = useCallback(
    (id: ID, doDate: ISODate | null, doTime?: HHmm | null) =>
      guard('change the date', () =>
        updateTask(id, {
          doDate,
          ...(doDate === null ? { doTime: null } : doTime !== undefined ? { doTime } : {}),
        }),
      ),
    [guard],
  )

  const setTime = useCallback(
    (id: ID, doTime: HHmm | null) => guard('change the time', () => updateTask(id, { doTime })),
    [guard],
  )

  const setDeadline = useCallback(
    (id: ID, dueDate: ISODate | null, dueTime?: HHmm | null) =>
      guard('change the deadline', () =>
        updateTask(id, {
          dueDate,
          ...(dueDate === null ? { dueTime: null } : dueTime !== undefined ? { dueTime } : {}),
        }),
      ),
    [guard],
  )

  const setDeadlineTime = useCallback(
    (id: ID, dueTime: HHmm | null) =>
      guard('change the deadline', () => updateTask(id, { dueTime })),
    [guard],
  )

  const dueToday = useCallback((id: ID) => setDate(id, today), [setDate, today])
  const dueTomorrow = useCallback((id: ID) => setDate(id, addDays(today, 1)), [setDate, today])

  const skip = useCallback(
    (task: Task) => {
      void guard('skip the task', async () => {
        const result = await skipTask(task.id)
        if (!result) return
        toast.show({ title: `Skipped “${shorten(task.title)}” for today`, undo: result.undo })
      })
    },
    [guard, toast],
  )

  const duplicate = useCallback(
    (id: ID) => guard('duplicate the task', () => duplicateTask(id)),
    [guard],
  )

  const trash = useCallback(
    (task: Task) => {
      void guard('move the task to the trash', async () => {
        // Words typed a moment ago are still in the notes field's timer; they go to the trash too.
        await flushNotes(task.id)
        const result = await trashTask(task.id)
        if (!result) return
        toast.show({
          title: `Moved “${shorten(task.title)}” to the trash`,
          description: 'It stays there for 30 days.',
          undo: result.undo,
        })
      })
    },
    [guard, toast],
  )

  const requestRow = useCallback((id: ID, kind: RowRequestKind) => {
    const row = rows.current.get(id)
    if (!row) return
    if (kind === 'edit') row.edit()
    else row.openPanel(kind)
  }, [])
  const registerRow = useCallback((id: ID, handle: RowHandle) => {
    rows.current.set(id, handle)
    return () => {
      if (rows.current.get(id) === handle) rows.current.delete(id)
    }
  }, [])

  const actions = useMemo<TaskActions>(
    () => ({
      complete,
      uncomplete,
      toggleComplete,
      checkAnimationEnd: (id) => void advance(id),
      rename,
      setPriority,
      setDate,
      setTime,
      setDeadline,
      setDeadlineTime,
      dueToday,
      dueTomorrow,
      skip,
      duplicate,
      trash,
      request: requestRow,
      registerRow,
    }),
    [
      advance,
      complete,
      dueToday,
      dueTomorrow,
      duplicate,
      rename,
      registerRow,
      requestRow,
      setDate,
      setDeadline,
      setDeadlineTime,
      setPriority,
      setTime,
      skip,
      toggleComplete,
      trash,
      uncomplete,
    ],
  )

  const tagColors = settings?.tagColors
  const weekStartsOn = settings?.weekStartsOn ?? 1
  const env = useMemo<TaskEnv>(
    () => ({ today, weekStartsOn, tagColors: tagColors ?? {}, projects, canEditInPlace }),
    [today, weekStartsOn, tagColors, projects, canEditInPlace],
  )

  return (
    <TaskEnvContext.Provider value={env}>
      <TaskActionsContext.Provider value={actions}>
        <TaskMotionContext.Provider value={motion}>{children}</TaskMotionContext.Provider>
      </TaskActionsContext.Provider>
    </TaskEnvContext.Provider>
  )
}
