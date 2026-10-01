/**
 * The daily-goal bonus (BRIEF §5.5: hitting the goal earns 25 XP). "Hit" means what the goal ring on
 * Today shows: counted pomodoros that day (`pomodorosDone`, the same function `useTodayPomodoros`
 * uses) reaching `settings.dailyGoalPomodoros`. The award is idempotent per day through its key
 * `dailyGoal:<day>`, so it can be attempted after every session and again at every app start.
 */
import { addDays } from '@/logic/dates'
import { pomodorosDone } from '@/logic/todayStats'
import { XP_DAILY_GOAL } from '@/logic/xp'
import { db } from '../db'
import type { ISODate, XpEvent } from '../types'
import { getSettings } from './settings'
import { awardXp } from './xp'

export const dailyGoalKey = (day: ISODate): string => `dailyGoal:${day}`

/** Counted pomodoros on `day`, as the goal ring counts them. */
export async function countedPomodorosOn(day: ISODate): Promise<number> {
  const [settings, sessions] = await Promise.all([
    getSettings(),
    db.sessions.where('[kind+day]').equals(['focus', day]).toArray(),
  ])
  return pomodorosDone(sessions, day, settings.timer.pomodoroMin)
}

/**
 * Awards +25 XP for `day` when its counted pomodoros reach the daily goal. Returns the new event, or
 * `null` when the goal is not reached yet or the day already earned it.
 */
export async function awardDailyGoal(day: ISODate): Promise<XpEvent | null> {
  const settings = await getSettings()
  const goal = Math.max(1, settings.dailyGoalPomodoros)
  if ((await countedPomodorosOn(day)) < goal) return null
  return awardXp({
    source: 'dailyGoal',
    amount: XP_DAILY_GOAL,
    key: dailyGoalKey(day),
    note: 'Daily goal',
    day,
  })
}

/** Yesterday and today, oldest first: what `onAppStart` reconciles (a session can end while no tab is open). */
export async function reconcileDailyGoal(today: ISODate): Promise<XpEvent[]> {
  const awarded: XpEvent[] = []
  for (const day of [addDays(today, -1), today]) {
    const event = await awardDailyGoal(day)
    if (event) awarded.push(event)
  }
  return awarded
}
