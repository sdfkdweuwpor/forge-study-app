import { describe, expect, it } from 'vitest'
import { makeTask, para } from './fixtures'
import { tasksToMarkdown } from './markdown'

const ctx = {
  goals: [
    { id: 'g1', title: 'B.S. Computer Science' },
    { id: 'g2', title: 'Life admin' },
  ],
  milestones: [{ id: 'm1', code: 'C182', title: 'Introduction to IT' }],
}

describe('tasksToMarkdown by date', () => {
  const tasks = [
    makeTask({
      id: 'a',
      title: 'Read chapter 4',
      doDate: '2026-10-01',
      dueDate: '2026-10-03',
      tags: ['wgu'],
      milestoneId: 'm1',
      durationMinutes: 50,
      notes: [para('n1', 'Skim the summary'), para('n2', 'Then the quiz')],
    }),
    makeTask({ id: 'b', title: 'Pay phone bill', status: 'done', doDate: '2026-10-01', order: 2 }),
    makeTask({ id: 'c', title: 'Someday: sort photos' }),
  ]
  const md = tasksToMarkdown(tasks, ctx)

  it('groups by do date, then No date', () => {
    expect(md.indexOf('## Thursday, Oct 1, 2026')).toBeGreaterThan(0)
    expect(md.indexOf('## No date')).toBeGreaterThan(md.indexOf('## Thursday'))
  })
  it('writes checkboxes with inline meta and indented notes', () => {
    expect(md).toContain('- [ ] Read chapter 4 — due Sat Oct 3 · #wgu · C182 · 50 min')
    expect(md).toContain('  Skim the summary\n  Then the quiz')
    expect(md).toContain('- [x] Pay phone bill')
    expect(md).toContain('- [ ] Someday: sort photos')
  })
  it('says so when nothing matches', () => {
    expect(tasksToMarkdown([], ctx)).toContain('_No tasks match._')
  })
})

describe('tasksToMarkdown by goal', () => {
  it('groups by goal name with No goal last and shows the do date inline', () => {
    const md = tasksToMarkdown(
      [
        makeTask({ id: 'a', title: 'Errand', goalId: 'g2', doDate: '2026-10-02' }),
        makeTask({ id: 'b', title: 'Study', goalId: 'g1', doDate: '2026-10-01', doTime: '19:00' }),
        makeTask({ id: 'c', title: 'Loose end' }),
      ],
      { ...ctx, groupBy: 'goal' },
    )
    const order = ['## B.S. Computer Science', '## Life admin', '## No goal'].map((h) =>
      md.indexOf(h),
    )
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    expect(md).toContain('- [ ] Study — at 19:00 · do Thu Oct 1')
  })

  it('keeps a multi-line title on one line', () => {
    expect(tasksToMarkdown([makeTask({ title: 'a\nb' })], ctx)).toContain('- [ ] a b')
  })
})
