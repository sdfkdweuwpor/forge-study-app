/**
 * Practice questions (pure; a schema v2 hook, PLAN §4.6). Every answer is a `questionAttempts` row. A
 * miss sets `requeueOn` (the day the question should come back); answering the question right later
 * clears it. The wrong-answer queue is the questions whose latest answer was a miss that is due.
 */
import type { ID, ISODate, Millis, QuestionAttempt } from '@/db/types'
import { addDays } from './dates'

/** Days until a missed question comes back: tomorrow, then 3 and 7 days after repeated misses. */
export const REQUEUE_DAYS: readonly number[] = [1, 3, 7]

/** When a question missed for the `misses`-th time in a row (1 = first miss) comes back. */
export function requeueDate(day: ISODate, misses: number): ISODate {
  const i = Math.max(0, Math.min(REQUEUE_DAYS.length - 1, Math.floor(misses) - 1))
  return addDays(day, REQUEUE_DAYS[i] ?? 1)
}

export interface QueuedQuestion {
  questionId: ID
  /** The day it is due back. */
  requeueOn: ISODate
  /** Misses in a row, counting the latest. */
  misses: number
  lastAt: Millis
}

/**
 * The wrong-answer queue on `today`: each question whose latest attempt is a miss with a `requeueOn`
 * on or before today (every missed question when `today` is omitted), longest overdue first, then the
 * most missed, then the oldest attempt. A question answered right since is not in it.
 */
export function wrongAnswerQueue(
  attempts: readonly QuestionAttempt[],
  today?: ISODate,
): QueuedQuestion[] {
  const byQuestion = new Map<ID, QuestionAttempt[]>()
  for (const a of attempts) {
    const list = byQuestion.get(a.questionId) ?? []
    list.push(a)
    byQuestion.set(a.questionId, list)
  }
  const out: QueuedQuestion[] = []
  for (const [questionId, list] of byQuestion) {
    list.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const latest = list[list.length - 1]
    if (!latest || latest.correct || latest.requeueOn === null) continue
    if (today !== undefined && latest.requeueOn > today) continue
    let misses = 0
    for (let i = list.length - 1; i >= 0 && list[i]?.correct === false; i--) misses++
    out.push({ questionId, requeueOn: latest.requeueOn, misses, lastAt: latest.at })
  }
  return out.sort(
    (a, b) =>
      (a.requeueOn < b.requeueOn ? -1 : a.requeueOn > b.requeueOn ? 1 : 0) ||
      b.misses - a.misses ||
      a.lastAt - b.lastAt ||
      (a.questionId < b.questionId ? -1 : 1),
  )
}
