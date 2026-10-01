import { describe, expect, it } from 'vitest'
import { EXAMPLE_JSON } from './example'
import { parsePlan } from './parse'
import { buildPrompt, fieldLines, OUTLINE_PLACEHOLDER } from './prompt'
import { fieldDoc, fieldDocs, generalPath } from './reference'

describe('schema reference (generated from the Zod schema)', () => {
  const docs = fieldDocs()
  const byPath = new Map(docs.map((d) => [d.path, d]))

  it('lists every field of the format in document order', () => {
    const paths = docs.map((d) => d.path)
    expect(paths.slice(0, 4)).toEqual(['forgePlan', 'goal', 'goal.name', 'goal.icon'])
    for (const path of [
      'goal.term.start',
      'goal.availability.hoursPerWeekday.sun',
      'goal.availability.daysOff[].to',
      'courses[].code',
      'courses[].estimatedHours',
      'courses[].prerequisites',
      'courses[].units[].estimatedMinutes',
      'courses[].assessments[].kind',
    ]) {
      expect(paths).toContain(path)
    }
  })

  it('derives type and requirement from the schema, not from hand-written text', () => {
    expect(byPath.get('courses[].code')).toMatchObject({ type: 'text', required: 'required' })
    expect(byPath.get('courses[].estimatedHours')).toMatchObject({
      type: 'number > 0, up to 1000',
      required: 'required',
    })
    expect(byPath.get('courses[].type')).toMatchObject({ type: '"OA" | "PA"', required: 'optional' })
    expect(byPath.get('courses[].assessments[].kind')?.type).toBe('"exam" | "project" | "quiz"')
    expect(byPath.get('goal.targetDate')?.type).toBe('date YYYY-MM-DD')
    expect(byPath.get('goal.term.start')?.required).toBe('with-parent')
    expect(byPath.get('courses[].units[].title')?.required).toBe('with-parent')
    expect(byPath.get('goal.availability.hoursPerWeekday.mon')?.type).toBe('number 0–24')
    expect(byPath.get('forgePlan')?.type).toBe('1')
  })

  it('documents every field (a new schema field cannot ship without a description)', () => {
    expect(docs.filter((d) => d.description.trim() === '').map((d) => d.path)).toEqual([])
  })

  it('finds a field from a concrete issue path', () => {
    expect(generalPath(['courses', 2, 'units', 0, 'title'])).toBe('courses[].units[].title')
    expect(fieldDoc(generalPath(['courses', 0, 'cus']))?.expects).toMatch(/whole number/)
  })
})

describe('example', () => {
  it('is a valid plan with no warnings and covers every kind of field', () => {
    const r = parsePlan(EXAMPLE_JSON)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings).toEqual([])
    expect(r.plan.courses.flatMap((c) => c.assessments ?? []).map((a) => a.kind)).toEqual([
      'exam',
      'project',
    ])
  })
})

describe('buildPrompt', () => {
  const prompt = buildPrompt({ today: '2026-09-29' })

  it('has the placeholder for the outline and asks for JSON only', () => {
    expect(prompt).toContain(OUTLINE_PLACEHOLDER)
    expect(prompt).toContain('PASTE YOUR COURSE OUTLINE / DEGREE PLAN HERE')
    expect(prompt).toMatch(/ONLY the JSON object/)
    expect(prompt).toMatch(/no Markdown code fences/)
  })

  it('tells the user they can attach a photo or PDF of the syllabus', () => {
    expect(prompt).toMatch(/attach a photo or PDF of your syllabus/)
    expect(prompt).toMatch(/If I attached a photo or PDF/)
  })

  it('contains every schema field and the example verbatim', () => {
    for (const line of fieldLines()) expect(prompt).toContain(line)
    expect(prompt).toContain(EXAMPLE_JSON.trimEnd())
    expect(prompt).toContain('C182')
    expect(prompt).toContain('C779')
    expect(prompt).toContain('D278')
  })

  it('includes today only when given', () => {
    expect(prompt).toContain('Today is 2026-09-29.')
    expect(buildPrompt()).not.toContain('Today is')
  })

  it('shows the example as a JSON object that parses back to the plan', () => {
    const start = prompt.indexOf('EXAMPLE OF A VALID REPLY')
    const reply = prompt.slice(start, prompt.indexOf('MY COURSE OUTLINE'))
    expect(parsePlan(reply).ok).toBe(true)
  })
})
