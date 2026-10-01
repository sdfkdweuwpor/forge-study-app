/** What the toolbar popup shows, as plain data: pure, so it is unit-tested without a DOM. */
import { activeSession, isBlockingNow, winsToday, type ExtensionState } from '../shared/state.js'

export interface PopupModel {
  /** "7 wins today" */
  wins: string
  focusRunning: boolean
  /** Epoch ms the running session ends, or null (no session, or open-ended). */
  endsAt: number | null
  taskTitle: string | null
  mode: string
  blocking: string
}

const MODE_LABELS = {
  always: 'Always on',
  focus: 'During focus sessions',
  schedule: 'On a schedule',
} as const

export function winsLabel(count: number): string {
  return `${count} ${count === 1 ? 'win' : 'wins'} today`
}

export function popupModel(state: ExtensionState, now: number): PopupModel {
  const session = activeSession(state, now)
  const blockingNow = isBlockingNow(state, now)
  let blocking = 'Blocking now'
  if (!blockingNow) {
    blocking =
      state.config.mode === 'schedule'
        ? 'Off outside your scheduled times'
        : 'Starts with your next focus session'
  }
  return {
    wins: winsLabel(winsToday(state, now)),
    focusRunning: session !== null,
    endsAt: session?.endsAt ?? null,
    taskTitle: session?.taskTitle ?? null,
    mode: MODE_LABELS[state.config.mode],
    blocking,
  }
}
