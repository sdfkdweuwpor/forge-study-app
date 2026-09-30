import { describe, expect, it } from 'vitest'
import { compareISODate } from './dates'
import { suggestTemplate, TEMPLATES, templateById, templatePlanDraft, wguTemplate } from './goalTemplates'
import { applyTemplate, emptyPlannerDraft, previewPlanner } from './plannerDraft'

const TODAY = '2026-09-29'
const keys = () => {
  let n = 0
  return () => `k${++n}`
}

describe('templates', () => {
  it('are exactly the four the planner offers', () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual([
      'wgu-term',
      'certification',
      'semester-course',
      'personal-project',
    ])
    expect(TEMPLATES.map((t) => t.name)).toEqual([
      'WGU term',
      'Certification',
      'Semester course',
      'Personal project',
    ])
  })

  it('WGU term has the seven C182/C779/D278 courses, 24 CUs, 310 h and an assessment each', () => {
    const plan = templatePlanDraft(templateById('wgu-term'), TODAY)
    expect(plan.courses.map((c) => c.code)).toEqual(['C182', 'C779', 'D278', 'C172', 'C959', 'D426', 'C867'])
    expect(plan.courses.reduce((n, c) => n + (c.cus ?? 0), 0)).toBe(24)
    expect(plan.courses.reduce((n, c) => n + (c.estimatedHours ?? 0), 0)).toBe(310)
    expect(plan.courses.every((c) => c.assessments.length === 1)).toBe(true)
    expect(plan.courses.find((c) => c.code === 'C867')?.prerequisites).toEqual(['D278'])
    expect(plan.goal.term).toEqual({ start: TODAY, end: '2027-03-28' })
  })

  it('certification has the A+ domains and a practice-exam checkpoint before the exam', () => {
    const plan = templatePlanDraft(templateById('certification'), TODAY)
    expect(plan.courses.map((c) => c.title)).toContain('Mobile Devices')
    const kinds = plan.courses.flatMap((c) => c.assessments.map((a) => `${a.kind}:${a.title}`))
    expect(kinds[0]).toMatch(/^quiz:Practice exam checkpoint/)
    expect(kinds.at(-1)).toMatch(/^exam:CompTIA A\+ Core 1/)
  })

  it('semester course has weekly topics, a midterm and a final, dated on weekdays', () => {
    const plan = templatePlanDraft(templateById('semester-course'), TODAY)
    const dated = plan.courses.flatMap((c) => c.assessments)
    expect(dated.map((a) => a.title)).toEqual(['Midterm exam', 'Final project due', 'Final exam'])
    for (const a of dated) {
      const day = new Date(`${a.date}T12:00:00`).getDay()
      expect(day).toBeGreaterThan(0)
      expect(day).toBeLessThan(6)
    }
    expect(compareISODate(dated[0]?.date ?? '', dated[2]?.date ?? '')).toBe(-1)
    expect(plan.courses.flatMap((c) => c.units).length).toBe(15)
  })

  it('personal project has phases', () => {
    const plan = templatePlanDraft(templateById('personal-project'), TODAY)
    expect(plan.courses.map((c) => c.title)).toEqual(['Plan', 'Design', 'Build', 'Launch'])
  })

  it.each(TEMPLATES.map((t) => [t.id]))('%s fits inside its own finish date', (id) => {
    const t = templateById(id)
    const draft = applyTemplate(emptyPlannerDraft(TODAY), t, { newKey: keys(), today: TODAY })
    const plan = previewPlanner(draft, TODAY)
    expect(plan.result.fits).toBe(true)
    expect(plan.result.issues).toEqual([])
  })

  it('suggests one from a typed goal', () => {
    expect(suggestTemplate('Pass the CompTIA Security+ exam')?.id).toBe('certification')
    expect(suggestTemplate('Finish my WGU degree term')?.id).toBe('wgu-term')
    expect(suggestTemplate('Learn to juggle')).toBeNull()
  })

  it('keeps the older draft form of the WGU term for the form editors', () => {
    const draft = wguTemplate(TODAY, keys())
    expect(draft.courses).toHaveLength(7)
    expect(draft.targetDate).toBe('2027-03-28')
  })
})
