import { describe, expect, it } from 'vitest'
import { csvField, csvRow, describeRecurrence, tasksToCsv } from './csv'
import { makeTask, para } from './fixtures'

const ctx = {
  goals: [{ id: 'g1', title: 'B.S. Computer Science' }],
  milestones: [{ id: 'm1', code: 'C182', title: 'Introduction to IT' }],
}

describe('csvField (RFC 4180)', () => {
  it('leaves plain text alone', () => {
    expect(csvField('Read chapter 4')).toBe('Read chapter 4')
  })
  it('quotes commas, quotes, CR and LF, and doubles quotes', () => {
    expect(csvField('a,b')).toBe('"a,b"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('line1\nline2')).toBe('"line1\nline2"')
    expect(csvField('line1\r\nline2')).toBe('"line1\r\nline2"')
  })
  it('quotes leading and trailing spaces', () => {
    expect(csvField(' x')).toBe('" x"')
    expect(csvField('x ')).toBe('"x "')
  })
  it('defuses formulas: a leading = + - @ tab or CR gets a leading apostrophe', () => {
    expect(csvField('=1+1')).toBe("'=1+1")
    expect(csvField('+44 20 7946 0958')).toBe("'+44 20 7946 0958")
    expect(csvField('-2 days')).toBe("'-2 days")
    expect(csvField('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)")
    expect(csvField('\tcmd')).toBe("'\tcmd")
    expect(csvField('\rcmd')).toBe('"\'\rcmd"')
  })
  it('quotes a defused field that also needs quotes, and leaves mid-text characters alone', () => {
    expect(csvField('=HYPERLINK("http://x.test","click")')).toBe(
      '"\'=HYPERLINK(""http://x.test"",""click"")"',
    )
    expect(csvField('a=b')).toBe('a=b')
    expect(csvField('C182 - Intro')).toBe('C182 - Intro')
    expect(csvField('2026-10-01')).toBe('2026-10-01')
  })
  it('keeps unicode and empty fields', () => {
    expect(csvField('Café ✓ 日本語')).toBe('Café ✓ 日本語')
    expect(csvField('')).toBe('')
    expect(csvRow(['a', '', 'b,c'])).toBe('a,,"b,c"')
  })
})

describe('tasksToCsv', () => {
  it('writes the header and CRLF rows with a final CRLF', () => {
    const csv = tasksToCsv([makeTask()], ctx)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe(
      'title,status,priority,do date,do time,duration min,due date,due time,estimate pomodoros,tags,goal,course code,kind,recurrence,completed at,notes',
    )
    expect(lines[1]).toBe('Read chapter 4,todo,none,,,,,,,,,,task,,,')
    expect(lines[2]).toBe('')
    expect(lines).toHaveLength(3)
  })

  it('fills every column', () => {
    const t = makeTask({
      title: 'C182 · Operating systems (2/4)',
      priority: 3,
      doDate: '2026-10-01',
      doTime: '19:00',
      durationMinutes: 50,
      dueDate: '2026-10-03',
      dueTime: '17:00',
      estimatePomodoros: 2,
      tags: ['wgu', 'c182'],
      goalId: 'g1',
      milestoneId: 'm1',
      kind: 'study',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3] },
      notes: [para('b1', 'Focus on "scheduling", not memory'), para('b2', 'Second line')],
    })
    const row = tasksToCsv([t], ctx).split('\r\n')[1]
    expect(row).toBe(
      'C182 · Operating systems (2/4),todo,high,2026-10-01,19:00,50,2026-10-03,17:00,2,wgu; c182,B.S. Computer Science,C182,study,weekly on Mon Wed,,"Focus on ""scheduling"", not memory\nSecond line"',
    )
  })

  it('formats completed-at in local time (TZ-safe input as epoch ms)', () => {
    const at = new Date(2026, 8, 30, 21, 5).getTime()
    const csv = tasksToCsv([makeTask({ status: 'done', completedAt: at })], ctx)
    expect(csv).toContain(',2026-09-30 21:05,')
  })

  it('does not let a task title, tag or note run as a formula', () => {
    const t = makeTask({
      title: '=cmd|\' /C calc\'!A0',
      tags: ['@home'],
      notes: [para('b1', '+1 800 555 0100')],
    })
    const row = tasksToCsv([t], ctx).split('\r\n')[1] ?? ''
    expect(row.startsWith("'=cmd|' /C calc'!A0,")).toBe(true)
    expect(row).toContain(",'@home,")
    expect(row.endsWith(",'+1 800 555 0100")).toBe(true)
  })

  it('adds a BOM only when asked', () => {
    expect(tasksToCsv([], ctx).charCodeAt(0)).not.toBe(0xfeff)
    expect(tasksToCsv([], { ...ctx, bom: true }).charCodeAt(0)).toBe(0xfeff)
  })

  it('filters by scope and date range', () => {
    const open = makeTask({ id: 'a', title: 'Open', doDate: '2026-10-01' })
    const done = makeTask({ id: 'b', title: 'Done', status: 'done', completedDay: '2026-09-20' })
    const later = makeTask({ id: 'c', title: 'Later', dueDate: '2026-11-01' })
    const titles = (csv: string): string[] =>
      csv
        .split('\r\n')
        .slice(1, -1)
        .map((r) => r.split(',')[0] ?? '')
    expect(titles(tasksToCsv([open, done, later], { ...ctx, scope: 'open' }))).toEqual([
      'Open',
      'Later',
    ])
    expect(titles(tasksToCsv([open, done, later], { ...ctx, scope: 'completed' }))).toEqual([
      'Done',
    ])
    expect(
      titles(tasksToCsv([open, done, later], { ...ctx, from: '2026-10-01', to: '2026-10-31' })),
    ).toEqual(['Open'])
    expect(titles(tasksToCsv([open, done, later], ctx))).toEqual(['Done', 'Open', 'Later'])
  })

  it('outputs the same text whatever the input order', () => {
    const a = makeTask({ id: 'a', title: 'A', doDate: '2026-10-02' })
    const b = makeTask({ id: 'b', title: 'B', doDate: '2026-10-01' })
    expect(tasksToCsv([a, b], ctx)).toBe(tasksToCsv([b, a], ctx))
  })
})

describe('describeRecurrence', () => {
  it('reads naturally', () => {
    expect(describeRecurrence(null)).toBe('')
    expect(describeRecurrence({ freq: 'daily', interval: 1, byWeekday: [] })).toBe('daily')
    expect(describeRecurrence({ freq: 'daily', interval: 3, byWeekday: [] })).toBe('every 3 days')
    expect(describeRecurrence({ freq: 'weekdays', interval: 1, byWeekday: [] })).toBe('weekdays')
    expect(describeRecurrence({ freq: 'weekly', interval: 2, byWeekday: [5] })).toBe(
      'every 2 weeks on Fri',
    )
  })
})
