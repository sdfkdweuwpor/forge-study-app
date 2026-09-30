import { describe, expect, it } from 'vitest'
import { buildErrorReport } from './errorReport'

const AT = Date.UTC(2026, 8, 29, 13, 30)

const base = {
  where: 'the app',
  appVersion: '0.1.0',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141',
  url: '/tasks/all?seed=wgu',
  at: AT,
}

describe('buildErrorReport', () => {
  it('states when, where, which version and which browser, then the error', () => {
    const text = buildErrorReport({
      ...base,
      error: {
        name: 'TypeError',
        message: "Cannot read properties of null (reading 'theme')",
        stack:
          "TypeError: Cannot read properties of null (reading 'theme')\n    at ThemeProvider (app.js:1:2)\n    at renderWithHooks (react.js:3:4)",
      },
    })
    expect(text.split('\n').slice(0, 7)).toEqual([
      'Forge error report',
      'When: 2026-09-29T13:30:00.000Z',
      'Where: the app',
      'Page: /tasks/all?seed=wgu',
      'Version: 0.1.0',
      'Browser: Mozilla/5.0 (X11; Linux x86_64) Chrome/141',
      '',
    ])
    expect(text).toContain("TypeError: Cannot read properties of null (reading 'theme')")
    // The stack's first line repeats the message, so it is not printed twice.
    expect(text.match(/Cannot read properties/g)).toHaveLength(1)
    expect(text).toContain('at ThemeProvider')
  })

  it('does not print "Error:" for a plain Error', () => {
    const text = buildErrorReport({ ...base, error: { name: 'Error', message: 'boom' } })
    expect(text.split('\n').at(-1)).toBe('boom')
  })

  it('handles an error with no message or stack', () => {
    const text = buildErrorReport({ ...base, error: { message: '' } })
    expect(text).toContain('Unknown error')
  })

  it('cuts a long stack and lists only the last few earlier problems', () => {
    const stack = [
      'Error: x',
      ...Array.from({ length: 40 }, (_, i) => `    at frame${i} (a.js:${i}:1)`),
    ].join('\n')
    const recent = Array.from({ length: 9 }, (_, i) => ({
      at: AT - (9 - i) * 1000,
      message: `problem ${i}`,
      detail: i === 8 ? 'in <TaskRow>\nin <List>' : undefined,
    }))
    const text = buildErrorReport({ ...base, error: { message: 'x', stack }, recent })
    expect(text).toContain('at frame11')
    expect(text).not.toContain('at frame12')
    expect(text).toContain('(28 more lines)')
    expect(text).toContain('- 2026-09-29T13:29:59.000Z problem 8 (in <TaskRow>)')
    expect(text).not.toContain('problem 3')
    expect(text).toContain('problem 4')
  })

  it('never grows past a message-sized report', () => {
    const text = buildErrorReport({
      ...base,
      error: { message: 'm'.repeat(50_000), stack: 's'.repeat(50_000) },
      userAgent: 'u'.repeat(50_000),
    })
    expect(text.length).toBeLessThanOrEqual(4000)
  })
})
