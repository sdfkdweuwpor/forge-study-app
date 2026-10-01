import { describe, expect, it } from 'vitest'
import type { QuestionAttempt } from '@/db/types'
import { requeueDate, wrongAnswerQueue } from './practice'

let seq = 0
function attempt(
  questionId: string,
  at: number,
  correct: boolean,
  requeueOn: string | null,
): QuestionAttempt {
  seq += 1
  return {
    id: `a${seq}`,
    createdAt: at,
    updatedAt: at,
    questionId,
    goalId: 'g',
    milestoneId: 'c182',
    at,
    day: '2026-09-29',
    correct,
    answer: correct ? 'right' : 'wrong',
    requeueOn,
  }
}

describe('requeueDate', () => {
  it('brings a miss back tomorrow, then after 3 and 7 days', () => {
    expect(requeueDate('2026-09-29', 1)).toBe('2026-09-30')
    expect(requeueDate('2026-09-29', 2)).toBe('2026-10-02')
    expect(requeueDate('2026-09-29', 3)).toBe('2026-10-06')
    expect(requeueDate('2026-09-29', 9)).toBe('2026-10-06')
  })
})

describe('wrongAnswerQueue', () => {
  it('holds questions whose latest answer was a due miss, longest overdue first', () => {
    const attempts = [
      attempt('q1', 1, false, '2026-09-28'),
      attempt('q2', 2, false, '2026-09-30'),
      attempt('q3', 3, false, '2026-09-27'),
      attempt('q3', 4, false, '2026-09-29'),
      attempt('q4', 5, false, '2026-09-26'),
      attempt('q4', 6, true, null),
    ]
    expect(wrongAnswerQueue(attempts, '2026-09-29')).toEqual([
      { questionId: 'q1', requeueOn: '2026-09-28', misses: 1, lastAt: 1 },
      { questionId: 'q3', requeueOn: '2026-09-29', misses: 2, lastAt: 4 },
    ])
  })

  it('without a day, lists every open miss (q2 not yet due included)', () => {
    const attempts = [attempt('q1', 1, false, '2026-09-28'), attempt('q2', 2, false, '2026-09-30')]
    expect(wrongAnswerQueue(attempts).map((q) => q.questionId)).toEqual(['q1', 'q2'])
  })

  it('orders ties by misses, then the oldest attempt, and ignores input order', () => {
    const attempts = [
      attempt('b', 10, false, '2026-09-29'),
      attempt('a', 5, false, '2026-09-29'),
      attempt('c', 1, false, '2026-09-20'),
      attempt('c', 2, false, '2026-09-29'),
    ]
    const ids = wrongAnswerQueue([...attempts].reverse(), '2026-09-29').map((q) => q.questionId)
    expect(ids).toEqual(['c', 'a', 'b'])
  })
})
