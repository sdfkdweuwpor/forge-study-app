/**
 * Suggested times for everyday tasks (schema v2 `autoSlot`). Reading a proposal changes nothing: it is
 * computed from the tasks, the everyday hours (`settings.scheduling.taskWindows`) and the global days off.
 * A suggestion only becomes a do date and time when the person accepts it, and every write here returns
 * an `undo()`.
 */
import { suggestAutoSlots, type AutoSlotProposal, type SlotSuggestion } from '@/logic/everydaySlots'
import { db } from '../db'
import type { ID } from '../types'
import { getSettings } from './settings'
import { updateTask, type RepoOptions, type Undoable } from './tasks'

/** Where each candidate would go: earliest deadline first, around timed tasks and goal sessions. */
export async function proposeAutoSlots(opts: RepoOptions = {}): Promise<AutoSlotProposal> {
  const now = opts.now ?? Date.now()
  const [tasks, settings] = await Promise.all([db.tasks.toArray(), getSettings()])
  return suggestAutoSlots(
    tasks,
    settings.scheduling.taskWindows,
    settings.scheduling.globalDaysOff,
    now,
  )
}

export interface AcceptResult extends Undoable {
  /** How many suggestions were applied (a task that changed meanwhile is skipped). */
  applied: number
}

/**
 * Applies suggestions: the task gets that day, time and length, and the switch turns off (it has done its
 * job). A task that is gone, finished, or already has a day of its own is left alone.
 */
export async function acceptAutoSlots(
  slots: readonly SlotSuggestion[],
  opts: RepoOptions = {},
): Promise<AcceptResult> {
  const undos: Array<() => Promise<void>> = []
  for (const slot of slots) {
    const task = await db.tasks.get(slot.taskId)
    if (!task || task.status === 'done' || task.doDate !== null) continue
    const result = await updateTask(
      slot.taskId,
      {
        doDate: slot.doDate,
        doTime: slot.startTime,
        durationMinutes: task.durationMinutes ?? slot.minutes,
        autoSlot: false,
      },
      opts,
    )
    if (result) undos.push(result.undo)
  }
  return {
    applied: undos.length,
    undo: async () => {
      for (const undo of [...undos].reverse()) await undo()
    },
  }
}

/** "I'll pick a time myself": turns auto-schedule off for these tasks. */
export async function dismissAutoSlots(
  taskIds: readonly ID[],
  opts: RepoOptions = {},
): Promise<Undoable> {
  const undos: Array<() => Promise<void>> = []
  for (const id of taskIds) {
    const result = await updateTask(id, { autoSlot: false }, opts)
    if (result) undos.push(result.undo)
  }
  return {
    undo: async () => {
      for (const undo of [...undos].reverse()) await undo()
    },
  }
}
