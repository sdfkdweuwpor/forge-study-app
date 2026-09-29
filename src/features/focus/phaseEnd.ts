/**
 * What happens when a timed phase ends by itself (the tick found its time up, or the app was reopened
 * after it passed): the "Done with this task?" dialog for a focus session, the chime and notification
 * (`alertSessionEnd`, once), a toast for a break, and, if settings say so, the next phase starting on
 * its own. The session is already settled in the database when this runs; this is only the aftermath.
 *
 * A phase that ended long ago, while the tab was closed, is `late`: the dialog is still queued (the
 * question is still owed), but there is no chime, no notification, no toast and no auto-start, since
 * they would arrive out of the blue and start a break that is already over.
 */
import { recordError } from '@/app/reportError'
import { SessionActiveError, startSession, type FinishResult } from '@/db/repos/sessions'
import { getSettings } from '@/db/repos/settings'
import { formatMinutes, breakAfter, cyclePosition, focusPhase } from '@/logic/timer'
import { alertSessionEnd } from './sound'
import { cycleOf } from './actions'
import { getTaskTitle } from './queries'
import { runtime } from './runtime'

/** Later than this after its planned end, a phase counts as ended while nobody was looking. */
export const LATE_MS = 15_000

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export async function handlePhaseEnd(result: FinishResult, late: boolean): Promise<void> {
  const { session, xp } = result
  const rt = runtime()
  try {
    const settings = await getSettings()
    const cycle = cycleOf(settings)

    if (session.kind === 'focus') {
      rt?.openEndDialog(session.id)
      if (late) return
      const pomodoro = session.mode === 'pomodoro'
      const rest = breakAfter(session.round, cycle)
      const task = session.taskId ? await getTaskTitle(session.taskId) : null
      const summary = `${plural(session.actualMinutes ?? 0, 'minute')}${task ? ` on ${task}` : ''}${xp > 0 ? ` · +${xp} XP` : ''}.`
      await Promise.all([
        alertSessionEnd(settings, {
          title: 'Focus session complete',
          body: `${summary} ${pomodoro ? `Time for a ${formatMinutes(rest.minutes)} break.` : 'Nice work.'}`,
          onClick: () => rt?.openEndDialog(session.id),
        }),
        pomodoro && settings.timer.autoStartBreaks
          ? startNext({
              kind: 'break',
              plannedMin: rest.minutes,
              round: rest.round,
              taskId: session.taskId,
            })
          : undefined,
      ])
      return
    }

    // A break ended.
    if (late) return
    const nextRound = focusPhase(session.round + 1, cycle)
    const { position, total } = cyclePosition(nextRound.round, cycle.longBreakEvery)
    const ready = session.mode === 'pomodoro' ? `Ready for round ${position} of ${total}?` : 'Ready when you are.'
    rt?.toast.show({ title: 'Break over', description: ready })
    await Promise.all([
      alertSessionEnd(settings, { title: 'Break over', body: ready }),
      session.mode === 'pomodoro' && settings.timer.autoStartFocus
        ? startNext({
            kind: 'focus',
            plannedMin: nextRound.minutes,
            round: nextRound.round,
            taskId: session.taskId,
          })
        : undefined,
    ])
  } catch (error) {
    recordError(error, 'end the phase')
  }
}

async function startNext(input: {
  kind: 'focus' | 'break'
  plannedMin: number
  round: number
  taskId: string | null
}): Promise<void> {
  try {
    await startSession({ mode: 'pomodoro', ...input })
  } catch (error) {
    // Another tab already started it.
    if (!(error instanceof SessionActiveError)) throw error
  }
}
