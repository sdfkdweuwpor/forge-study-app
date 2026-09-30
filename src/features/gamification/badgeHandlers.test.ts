import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { emit, resetDomainEvents, settleDomainEvents, subscribeAll } from '@/db/events'
import type { Badge, Milestone, Session } from '@/db/types'
import { addDays, dayOf } from '@/logic/dates'
import {
  badgeAppStart,
  badgeDomainHandlers,
  onBadgesUnlocked,
  reconcileAndAnnounce,
  stopBadgeWatch,
} from './badgeHandlers'

const MIN = 60_000
const at = (d: number, h: number, m = 0): number => new Date(2026, 8, d, h, m).getTime()
const NOW = at(29, 9, 30)

let seq = 0
function sessionRow(start: number, over: Partial<Session> = {}): Session {
  seq += 1
  return {
    id: `s${seq}`,
    createdAt: start,
    updatedAt: start,
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    taskId: null,
    goalId: null,
    milestoneId: null,
    day: dayOf(start),
    startedAt: start,
    endedAt: start + 25 * MIN,
    plannedMinutes: 25,
    pausedMs: 0,
    pausedAt: null,
    actualMinutes: 25,
    round: 1,
    interrupted: false,
    counted: true,
    note: null,
    ...over,
  }
}

function courseRow(over: Partial<Milestone> = {}): Milestone {
  return {
    id: 'course-1',
    createdAt: 1,
    updatedAt: NOW,
    goalId: 'g1',
    kind: 'course',
    code: 'C182',
    title: 'Introduction to IT',
    icon: null,
    cover: null,
    status: 'done',
    order: 0,
    prerequisiteIds: [],
    estimateHours: 40,
    dueDate: null,
    cus: 4,
    courseType: 'OA',
    termId: null,
    notes: [],
    projectedStart: null,
    projectedEnd: null,
    completedAt: NOW,
    selfRating: null,
    ...over,
  }
}

let announced: Badge[][] = []
let off: () => void = () => {}
let unsubscribe: () => void = () => {}

beforeEach(async () => {
  resetDomainEvents()
  stopBadgeWatch()
  seq = 0
  announced = []
  off = onBadgesUnlocked((badges) => void announced.push([...badges]))
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(async () => {
  unsubscribe()
  unsubscribe = () => {}
  off()
  stopBadgeWatch()
  await settleDomainEvents()
  resetDomainEvents()
})

const announcedIds = (): string[] => announced.flat().map((b) => b.id)

describe('session.ended', () => {
  it('reconciles after a counted session and announces the new badges', async () => {
    unsubscribe = subscribeAll(badgeDomainHandlers)
    const s = sessionRow(at(29, 7, 30))
    await db.sessions.add(s)
    emit({ type: 'session.ended', sessionId: s.id, day: s.day, counted: true })
    await settleDomainEvents()
    expect(announcedIds()).toEqual(['first-focus', 'early-bird'])
    expect(await db.badges.count()).toBe(2)
  })

  it('does nothing for a session that did not count', async () => {
    unsubscribe = subscribeAll(badgeDomainHandlers)
    const s = sessionRow(at(29, 7, 30), { counted: false })
    await db.sessions.add(s)
    emit({ type: 'session.ended', sessionId: s.id, day: s.day, counted: false })
    await settleDomainEvents()
    expect(announced).toEqual([])
    expect(await db.badges.count()).toBe(0)
  })

  it('announces a badge once: a repeated event finds nothing new', async () => {
    unsubscribe = subscribeAll(badgeDomainHandlers)
    const s = sessionRow(at(29, 9, 0))
    await db.sessions.add(s)
    emit({ type: 'session.ended', sessionId: s.id, day: s.day, counted: true })
    emit({ type: 'session.ended', sessionId: s.id, day: s.day, counted: true })
    await settleDomainEvents()
    expect(announcedIds()).toEqual(['first-focus'])
  })
})

describe('milestone.completed', () => {
  it('unlocks First Course Complete', async () => {
    unsubscribe = subscribeAll(badgeDomainHandlers)
    await db.milestones.add(courseRow())
    emit({ type: 'milestone.completed', milestoneId: 'course-1', goalId: 'g1' })
    await settleDomainEvents()
    expect(announcedIds()).toEqual(['first-course'])
  })
})

describe('reconcileAndAnnounce', () => {
  it('returns the new rows and tells listeners, and is quiet the second time', async () => {
    await db.sessions.add(sessionRow(at(29, 9, 0)))
    const first = await reconcileAndAnnounce(NOW)
    expect(first.map((b) => b.id)).toEqual(['first-focus'])
    expect(await reconcileAndAnnounce(NOW)).toEqual([])
    expect(announced).toHaveLength(1)
  })

  it('stops telling a listener that unsubscribed', async () => {
    off()
    await db.sessions.add(sessionRow(at(29, 9, 0)))
    await reconcileAndAnnounce(NOW)
    expect(announced).toEqual([])
  })
})

describe('badgeAppStart', () => {
  it('credits old history silently on a device with no badges', async () => {
    await db.sessions.bulkAdd([sessionRow(at(1, 7, 0)), sessionRow(at(2, 23, 0))])
    await db.milestones.add(courseRow())
    await badgeAppStart({ now: NOW })
    expect(announced).toEqual([])
    expect((await db.badges.toArray()).map((b) => b.id).sort()).toEqual([
      'early-bird',
      'first-course',
      'first-focus',
      'night-owl',
    ])
  })

  it('announces something new that turned up once badges exist', async () => {
    await db.sessions.add(sessionRow(at(1, 9, 0)))
    await badgeAppStart({ now: NOW })
    expect(announced).toEqual([])

    await db.milestones.add(courseRow())
    await badgeAppStart({ now: NOW })
    expect(announcedIds()).toEqual(['first-course'])
  })

  it('does nothing for a new person with no history', async () => {
    await badgeAppStart({ now: NOW })
    expect(announced).toEqual([])
    expect(await db.badges.count()).toBe(0)
  })

  it('reconciles when the streak rows change afterwards', async () => {
    await badgeAppStart({ now: NOW })
    const today = dayOf(Date.now())
    await db.streakDays.bulkAdd(
      Array.from({ length: 7 }, (_, i) => {
        const day = addDays(today, i - 6)
        return {
          id: day,
          day,
          focusMinutes: 25,
          focusSessions: 1,
          pomodoros: 1,
          tasksDone: 0,
          dailyGoalTarget: 4,
          dailyGoalHit: false,
          qualified: true,
          xp: 0,
        }
      }),
    )
    await vi.waitFor(() => expect(announcedIds()).toEqual(['streak-7']))
  })
})
