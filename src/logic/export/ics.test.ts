import { describe, expect, it } from 'vitest'
import { escapeText, foldLine, toIcs, type IcsEvent } from './ics'

const NOW = Date.UTC(2026, 8, 30, 13, 30, 5)
const opts = { calName: 'Forge study plan', now: NOW }

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeText('a,b;c\\d\ne\r\nf')).toBe(String.raw`a\,b\;c\\d\ne\nf`)
  })
})

describe('foldLine', () => {
  it('leaves a 75-octet line alone and folds a 76-octet one', () => {
    expect(foldLine('x'.repeat(75))).toBe('x'.repeat(75))
    expect(foldLine('x'.repeat(76))).toBe(`${'x'.repeat(75)}\r\n x`)
  })
  it('keeps every physical line within 75 octets and unfolds losslessly', () => {
    const long = `SUMMARY:${'Operating systems, scheduling; ✓ 日本語 '.repeat(12)}`
    const folded = foldLine(long)
    const enc = new TextEncoder()
    for (const l of folded.split('\r\n')) expect(enc.encode(l).length).toBeLessThanOrEqual(75)
    expect(folded.replace(/\r\n /g, '')).toBe(long)
  })
  it('never splits a multi-byte character', () => {
    const folded = foldLine(`S:${'日'.repeat(40)}`)
    expect(folded.replace(/\r\n /g, '')).toBe(`S:${'日'.repeat(40)}`)
    expect(folded).not.toContain('�')
  })
})

const timed: IcsEvent = {
  uid: 't1@forge',
  summary: 'C182 · Operating systems (2/4)',
  date: '2026-10-01',
  start: '19:00',
  durationMinutes: 50,
}
const allDay: IcsEvent = {
  uid: 'due-t2@forge',
  summary: 'Due: Pay bill, now',
  allDay: true,
  date: '2026-10-03',
}

describe('toIcs', () => {
  const text = toIcs([timed, allDay], opts)
  const lines = text.split('\r\n')

  it('is a CRLF-terminated VCALENDAR with PRODID and version', () => {
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(lines.slice(0, 3)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Forge//Study Planner//EN',
    ])
    expect(text).toContain('X-WR-CALNAME:Forge study plan')
  })

  it('writes DTSTAMP in UTC from the injected clock', () => {
    expect(text).toContain('DTSTAMP:20260930T133005Z')
  })

  it('writes timed events as floating local time with the end computed on the wall clock', () => {
    expect(text).toContain('UID:t1@forge')
    expect(text).toContain('DTSTART:20261001T190000')
    expect(text).toContain('DTEND:20261001T195000')
    expect(text).toContain('SUMMARY:C182 · Operating systems (2/4)')
  })

  it('writes all-day events with VALUE=DATE and an exclusive end, escaping text', () => {
    expect(text).toContain('DTSTART;VALUE=DATE:20261003')
    expect(text).toContain('DTEND;VALUE=DATE:20261004')
    expect(text).toContain('SUMMARY:Due: Pay bill\\, now')
  })

  it('makes a multi-day all-day event end the day after its last day, across a month', () => {
    const t = toIcs(
      [
        {
          uid: 'x@forge',
          summary: 'Break',
          allDay: true,
          date: '2026-10-30',
          endDate: '2026-10-31',
        },
      ],
      opts,
    )
    expect(t).toContain('DTEND;VALUE=DATE:20261101')
    const y = toIcs([{ uid: 'y@forge', summary: 'NYE', allDay: true, date: '2026-12-31' }], opts)
    expect(y).toContain('DTEND;VALUE=DATE:20270101')
  })

  it('rolls a block past midnight into the next day', () => {
    const t = toIcs([{ ...timed, start: '23:30', durationMinutes: 60 }], opts)
    expect(t).toContain('DTSTART:20261001T233000')
    expect(t).toContain('DTEND:20261002T003000')
  })

  it('keeps UIDs stable across runs with different clocks', () => {
    const uids = (s: string): string[] => s.split('\r\n').filter((l) => l.startsWith('UID:'))
    expect(uids(toIcs([timed, allDay], { ...opts, now: NOW + 86_400_000 }))).toEqual(uids(text))
  })

  it('does not shift wall-clock times across a DST change (floating time)', () => {
    // US spring forward 2026-03-08 and fall back 2026-11-01: 19:00 stays 19:00, 50 minutes stays 50.
    for (const date of ['2026-03-08', '2026-11-01']) {
      const t = toIcs([{ ...timed, date }], opts)
      expect(t).toContain(`DTSTART:${date.replace(/-/g, '')}T190000`)
      expect(t).toContain(`DTEND:${date.replace(/-/g, '')}T195000`)
      expect(t).not.toMatch(/DTSTART:[^\r]*Z/)
    }
  })

  it('folds long summaries and skips malformed events', () => {
    const t = toIcs(
      [
        { ...timed, summary: 'Long, '.repeat(30) },
        { ...timed, uid: 'bad@forge', date: '2026-02-30' },
        { ...timed, uid: 'bad2@forge', start: '25:00' },
      ],
      opts,
    )
    expect(t).not.toContain('bad')
    for (const l of t.split('\r\n'))
      expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
  })

  it('produces an empty but valid calendar for no events', () => {
    expect(toIcs([], opts)).not.toContain('BEGIN:VEVENT')
  })
})
