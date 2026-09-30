import { describe, expect, it } from 'vitest'
import {
  CLOCK_JUMP_MS,
  SNAPSHOT_KEEP,
  TRASH_DAYS,
  clockJumpedForward,
  dailyDue,
  daysUntilPurge,
  formatBytes,
  isExpired,
  purgeLabel,
  snapshotFilename,
  snapshotContents,
  snapshotKindLabel,
  snapshotsToPrune,
  trashExpiry,
  whenLabel,
  type SnapshotStub,
} from './retention'

// The tests run in America/New_York: DST began Sun 2026-03-08 (23 h day) and ends Sun 2026-11-01 (25 h day).
const at = (y: number, m: number, d: number, h = 9, min = 30): number =>
  new Date(y, m - 1, d, h, min).getTime()

describe('trashExpiry', () => {
  it('is 30 calendar days later at the same local time', () => {
    expect(TRASH_DAYS).toBe(30)
    expect(trashExpiry(at(2026, 9, 29))).toBe(at(2026, 10, 29))
  })

  it('keeps the local time across the spring DST change (30 x 24 h would be 10:30)', () => {
    const deleted = at(2026, 3, 1, 9, 30)
    const expires = trashExpiry(deleted)
    expect(expires).toBe(at(2026, 3, 31, 9, 30))
    expect(expires - deleted).toBe(TRASH_DAYS * 24 * 60 * 60 * 1000 - 60 * 60 * 1000)
  })

  it('keeps the local time across the autumn DST change (30 x 24 h would be 8:30)', () => {
    const deleted = at(2026, 10, 15, 9, 30)
    const expires = trashExpiry(deleted)
    expect(expires).toBe(at(2026, 11, 14, 9, 30))
    expect(expires - deleted).toBe(TRASH_DAYS * 24 * 60 * 60 * 1000 + 60 * 60 * 1000)
  })

  it('handles month and year ends', () => {
    expect(trashExpiry(at(2026, 12, 15, 23, 59))).toBe(at(2027, 1, 14, 23, 59))
    expect(trashExpiry(at(2028, 2, 10, 0, 5))).toBe(at(2028, 3, 11, 0, 5))
  })

  it('moves a time inside the spring gap to the first real instant after it', () => {
    // 2:30 does not exist on 2026-03-08 (clocks jump from 2:00 to 3:00).
    const expires = trashExpiry(at(2026, 2, 6, 2, 30))
    expect(new Date(expires).getDate()).toBe(8)
    expect(new Date(expires).getHours()).toBe(3)
  })
})

describe('daysUntilPurge and purgeLabel', () => {
  it('reads "Deletes in 30 days" for an item trashed just now, and counts down by calendar day', () => {
    const now = at(2026, 9, 29)
    const expires = trashExpiry(now)
    expect(daysUntilPurge(expires, now)).toBe(30)
    expect(purgeLabel(expires, now)).toBe('Deletes in 30 days')
    expect(purgeLabel(expires, at(2026, 9, 30, 23, 59))).toBe('Deletes in 29 days')
    expect(purgeLabel(expires, at(2026, 10, 28, 0, 0))).toBe('Deletes tomorrow')
    expect(purgeLabel(expires, at(2026, 10, 29, 8, 0))).toBe('Deletes today')
  })

  it('never skips or repeats a number when a DST change is in the window', () => {
    // Trashed 2026-10-15 09:30; the clocks fall back on 2026-11-01. One label per calendar day.
    const deleted = at(2026, 10, 15)
    const expires = trashExpiry(deleted)
    const labels: number[] = []
    for (let d = 0; d <= 30; d += 1) {
      labels.push(daysUntilPurge(expires, at(2026, 10, 15 + d)))
    }
    expect(labels).toEqual(Array.from({ length: 31 }, (_, i) => 30 - i))
  })

  it('never goes below zero', () => {
    expect(daysUntilPurge(at(2026, 9, 1), at(2026, 9, 29))).toBe(0)
    expect(purgeLabel(at(2026, 9, 1), at(2026, 9, 29))).toBe('Deletes today')
  })

  it('is expired at the instant, not before', () => {
    const expires = at(2026, 10, 29)
    expect(isExpired(expires, expires - 1)).toBe(false)
    expect(isExpired(expires, expires)).toBe(true)
    expect(isExpired(expires, expires + 1)).toBe(true)
  })
})

describe('clockJumpedForward', () => {
  const at0 = at(2026, 9, 29)

  it('is not a jump on the first start, or for an ordinary gap', () => {
    expect(clockJumpedForward(null, at0)).toBe(false)
    expect(clockJumpedForward(at0, at0 + 60_000)).toBe(false)
    expect(clockJumpedForward(at0, at0 + CLOCK_JUMP_MS)).toBe(false)
  })

  it('is a jump once the gap passes two days, even by a minute', () => {
    expect(clockJumpedForward(at0, at0 + CLOCK_JUMP_MS + 60_000)).toBe(true)
    expect(clockJumpedForward(at0, at(2031, 1, 1))).toBe(true)
  })

  it('a clock set back is not a forward jump', () => {
    expect(clockJumpedForward(at0, at0 - 10 * CLOCK_JUMP_MS)).toBe(false)
  })
})

describe('dailyDue', () => {
  it('is due when it never ran or last ran on an earlier day', () => {
    expect(dailyDue(null, '2026-09-29')).toBe(true)
    expect(dailyDue('2026-09-28', '2026-09-29')).toBe(true)
    expect(dailyDue('2026-08-31', '2026-09-01')).toBe(true)
  })

  it('is not due on the same day, or when the clock went backwards', () => {
    expect(dailyDue('2026-09-29', '2026-09-29')).toBe(false)
    expect(dailyDue('2026-10-02', '2026-09-29')).toBe(false)
  })
})

describe('snapshotsToPrune', () => {
  const stub = (id: string, reason: SnapshotStub['reason'], createdAt: number): SnapshotStub => ({
    id,
    reason,
    createdAt,
  })

  it('keeps the newest 7 automatic and 5 of each other kind', () => {
    expect(SNAPSHOT_KEEP).toEqual({
      daily: 7,
      manual: 5,
      'pre-import': 5,
      'pre-restore': 5,
      'pre-reset': 5,
      'pre-sync': 5,
    })
    const rows: SnapshotStub[] = [
      ...Array.from({ length: 10 }, (_, i) => stub(`d${i}`, 'daily', 1000 + i)),
      ...Array.from({ length: 7 }, (_, i) => stub(`m${i}`, 'manual', 2000 + i)),
      ...Array.from({ length: 6 }, (_, i) => stub(`i${i}`, 'pre-import', 3000 + i)),
      stub('r0', 'pre-restore', 4000),
      ...Array.from({ length: 5 }, (_, i) => stub(`x${i}`, 'pre-reset', 5000 + i)),
    ]
    const doomed = snapshotsToPrune(rows)
    // The three oldest daily, the two oldest manual, the oldest pre-import go; nothing else.
    expect(doomed.sort()).toEqual(['d0', 'd1', 'd2', 'i0', 'm0', 'm1'])
  })

  it('does not let one kind push another out', () => {
    const rows: SnapshotStub[] = [
      ...Array.from({ length: 7 }, (_, i) => stub(`d${i}`, 'daily', i)),
      ...Array.from({ length: 5 }, (_, i) => stub(`m${i}`, 'manual', 100 + i)),
    ]
    expect(snapshotsToPrune(rows)).toEqual([])
  })

  it('breaks a tie in time by id, so the result is stable', () => {
    const rows = Array.from({ length: 9 }, (_, i) => stub(`d${i}`, 'daily', 500))
    const first = snapshotsToPrune(rows)
    const second = snapshotsToPrune([...rows].reverse())
    expect(first).toHaveLength(2)
    expect(second).toEqual(first)
  })

  it('keeps an unknown kind whole: pruning never deletes what it cannot judge', () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      stub(`z${i}`, 'from-the-future' as SnapshotStub['reason'], i),
    )
    expect(snapshotsToPrune(rows)).toEqual([])
    // ...while the known kinds beside it are still trimmed.
    const mixed = [...rows, ...Array.from({ length: 9 }, (_, i) => stub(`d${i}`, 'daily', i))]
    expect(snapshotsToPrune(mixed).sort()).toEqual(['d0', 'd1'])
  })

  it('accepts other limits', () => {
    const rows = [stub('a', 'daily', 1), stub('b', 'daily', 2), stub('c', 'daily', 3)]
    expect(snapshotsToPrune(rows, { ...SNAPSHOT_KEEP, daily: 1 }).sort()).toEqual(['a', 'b'])
  })
})

describe('labels', () => {
  it('names each kind', () => {
    expect(snapshotKindLabel('daily')).toBe('Automatic')
    expect(snapshotKindLabel('pre-reset')).toBe('Before reset')
    expect(snapshotKindLabel('pre-sync')).toBe('Before sync')
    expect(snapshotKindLabel('constructor')).toBe('constructor')
  })

  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(812)).toBe('812 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(48 * 1024)).toBe('48 KB')
    expect(formatBytes(1.3 * 1024 * 1024)).toBe('1.3 MB')
    expect(formatBytes(120 * 1024 * 1024)).toBe('120 MB')
  })

  it('names a downloaded snapshot by local day, time and kind', () => {
    expect(snapshotFilename(at(2026, 9, 29, 9, 5), 'manual')).toBe(
      'forge-snapshot-2026-09-29-0905-manual.json',
    )
  })
})

describe('snapshotContents and whenLabel', () => {
  it('lists what a snapshot holds, and nothing for an old one that did not count', () => {
    expect(snapshotContents(null)).toBe('')
    expect(snapshotContents({})).toBe('')
    expect(snapshotContents({ tasks: 1 })).toBe('1 task')
    expect(
      snapshotContents({ goals: 1, milestones: 20, tasks: 31, sessions: 2000, xpEvents: 900 }),
    ).toBe('1 goal, 20 courses, 31 tasks and 2,000 sessions')
  })

  it('says Today and Yesterday by calendar day, and the date otherwise', () => {
    const now = at(2026, 9, 29, 15, 0)
    expect(whenLabel(at(2026, 9, 29, 9, 30), now)).toBe('Today, 9:30 AM')
    expect(whenLabel(at(2026, 9, 28, 23, 59), now)).toBe('Yesterday, 11:59 PM')
    expect(whenLabel(at(2026, 9, 27, 8, 5), now)).toBe('Sep 27, 8:05 AM')
    expect(whenLabel(at(2025, 12, 30, 20, 5), now)).toBe('Dec 30, 2025, 8:05 PM')
  })

  it('counts calendar days across a DST change', () => {
    // Sun 2026-11-01 has 25 hours; 00:30 that day is still "Yesterday" at 00:10 the next day.
    expect(whenLabel(at(2026, 11, 1, 0, 30), at(2026, 11, 2, 0, 10))).toBe('Yesterday, 12:30 AM')
  })
})
