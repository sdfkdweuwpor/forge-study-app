import { describe, expect, it } from 'vitest'
import { EXAMPLE_JSON } from './example'
import { extractJson, parsePlan, pathText, type ParseResult, type PlanIssue } from './parse'

const errorsOf = (r: ParseResult): PlanIssue[] => {
  if (r.ok) throw new Error('expected errors')
  return r.errors
}

type Loose = Record<string, unknown>
interface Course extends Loose {
  units: Loose[]
}
interface Draft extends Loose {
  goal: Loose & { term: Loose; availability: Loose }
  courses: Course[]
}

/** Course `i` of a draft (the example has three). */
function c(p: Draft, i: number): Course {
  const course = p.courses[i]
  if (!course) throw new Error(`the draft has no course ${i}`)
  return course
}

/** The example plan as text, with `edit` applied to it first. */
function plan(edit: (p: Draft) => void = () => {}): string {
  const p = JSON.parse(EXAMPLE_JSON) as Draft
  edit(p)
  return JSON.stringify(p, null, 2)
}

describe('parsePlan: happy path', () => {
  it('accepts the documented example with no warnings', () => {
    const r = parsePlan(EXAMPLE_JSON)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings).toEqual([])
    expect(r.plan.courses.map((c) => c.code)).toEqual(['C182', 'D278', 'C779'])
    expect(r.plan.goal.term).toEqual({ start: '2026-10-01', end: '2027-03-31' })
    expect(r.plan.courses[0]?.units).toHaveLength(6)
  })

  it('trims strings, uppercases codes and accepts numbers written as strings', () => {
    const r = parsePlan(
      `{"forgePlan":"1","goal":{"name":"  Goal  "},"courses":[
        {"code":" c182 ","name":" Intro ","cus":"4","type":"oa","estimatedHours":" 40.5 ","prerequisites":[]},
        {"code":"d278","name":"Scripting","estimatedHours":"45","prerequisites":["c182"],"units":[{"title":" A ","estimatedMinutes":"90"}]}
      ]}`,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.goal.name).toBe('Goal')
    expect(r.plan.courses[0]).toMatchObject({
      code: 'C182',
      name: 'Intro',
      cus: 4,
      type: 'OA',
      estimatedHours: 40.5,
    })
    expect(r.plan.courses[1]?.prerequisites).toEqual(['C182'])
    expect(r.plan.courses[1]?.units?.[0]).toEqual({ title: 'A', estimatedMinutes: 90 })
  })

  it('treats null and blank optional values as left out', () => {
    const r = parsePlan(
      `{"forgePlan":1,"goal":{"name":"G","icon":"","targetDate":null},"courses":[{"code":"C1","name":"N","estimatedHours":5,"cus":null,"type":"  "}]}`,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.courses[0]).toEqual({ code: 'C1', name: 'N', estimatedHours: 5 })
  })
})

describe('extractJson and prose', () => {
  it('finds the object inside a fenced reply with chatter before and after', () => {
    const reply = `Sure! Here is your plan {as requested}:\n\n\`\`\`json\n${EXAMPLE_JSON}\`\`\`\n\nLet me know if you want changes {anything}.`
    const span = extractJson(reply)
    expect(span).not.toBeNull()
    const r = parsePlan(reply)
    expect(r.ok).toBe(true)
  })

  it('ignores braces inside strings when matching', () => {
    const r = parsePlan('x {"forgePlan":1,"goal":{"name":"a } b { c"},"courses":[{"code":"C1","name":"N","estimatedHours":1}]} tail')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.goal.name).toBe('a } b { c')
  })

  it('reports a reply with no JSON', () => {
    const [e] = errorsOf(parsePlan('I could not read that outline, sorry.'))
    expect(e?.message).toMatch(/No JSON found/)
    expect(parsePlan('').ok).toBe(false)
  })

  it('reports line numbers in the ORIGINAL text, not the extracted object', () => {
    const reply = `Here you go:\n\n\`\`\`json\n{\n  "forgePlan": 1,\n  "goal": { "name": "G" },\n  "courses": [\n    { "code": "C1", "name": "N", "estimatedHours": -3 }\n  ]\n}\n\`\`\``
    const [e] = errorsOf(parsePlan(reply))
    expect(e?.path).toBe('courses[0].estimatedHours')
    expect(e?.line).toBe(8)
  })
})

describe('syntax errors', () => {
  it('gives the line and column of a missing comma', () => {
    const [e, ...rest] = errorsOf(parsePlan('{\n  "forgePlan": 1\n  "goal": {}\n}'))
    expect(rest).toEqual([])
    expect(e).toMatchObject({ line: 2, column: 17, path: '' })
    expect(e?.message).toMatch(/comma/i)
  })

  it('handles a reply cut off in the middle', () => {
    const [e] = errorsOf(parsePlan('```json\n{\n  "forgePlan": 1,\n  "courses": [\n    { "code": "C1"'))
    expect(e?.message).toMatch(/ends too soon/)
    expect(e?.line).toBe(5)
  })
})

describe('schema errors map to lines', () => {
  it('points nested array elements at their own line', () => {
    const text = plan((p) => {
      c(p, 1).estimatedHours = 'lots'
      c(p, 2).units = [{ title: 'Layout', estimatedHours: 0 }]
    })
    const errors = errorsOf(parsePlan(text))
    const lines = text.split('\n')
    const hours = errors.find((e) => e.path === 'courses[1].estimatedHours')
    const unit = errors.find((e) => e.path === 'courses[2].units[0].estimatedHours')
    expect(hours?.message).toBe('courses[1].estimatedHours must be a positive number of hours')
    expect(lines[(hours?.line ?? 0) - 1]).toContain('"estimatedHours": "lots"')
    expect(unit?.message).toBe('courses[2].units[0].estimatedHours must be a positive number of hours')
    expect(lines[(unit?.line ?? 0) - 1]).toContain('"estimatedHours": 0')
  })

  it('says a missing field is required and points at its object', () => {
    const text = plan((p) => {
      Reflect.deleteProperty(c(p, 1), 'name')
    })
    const e = errorsOf(parsePlan(text)).find((x) => x.path === 'courses[1].name')
    expect(e?.message).toBe('courses[1].name is required')
    expect(text.split('\n')[(e?.line ?? 0) - 1]).toBe('    {')
  })

  it('requires the version, with a hint', () => {
    const [e] = errorsOf(parsePlan(plan((p) => void Reflect.deleteProperty(p, 'forgePlan'))))
    expect(e?.message).toMatch(/forgePlan is required: start the object with "forgePlan": 1/)
    const [wrong] = errorsOf(parsePlan(plan((p) => (p.forgePlan = 2))))
    expect(wrong?.message).toBe('forgePlan must be 1')
  })

  it('rejects unknown keys at the key, with a suggestion', () => {
    const text = plan((p) => {
      c(p, 0).prereqs = ['C779']
      c(p, 0).estimatedHour = 3
    })
    const errors = errorsOf(parsePlan(text))
    const prereq = errors.find((e) => e.path === 'courses[0].prereqs')
    expect(prereq?.message).toBe('courses[0].prereqs is not a known field; did you mean "prerequisites"?')
    expect(text.split('\n')[(prereq?.line ?? 0) - 1]).toContain('"prereqs"')
    expect(errors.find((e) => e.path === 'courses[0].estimatedHour')?.message).toMatch(/estimatedHours/)
  })

  it('explains enums, dates and whole numbers', () => {
    const errors = errorsOf(
      parsePlan(
        plan((p) => {
          c(p, 0).type = 'EXAM'
          c(p, 0).cus = 3.5
          p.goal.targetDate = '2027-02-30'
          p.goal.term.start = '10/01/2026'
        }),
      ),
    )
    const byPath = Object.fromEntries(errors.map((e) => [e.path, e.message]))
    expect(byPath['courses[0].type']).toBe('courses[0].type must be one of "OA" or "PA"')
    expect(byPath['courses[0].cus']).toBe('courses[0].cus must be a whole number of competency units from 1 to 99')
    expect(byPath['goal.targetDate']).toBe('goal.targetDate must be a date written YYYY-MM-DD, such as 2026-10-01')
    expect(byPath['goal.term.start']).toMatch(/must be a date written YYYY-MM-DD/)
  })

  it('checks field-level rules: both unit estimates, backwards term, all-zero week', () => {
    const errors = errorsOf(
      parsePlan(
        plan((p) => {
          c(p, 0).units[1] = { title: 'X', estimatedHours: 1, estimatedMinutes: 60 }
          p.goal.term.end = '2026-09-01'
          p.goal.availability.hoursPerWeekday = { mon: 0 }
          p.goal.availability.daysOff = [{ from: '2026-12-26', to: '2026-12-24' }]
        }),
      ),
    )
    const messages = errors.map((e) => e.message)
    expect(messages).toContain('courses[0].units[1] has both estimatedHours and estimatedMinutes; keep only one')
    expect(messages).toContain('goal.term.end must not be before term.start')
    expect(messages).toContain('goal.availability.hoursPerWeekday needs at least one day with more than 0 hours')
    expect(messages).toContain('goal.availability.daysOff[0].to must not be before "from"')
  })

  it('needs at least one course and an object at the root', () => {
    expect(errorsOf(parsePlan(plan((p) => (p.courses = []))))[0]?.message).toBe(
      'courses must be a list with 1 to 100 courses',
    )
    expect(errorsOf(parsePlan(plan((p) => void Reflect.deleteProperty(p, 'goal'))))[0]?.message).toBe('goal is required')
  })

  it('lists every problem at once, ordered by position', () => {
    const errors = errorsOf(
      parsePlan(
        plan((p) => {
          c(p, 2).estimatedHours = 0
          p.goal.name = 5
          c(p, 0).cus = 'four'
        }),
      ),
    )
    expect(errors).toHaveLength(3)
    expect(errors.map((e) => e.line)).toEqual([...errors.map((e) => e.line)].sort((a, b) => a - b))
  })
})

describe('cross-course checks', () => {
  it('rejects duplicate codes, ignoring case and spaces, on the second one', () => {
    const text = plan((p) => {
      c(p, 2).code = ' c182'
      Reflect.deleteProperty(c(p, 2), 'prerequisites') // it would otherwise also require itself
    })
    const errors = errorsOf(parsePlan(text))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      path: 'courses[2].code',
      message: 'courses[2].code is already used by courses[0]; course codes must be unique',
    })
    expect(text.split('\n')[(errors[0]?.line ?? 0) - 1]).toContain('"code": " c182"')
  })

  it('rejects unknown prerequisites with a did-you-mean', () => {
    const text = plan((p) => {
      c(p, 1).prerequisites = ['C183']
    })
    const [e] = errorsOf(parsePlan(text))
    expect(e?.path).toBe('courses[1].prerequisites[0]')
    expect(e?.message).toBe(
      'courses[1].prerequisites[0] refers to "C183", which is not a course in this plan; did you mean "C182"?',
    )
  })

  it('accepts prerequisites on courses of the goal being merged into', () => {
    const text = plan((p) => {
      c(p, 1).prerequisites = ['C999']
    })
    expect(parsePlan(text).ok).toBe(false)
    expect(parsePlan(text, { known: [{ code: 'C999', prerequisites: [] }] }).ok).toBe(true)
  })

  it('rejects a course that requires itself', () => {
    const [e] = errorsOf(parsePlan(plan((p) => (c(p, 0).prerequisites = ['c182']))))
    expect(e?.message).toBe('courses[0].prerequisites[0] lists its own course as a prerequisite')
  })

  it('rejects a prerequisite cycle once, naming the courses', () => {
    const text = plan((p) => {
      c(p, 0).prerequisites = ['C779']
    })
    const errors = errorsOf(parsePlan(text))
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toMatch(/closes a prerequisite cycle: (C182|C779) needs (C182|C779)/)
  })

  it('finds a longer cycle and one that runs through an existing course', () => {
    const three = plan((p) => {
      c(p, 0).prerequisites = ['C779']
      c(p, 1).prerequisites = ['C182']
      c(p, 2).prerequisites = ['D278']
    })
    const cycle = errorsOf(parsePlan(three))
    expect(cycle).toHaveLength(1)
    expect(cycle[0]?.message).toMatch(/cycle: \w+ needs \w+ needs \w+ needs \w+/)

    const viaExisting = plan((p) => {
      p.courses = [{ code: 'A1', name: 'A', estimatedHours: 5, prerequisites: ['B1'], units: [] }]
    })
    const known = [{ code: 'B1', prerequisites: ['A1'] }]
    const [e] = errorsOf(parsePlan(viaExisting, { known }))
    expect(e?.message).toMatch(/cycle: A1 needs B1 needs A1/)
  })

  it('warns when the units add up to something other than the course hours', () => {
    const r = parsePlan(plan((p) => (c(p, 0).estimatedHours = 60)))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]?.message).toContain('its units add up to 40 h but estimatedHours is 60 h')
  })
})

describe('pathText', () => {
  it('writes array indexes in brackets', () => {
    expect(pathText(['courses', 2, 'units', 0, 'title'])).toBe('courses[2].units[0].title')
    expect(pathText([])).toBe('')
  })
})
