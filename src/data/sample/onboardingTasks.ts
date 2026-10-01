/**
 * The three starter tasks onboarding leaves on Today (BRIEF §5.10): a first focus session, a first real
 * task added with Quick add, and a look around My World. Each one teaches a piece of the app with a short
 * note, and is small enough to finish in the first sitting. They carry `source: 'onboarding'` and stable
 * ids, which is how the flow knows it has already added them (it never adds them twice).
 */
import type { TaskInput } from '@/db/repos/tasks'
import type { Block, ISODate } from '@/db/types'
import { addDays } from '@/logic/dates'

/** The tag every starter task carries, so a person can find (and delete) them in one filter. */
export const STARTER_TAG = 'getting-started'

const p = (id: string, text: string): Block => ({ id, type: 'p', text })

export function buildOnboardingTasks(today: ISODate): TaskInput[] {
  const base = { source: 'onboarding' as const, tags: [STARTER_TAG] }
  return [
    {
      ...base,
      id: 'task-onboarding-focus',
      title: 'Take a 25-minute focus session',
      doDate: today,
      orderInDay: 0,
      priority: 2,
      estimatePomodoros: 1,
      estimateMinutes: 25,
      notes: [
        p('n-focus-1', 'Press Shift+S to start focus on this task, or use the Now card on Today.'),
        p('n-focus-2', 'One pomodoro is 25 minutes of a single thing. Everything else can wait.'),
      ],
    },
    {
      ...base,
      id: 'task-onboarding-quick-add',
      title: 'Add your first real task with Q',
      doDate: today,
      orderInDay: 1,
      estimatePomodoros: 1,
      estimateMinutes: 5,
      notes: [
        p('n-add-1', 'Press Q anywhere to open Quick add. Type the way you talk:'),
        p('n-add-2', 'Read C182 chapter 3 tomorrow #C182 ~2'),
        p('n-add-3', 'That becomes a task for tomorrow, tagged C182, worth two pomodoros.'),
      ],
    },
    {
      ...base,
      id: 'task-onboarding-my-world',
      title: 'Look around My World',
      doDate: addDays(today, 1),
      orderInDay: 0,
      estimateMinutes: 5,
      notes: [
        p(
          'n-world-1',
          'Press G then W to open it. Every finished course and study streak adds to your city.',
        ),
      ],
    },
  ]
}
