// Runs with TZ=America/New_York. DST 2026: starts Sun Mar 8, ends Sun Nov 1.
import { describe, expect, it } from 'vitest'
import { parseQuickAdd, type QuickAddContext, type QuickAddResult } from '@/logic/quickAdd'

/** Tuesday 2026-09-29, 10:00 local. */
const TUE = new Date(2026, 8, 29, 10, 0).getTime()

function parse(input: string, ctx: Partial<QuickAddContext> = {}): QuickAddResult {
  return parseQuickAdd(input, { now: TUE, ...ctx })
}

/** `[start, end)` of the first occurrence of `text` in `input`. */
function span(input: string, text: string): { start: number; end: number } {
  const start = input.indexOf(text)
  return { start, end: start + text.length }
}

describe("the brief's example", () => {
  const input = 'Read chapter 4 tomorrow 2p #C182 !high ~2'

  it('parses exactly', () => {
    const r = parse(input, { knownCourseCodes: ['C182', 'C779', 'D278'] })
    expect(r.title).toBe('Read chapter 4')
    expect(r.due).toEqual({ date: '2026-09-30', time: '14:00' })
    expect(r.tags).toEqual(['C182'])
    expect(r.courseCode).toBe('C182')
    expect(r.priority).toBe(3)
    expect(r.estimate).toBe(2)
    expect(r.recurrence).toBeUndefined()
  })

  it('reports a token span and chip label for every piece', () => {
    const r = parse(input, { knownCourseCodes: ['C182'] })
    expect(r.tokens).toEqual([
      { kind: 'date', ...span(input, 'tomorrow'), text: 'tomorrow', label: 'Tomorrow' },
      { kind: 'time', ...span(input, '2p'), text: '2p', label: '2:00 PM' },
      { kind: 'tag', ...span(input, '#C182'), text: '#C182', label: '#C182' },
      { kind: 'priority', ...span(input, '!high'), text: '!high', label: 'High priority' },
      { kind: 'estimate', ...span(input, '~2'), text: '~2', label: '2 pomodoros' },
    ])
  })

  it('keeps C182 as a tag but sets no course when the code is unknown', () => {
    const r = parse(input)
    expect(r.tags).toEqual(['C182'])
    expect(r.courseCode).toBeUndefined()
    expect(r.title).toBe('Read chapter 4')
  })

  it('matches course codes case-insensitively and uses the known spelling', () => {
    const r = parse('Review notes #c182', { knownCourseCodes: ['C182'] })
    expect(r.tags).toEqual(['C182'])
    expect(r.courseCode).toBe('C182')
  })
})

describe('plain titles are left alone', () => {
  it.each([
    'Read chapter 4',
    'Study the sun',
    'Look at 9 examples',
    'Problem 2a',
    'Read next chapter',
    'May I ask a question',
    'Fix bug #42',
    'Learn C# basics',
    'Email Tod about grades',
    'Sun Tzu reading',
    'Read about wed and sat',
    'Visit monday.com',
    'Pay 20% of tuition',
    'Meet me in 10 minutes',
    'Read 5 pages in 10 minutes',
    'Ship it!',
    'Every month review',
    'Chapter 4 tomorrow?',
    'Read 1/2 of the chapter',
  ])('%s', (input) => {
    const r = parse(input)
    expect(r.title).toBe(input)
    expect(r.tokens).toEqual([])
    expect(r.due).toBeUndefined()
    expect(r.tags).toEqual([])
  })

  it('returns an empty result for empty input', () => {
    expect(parse('')).toEqual({ title: '', tags: [], tokens: [] })
    expect(parse('   \n\t ')).toEqual({ title: '', tags: [], tokens: [] })
  })

  it('collapses whitespace in the title', () => {
    expect(parse('  Read    chapter \t 4  ').title).toBe('Read chapter 4')
  })

  it('leaves half-typed tokens alone while typing', () => {
    for (const partial of [
      'Read tomorr',
      'Read 2:',
      'Read #',
      'Read !',
      'Read ~',
      'Read next',
      'Read in 3',
    ]) {
      expect(parse(partial).tokens).toEqual([])
    }
  })
})

describe('tags', () => {
  it('collects several tags in order and dedupes case-insensitively', () => {
    const r = parse('Plan #exam #C182 #Exam')
    expect(r.title).toBe('Plan')
    expect(r.tags).toEqual(['exam', 'C182'])
    expect(r.tokens.filter((t) => t.kind === 'tag')).toHaveLength(3)
  })

  it('allows dashes, slashes and digits inside a tag', () => {
    expect(parse('x #exam-prep #wgu/d278').tags).toEqual(['exam-prep', 'wgu/d278'])
  })

  it('needs a letter and does not include trailing punctuation', () => {
    expect(parse('See #42 and #2026').tags).toEqual([])
    expect(parse('Review #C182, then rest').tags).toEqual(['C182'])
    expect(parse('Review #C182.').title).toBe('Review')
    expect(parse('x #-bad #bad- # ').tags).toEqual([])
  })

  it('takes the spelling of a known tag', () => {
    expect(parse('Plan #EXAM', { knownTags: ['exam'] }).tags).toEqual(['exam'])
    expect(parse('Plan #d278', { knownCourseCodes: ['D278'] }).tags).toEqual(['D278'])
  })

  it('picks the first matching course', () => {
    const r = parse('#C779 #C182 x', { knownCourseCodes: ['C182', 'C779'] })
    expect(r.courseCode).toBe('C779')
    expect(r.tags).toEqual(['C779', 'C182'])
  })

  it('supports unicode tags', () => {
    expect(parse('Étude #révision').tags).toEqual(['révision'])
  })
})

describe('priority', () => {
  it.each([
    ['!low', 1, 'Low priority'],
    ['!med', 2, 'Medium priority'],
    ['!medium', 2, 'Medium priority'],
    ['!high', 3, 'High priority'],
    ['!urgent', 4, 'Urgent'],
    ['!1', 1, 'Low priority'],
    ['!2', 2, 'Medium priority'],
    ['!3', 3, 'High priority'],
    ['!4', 4, 'Urgent'],
    ['!HIGH', 3, 'High priority'],
  ])('%s', (word, priority, label) => {
    const r = parse(`Fix it ${word}`)
    expect(r.priority).toBe(priority)
    expect(r.title).toBe('Fix it')
    expect(r.tokens).toEqual([
      { kind: 'priority', start: 7, end: 7 + word.length, text: word, label },
    ])
  })

  it('ignores unknown words and out-of-range numbers', () => {
    for (const word of ['!important', '!0', '!5', '!!high', 'a!high']) {
      const r = parse(`Fix ${word}`)
      expect(r.priority).toBeUndefined()
      expect(r.title).toBe(`Fix ${word}`)
    }
  })

  it('keeps only the first priority', () => {
    const r = parse('Fix !low !urgent')
    expect(r.priority).toBe(1)
    expect(r.title).toBe('Fix !urgent')
  })
})

describe('estimate', () => {
  it('reads ~N pomodoros', () => {
    expect(parse('Essay ~3').estimate).toBe(3)
    expect(parse('Essay ~1').tokens[0]?.label).toBe('1 pomodoro')
    expect(parse('Essay ~12').estimate).toBe(12)
  })

  it('ignores 0, 3-digit numbers and durations', () => {
    for (const bad of ['Essay ~0', 'Essay ~100', 'Essay ~5 minutes', 'Essay ~2h', 'Essay ~']) {
      expect(parse(bad).estimate).toBeUndefined()
    }
  })

  it('keeps only the first estimate', () => {
    const r = parse('Essay ~2 ~5')
    expect(r.estimate).toBe(2)
    expect(r.title).toBe('Essay ~5')
  })
})

describe('dates (today is Tue 2026-09-29)', () => {
  const date = (input: string, ctx: Partial<QuickAddContext> = {}): string | undefined =>
    parse(input, ctx).due?.date

  it('today, tod, tonight, tomorrow, tmr', () => {
    expect(date('x today')).toBe('2026-09-29')
    expect(date('x tod')).toBe('2026-09-29')
    expect(date('x Tod')).toBeUndefined()
    expect(date('x tonight')).toBe('2026-09-29')
    expect(date('x tomorrow')).toBe('2026-09-30')
    expect(date('x Tomorrow')).toBe('2026-09-30')
    expect(date('x tmr')).toBe('2026-09-30')
    expect(date('x TMR')).toBe('2026-09-30')
    expect(date('x tmrw')).toBe('2026-09-30')
    expect(parse('x tonight').tokens[0]?.label).toBe('Tonight')
    expect(parse('x today').tokens[0]?.label).toBe('Today')
  })

  it('weekday names mean the next one after today', () => {
    expect(date('x friday')).toBe('2026-10-02')
    expect(date('x Friday')).toBe('2026-10-02')
    expect(date('x mon')).toBe('2026-10-05')
    expect(date('x Mon')).toBe('2026-10-05')
    expect(date('x wednesday')).toBe('2026-09-30')
    expect(date('x thu')).toBe('2026-10-01')
    expect(date('x thurs')).toBe('2026-10-01')
    expect(date('x tue')).toBe('2026-10-06')
    expect(date('x tuesday')).toBe('2026-10-06') // today is Tuesday: a week from now
    expect(date('x saturday')).toBe('2026-10-03')
    expect(date('x sunday')).toBe('2026-10-04')
  })

  it('labels other days with a weekday and date', () => {
    expect(parse('x friday').tokens[0]?.label).toBe('Fri, Oct 2')
    expect(parse('x 2027-01-05').tokens[0]?.label).toBe('Tue, Jan 5, 2027')
  })

  it('only takes sat/sun/wed with context', () => {
    expect(date('Go on sat')).toBe('2026-10-03')
    expect(date('Submit by wed')).toBe('2026-09-30')
    expect(date('Essay due sun')).toBe('2026-10-04')
    expect(date('Church sun 9am')).toBe('2026-10-04')
    expect(date('Read sat')).toBeUndefined()
    expect(date('Read the sun')).toBeUndefined()
    expect(date('Go on Sat')).toBe('2026-10-03')
    expect(parse('Wed 3pm meeting')).toMatchObject({
      title: 'meeting',
      due: { date: '2026-09-30', time: '15:00' },
    })
    expect(date('Go on saturday')).toBe('2026-10-03')
  })

  it('next week starts the next calendar week (Monday by default)', () => {
    expect(date('x next week')).toBe('2026-10-05')
    expect(date('x next week', { weekStartsOn: 1 })).toBe('2026-10-05')
    expect(date('x next week', { weekStartsOn: 0 })).toBe('2026-10-04')
    expect(parse('x next week').tokens[0]).toMatchObject({ text: 'next week', label: 'Mon, Oct 5' })
  })

  it('next <weekday> is that day of next week', () => {
    expect(date('x next friday')).toBe('2026-10-09')
    expect(date('x next monday')).toBe('2026-10-05')
    expect(date('x next tuesday')).toBe('2026-10-06')
    expect(date('x next sunday')).toBe('2026-10-11')
    expect(date('x next sunday', { weekStartsOn: 0 })).toBe('2026-10-04')
    expect(date('x next monday', { weekStartsOn: 0 })).toBe('2026-10-05')
    expect(date('x next sat')).toBe('2026-10-10')
    expect(parse('x next friday').tokens[0]?.text).toBe('next friday')
  })

  it('in N days|weeks', () => {
    expect(date('x in 3 days')).toBe('2026-10-02')
    expect(date('x in 1 day')).toBe('2026-09-30')
    expect(date('x in 2 weeks')).toBe('2026-10-13')
    expect(date('x in 1 week')).toBe('2026-10-06')
    expect(date('x in 0 days')).toBeUndefined()
    expect(date('x in 3 hours')).toBeUndefined()
    expect(date('x in three days')).toBeUndefined()
    expect(parse('x in 3 days').tokens[0]?.text).toBe('in 3 days')
  })

  it('month and day', () => {
    expect(date('x sep 30')).toBe('2026-09-30')
    expect(date('x Sep 30')).toBe('2026-09-30')
    expect(date('x sept 30th')).toBe('2026-09-30')
    expect(date('x oct 3')).toBe('2026-10-03')
    expect(date('x October 3rd')).toBe('2026-10-03')
    expect(date('x dec 25')).toBe('2026-12-25')
    expect(date('x sep 29')).toBe('2026-09-29')
    expect(parse('x sep 30').tokens[0]).toMatchObject({ text: 'sep 30', label: 'Tomorrow' })
    expect(parse('x oct 3').tokens[0]).toMatchObject({ text: 'oct 3', label: 'Sat, Oct 3' })
  })

  it('month and day roll to next year once passed', () => {
    expect(date('x sep 28')).toBe('2027-09-28')
    expect(date('x jan 5')).toBe('2027-01-05')
    expect(date('x feb 29')).toBe('2028-02-29')
  })

  it('rejects impossible dates', () => {
    expect(date('x feb 30')).toBeUndefined()
    expect(date('x sep 31')).toBeUndefined()
    expect(date('x sep 0')).toBeUndefined()
  })

  it('needs a day number after a month name ("may" is a word)', () => {
    expect(date('May I ask')).toBeUndefined()
    expect(date('You may go')).toBeUndefined()
    expect(date('Study for may 5 exam')).toBe('2027-05-05')
    expect(parse('Study for may 5 exam').title).toBe('Study for exam')
    expect(date('Read chapter 4 may 5')).toBe('2027-05-05')
  })

  it('numeric dates M/D and M/D/Y', () => {
    expect(date('x 9/30')).toBe('2026-09-30')
    expect(date('x 10/3')).toBe('2026-10-03')
    expect(date('x 9/28')).toBe('2027-09-28')
    expect(date('x 12/25/2026')).toBe('2026-12-25')
    expect(date('x 9/30/27')).toBe('2027-09-30')
    expect(date('x 1/1/2020')).toBe('2020-01-01')
    expect(date('x 13/5')).toBeUndefined()
    expect(date('x 24/7')).toBeUndefined()
    expect(date('x 2/30/2027')).toBeUndefined()
  })

  it('ISO dates', () => {
    expect(date('x 2026-10-03')).toBe('2026-10-03')
    expect(date('x 2020-01-01')).toBe('2020-01-01')
    expect(date('x 2026-02-30')).toBeUndefined()
    expect(parse('x 2026-02-30').title).toBe('x 2026-02-30')
  })

  it('absorbs on / by / due before a date', () => {
    expect(parse('Essay due friday')).toMatchObject({ title: 'Essay', due: { date: '2026-10-02' } })
    expect(parse('Submit by tomorrow').title).toBe('Submit')
    expect(parse('Meet on friday').title).toBe('Meet')
    const r = parse('Meet on friday')
    expect(r.tokens[0]).toMatchObject({ text: 'on friday', start: 5 })
    // "on" with nothing date-like after it stays in the title.
    expect(parse('Turn on the light').title).toBe('Turn on the light')
  })

  it('keeps only the first date', () => {
    const r = parse('Read tomorrow friday')
    expect(r.due?.date).toBe('2026-09-30')
    expect(r.title).toBe('Read friday')
  })

  it('does not treat possessives or compounds as dates', () => {
    expect(parse("Review friday's notes").tokens).toEqual([])
    expect(parse('Review tomorrow-land').tokens).toEqual([])
    expect(parse('Read Monday.com docs').tokens).toEqual([])
  })
})

describe('times', () => {
  const time = (input: string): string | undefined => parse(input).due?.time

  it('2p / 2pm / 2 pm / 2:30pm', () => {
    expect(time('x 2p')).toBe('14:00')
    expect(time('x 2P')).toBe('14:00')
    expect(time('x 2pm')).toBe('14:00')
    expect(time('x 2PM')).toBe('14:00')
    expect(time('x 2 pm')).toBe('14:00')
    expect(time('x 2:30pm')).toBe('14:30')
    expect(time('x 2:30 PM')).toBe('14:30')
    expect(time('x 9am')).toBe('09:00')
    expect(time('x 9 am')).toBe('09:00')
    expect(time('x 11:45pm')).toBe('23:45')
    expect(time('x 12pm')).toBe('12:00')
    expect(time('x 12am')).toBe('00:00')
    expect(time('x 12:15am')).toBe('00:15')
    expect(time('x 12:15p')).toBe('12:15')
  })

  it('rejects impossible times', () => {
    for (const bad of ['x 13pm', 'x 0pm', 'x 2:60pm', 'x 25:00', 'x 10:75', 'x 24:00']) {
      expect(time(bad)).toBeUndefined()
    }
  })

  it('24-hour clock', () => {
    expect(time('x 14:00')).toBe('14:00')
    expect(time('x 23:59')).toBe('23:59')
    expect(time('x 00:00')).toBe('00:00')
    expect(time('x 9:30')).toBe('09:30')
    expect(time('x 07:15')).toBe('07:15')
    expect(time('x 12:30')).toBe('12:30')
  })

  it('reads 1-6 without am/pm as PM, but not with a leading zero', () => {
    expect(time('x 3:30')).toBe('15:30')
    expect(time('x 6:15')).toBe('18:15')
    expect(time('x 03:30')).toBe('03:30')
    expect(time('x 7:00')).toBe('07:00')
  })

  it('noon', () => {
    expect(time('x noon')).toBe('12:00')
    expect(time('x at noon')).toBe('12:00')
    expect(parse('x at noon').title).toBe('x')
  })

  it('at N', () => {
    expect(time('Call mom at 9')).toBe('09:00')
    expect(time('Call mom at 3')).toBe('15:00')
    expect(time('Call mom at 12')).toBe('12:00')
    expect(time('Call mom at 18')).toBe('18:00')
    expect(time('Call mom at 9:30')).toBe('09:30')
    expect(time('Call mom at 9pm')).toBe('21:00')
    expect(time('Call mom at 9 pm')).toBe('21:00')
    expect(time('Call mom @9')).toBe('09:00')
    expect(time('Call mom @2pm')).toBe('14:00')
    expect(parse('Call mom at 9').title).toBe('Call mom')
    expect(parse('Call mom at 9').tokens[0]).toMatchObject({ text: 'at 9', label: '9:00 AM' })
    expect(time('Call at 0')).toBeUndefined()
    expect(time('Call at 25')).toBeUndefined()
  })

  it('a bare "at N" only counts when nothing ordinary follows', () => {
    expect(parse('Look at 9 examples').tokens).toEqual([])
    expect(parse('Look at 3 chapters tomorrow')).toMatchObject({
      title: 'Look at 3 chapters',
      due: { date: '2026-09-30' },
    })
    expect(parse('Call at 9 tomorrow')).toMatchObject({
      title: 'Call',
      due: { date: '2026-09-30', time: '09:00' },
    })
    expect(parse('Call at 9 !high').due?.time).toBe('09:00')
    // A rejected "at 9" does not stop a later real time from being read.
    expect(parse('Look at 9 examples at 3pm')).toMatchObject({
      title: 'Look at 9 examples',
      due: { date: '2026-09-29', time: '15:00' },
    })
  })

  it('a single "a" (no m) needs at/@ or a date before it', () => {
    expect(time('Problem 2a')).toBeUndefined()
    expect(parse('Problem 2a').title).toBe('Problem 2a')
    expect(time('Call at 11a')).toBe('11:00')
    expect(time('Call @11a')).toBe('11:00')
    expect(time('Call tomorrow 11a')).toBe('11:00')
    expect(time('Call 11:15a')).toBe('11:15')
    expect(time('Read 2p')).toBe('14:00')
  })

  it('absorbs "by" before a time', () => {
    expect(parse('Submit essay by 5pm')).toMatchObject({
      title: 'Submit essay',
      due: { date: '2026-09-29', time: '17:00' },
    })
    expect(parse('Stand by 5 people').tokens).toEqual([])
  })

  it('a time with no date is due today; a date with a time keeps it', () => {
    expect(parse('Call mom 2p').due).toEqual({ date: '2026-09-29', time: '14:00' })
    expect(parse('Call mom tomorrow at 2p').due).toEqual({ date: '2026-09-30', time: '14:00' })
    expect(parse('Call mom 2p tomorrow').due).toEqual({ date: '2026-09-30', time: '14:00' })
    expect(parse('Call mom tomorrow at 2p').title).toBe('Call mom')
  })

  it('does not read dates, numbers or ratios with letters as times', () => {
    expect(time('x 2026-10-03')).toBeUndefined()
    expect(time('x 9/30')).toBeUndefined()
    expect(time('x chapter 4')).toBeUndefined()
    expect(time('x 3:1')).toBeUndefined()
  })

  it('keeps only the first time', () => {
    const r = parse('x 2p 3p')
    expect(r.due?.time).toBe('14:00')
    expect(r.title).toBe('x 3p')
  })

  it('labels', () => {
    expect(parse('x 2p').tokens[0]?.label).toBe('2:00 PM')
    expect(parse('x 12am').tokens[0]?.label).toBe('12:00 AM')
    expect(parse('x noon').tokens[0]?.label).toBe('12:00 PM')
    expect(parse('x 23:05').tokens[0]?.label).toBe('11:05 PM')
    expect(parse('x 9:30').tokens[0]?.label).toBe('9:30 AM')
  })
})

describe('recurrence', () => {
  it('daily / every day', () => {
    for (const input of [
      'Flashcards daily',
      'Flashcards every day',
      'Flashcards everyday',
      'Flashcards Daily',
    ]) {
      const r = parse(input)
      expect(r.recurrence).toEqual({ freq: 'daily', interval: 1, byWeekday: [] })
      expect(r.title).toBe('Flashcards')
      expect(r.due).toEqual({ date: '2026-09-29' })
    }
    expect(parse('x every day').tokens[0]).toMatchObject({
      kind: 'recurrence',
      text: 'every day',
      label: 'Every day',
    })
  })

  it('every weekday / weekdays', () => {
    for (const input of ['Standup every weekday', 'Standup weekdays', 'Standup every weekdays']) {
      const r = parse(input)
      expect(r.recurrence).toEqual({ freq: 'weekdays', interval: 1, byWeekday: [] })
      expect(r.title).toBe('Standup')
      expect(r.due).toEqual({ date: '2026-09-29' })
    }
    expect(parse('x every weekday').tokens[0]?.label).toBe('Every weekday')
  })

  it('anchors a weekday rule on Monday when typed at the weekend', () => {
    const saturday = new Date(2026, 9, 3, 10, 0).getTime()
    expect(parseQuickAdd('Standup every weekday', { now: saturday }).due).toEqual({
      date: '2026-10-05',
    })
  })

  it('weekly / every week', () => {
    for (const input of ['Review weekly', 'Review every week']) {
      const r = parse(input)
      expect(r.recurrence).toEqual({ freq: 'weekly', interval: 1, byWeekday: [] })
      expect(r.title).toBe('Review')
    }
  })

  it('every <weekday>', () => {
    const r = parse('Lab report every monday')
    expect(r.recurrence).toEqual({ freq: 'weekly', interval: 1, byWeekday: [1] })
    expect(r.title).toBe('Lab report')
    expect(r.due).toEqual({ date: '2026-10-05' })
    expect(r.tokens[0]).toMatchObject({ text: 'every monday', label: 'Every Monday' })
    expect(parse('x every Fri').recurrence?.byWeekday).toEqual([5])
    expect(parse('x every sat').recurrence?.byWeekday).toEqual([6])
    // Every Tuesday, typed on a Tuesday: due today.
    expect(parse('x every tuesday').due).toEqual({ date: '2026-09-29' })
  })

  it('every <weekday>, <weekday> and <weekday>', () => {
    expect(parse('x every mon, wed and fri').recurrence).toEqual({
      freq: 'weekly',
      interval: 1,
      byWeekday: [1, 3, 5],
    })
    expect(parse('x every mon, wed and fri').title).toBe('x')
    expect(parse('x every tuesday thursday').recurrence?.byWeekday).toEqual([2, 4])
    expect(parse('x every mon, wed and fri').tokens[0]?.label).toBe('Every Mon, Wed, Fri')
    expect(parse('x every mon, wed and fri').due).toEqual({ date: '2026-09-30' })
    // A dangling "and" is not swallowed.
    expect(parse('x every monday and then more').title).toBe('x and then more')
    // Monday to Friday is just weekdays.
    expect(parse('x every mon tue wed thu fri').recurrence?.freq).toBe('weekdays')
  })

  it('every N days|weeks and every other day|week', () => {
    expect(parse('x every 3 days').recurrence).toEqual({
      freq: 'daily',
      interval: 3,
      byWeekday: [],
    })
    expect(parse('x every 2 weeks').recurrence).toEqual({
      freq: 'weekly',
      interval: 2,
      byWeekday: [],
    })
    expect(parse('x every other day').recurrence).toEqual({
      freq: 'daily',
      interval: 2,
      byWeekday: [],
    })
    expect(parse('x every other week').recurrence).toEqual({
      freq: 'weekly',
      interval: 2,
      byWeekday: [],
    })
    expect(parse('x every 1 day').recurrence).toEqual({ freq: 'daily', interval: 1, byWeekday: [] })
    expect(parse('x every 2 weeks').tokens[0]?.label).toBe('Every 2 weeks')
    expect(parse('x every 3 days').tokens[0]?.label).toBe('Every 3 days')
    expect(parse('x every 0 days').recurrence).toBeUndefined()
  })

  it('leaves unsupported phrases in the title', () => {
    for (const input of [
      'Pay rent every month',
      'Do it every',
      'Do it every other',
      'Do it every 3 hours',
    ]) {
      expect(parse(input).recurrence).toBeUndefined()
      expect(parse(input).title).toBe(input)
    }
  })

  it('an explicit date wins over the recurrence anchor; time is kept', () => {
    expect(parse('x every monday tomorrow').due).toEqual({ date: '2026-09-30' })
    expect(parse('x every monday at 9').due).toEqual({ date: '2026-10-05', time: '09:00' })
    expect(parse('x every day 8p').due).toEqual({ date: '2026-09-29', time: '20:00' })
  })

  it('keeps only the first recurrence', () => {
    const r = parse('x daily weekly')
    expect(r.recurrence?.freq).toBe('daily')
    expect(r.title).toBe('x weekly')
  })
})

describe('quoted literals', () => {
  it('keeps quoted text verbatim without the quotes', () => {
    const input = 'Buy "tomorrow" milk'
    const r = parse(input)
    expect(r.title).toBe('Buy tomorrow milk')
    expect(r.due).toBeUndefined()
    expect(r.tokens).toEqual([
      { kind: 'literal', ...span(input, '"tomorrow"'), text: '"tomorrow"', label: 'tomorrow' },
    ])
  })

  it('protects every kind of token', () => {
    expect(parse('Fix "#C182 !high ~2 2p" bug').tags).toEqual([])
    expect(parse('Fix "#C182 !high ~2 2p" bug').title).toBe('Fix #C182 !high ~2 2p bug')
    expect(parse('Go "every day" ok').recurrence).toBeUndefined()
  })

  it('still parses unquoted tokens around a literal', () => {
    const r = parse('Read "chapter 4 tomorrow" notes tomorrow')
    expect(r.title).toBe('Read chapter 4 tomorrow notes')
    expect(r.due).toEqual({ date: '2026-09-30' })
  })

  it('supports curly quotes and keeps punctuation after the closing quote', () => {
    expect(parse('Buy “tomorrow” milk').title).toBe('Buy tomorrow milk')
    expect(parse('Buy "milk".').title).toBe('Buy milk.')
  })

  it('an unclosed or mid-word quote is ordinary text', () => {
    expect(parse('Fix 5" pipe tomorrow')).toMatchObject({
      title: 'Fix 5" pipe',
      due: { date: '2026-09-30' },
    })
    expect(parse('Say "hello tomorrow').due?.date).toBe('2026-09-30')
    expect(parse('Cut 3" and 4" pieces').tokens).toEqual([])
  })
})

describe('title cleanup', () => {
  it('drops punctuation left dangling by removed tokens', () => {
    expect(parse('Read chapter 4, tomorrow').title).toBe('Read chapter 4')
    expect(parse('Read chapter 4 tomorrow, then review').title).toBe('Read chapter 4 then review')
    expect(parse('Read chapter 4 - tomorrow').title).toBe('Read chapter 4')
    expect(parse('Read chapter 4 tomorrow.').title).toBe('Read chapter 4')
  })

  it('handles tokens at the start, middle and end', () => {
    expect(parse('#C182 read chapter 4').title).toBe('read chapter 4')
    expect(parse('read #C182 chapter 4').title).toBe('read chapter 4')
    expect(parse('read chapter 4 #C182').title).toBe('read chapter 4')
  })

  it('is empty when the input is only tokens', () => {
    const r = parse('tomorrow 2p #C182 !high ~2')
    expect(r.title).toBe('')
    expect(r.due).toEqual({ date: '2026-09-30', time: '14:00' })
  })

  it('handles tabs and newlines between words', () => {
    expect(parse('Read\tchapter\n4\ttomorrow').title).toBe('Read chapter 4')
  })
})

describe('week start', () => {
  it('drives "next week" and "next <weekday>" only', () => {
    expect(parse('x next week', { weekStartsOn: 0 }).due?.date).toBe('2026-10-04')
    expect(parse('x friday', { weekStartsOn: 0 }).due?.date).toBe('2026-10-02')
  })
})

describe('DST and calendar edges (America/New_York)', () => {
  const at = (y: number, m: number, d: number, h = 10, min = 0): number =>
    new Date(y, m - 1, d, h, min).getTime()
  const on = (now: number, input: string, ctx: Partial<QuickAddContext> = {}): string | undefined =>
    parseQuickAdd(input, { now, ...ctx }).due?.date

  it('spring forward (Sun 2026-03-08)', () => {
    const sat = at(2026, 3, 7, 23, 30)
    expect(on(sat, 'x today')).toBe('2026-03-07')
    expect(on(sat, 'x tomorrow')).toBe('2026-03-08')
    expect(on(sat, 'x sunday')).toBe('2026-03-08')
    expect(on(sat, 'x monday')).toBe('2026-03-09')
    expect(on(sat, 'x next week')).toBe('2026-03-09')
    expect(on(sat, 'x in 1 day')).toBe('2026-03-08')
    expect(on(sat, 'x in 7 days')).toBe('2026-03-14')
    expect(on(sat, 'x in 2 weeks')).toBe('2026-03-21')
    const dstDay = at(2026, 3, 8, 12)
    expect(on(dstDay, 'x today')).toBe('2026-03-08')
    expect(on(dstDay, 'x tomorrow')).toBe('2026-03-09')
    expect(on(dstDay, 'x sunday')).toBe('2026-03-15')
    expect(on(dstDay, 'x next week')).toBe('2026-03-09')
  })

  it('keeps wall-clock times as typed, even inside the spring-forward gap', () => {
    expect(parseQuickAdd('x 2:30am', { now: at(2026, 3, 8, 8) }).due).toEqual({
      date: '2026-03-08',
      time: '02:30',
    })
    expect(parseQuickAdd('x tomorrow 2:30am', { now: at(2026, 3, 7) }).due).toEqual({
      date: '2026-03-08',
      time: '02:30',
    })
  })

  it('fall back (Sun 2026-11-01)', () => {
    const sat = at(2026, 10, 31, 20)
    expect(on(sat, 'x tomorrow')).toBe('2026-11-01')
    expect(on(sat, 'x sunday')).toBe('2026-11-01')
    expect(on(sat, 'x next week')).toBe('2026-11-02')
    expect(on(sat, 'x in 2 days')).toBe('2026-11-02')
    expect(on(sat, 'x in 1 week')).toBe('2026-11-07')
    expect(on(sat, 'x nov 1')).toBe('2026-11-01')
    expect(on(sat, 'x 11/1')).toBe('2026-11-01')
    const dstDay = at(2026, 11, 1, 1, 30)
    expect(on(dstDay, 'x today')).toBe('2026-11-01')
    expect(on(dstDay, 'x tomorrow')).toBe('2026-11-02')
    expect(on(at(2026, 11, 1, 23, 30), 'x tomorrow')).toBe('2026-11-02')
    // Sunday-start weeks: next week begins the day after the 25-hour day.
    expect(on(sat, 'x next week', { weekStartsOn: 0 })).toBe('2026-11-01')
  })

  it('year and leap-day boundaries', () => {
    expect(on(at(2026, 12, 31, 23, 30), 'x tomorrow')).toBe('2027-01-01')
    expect(on(at(2026, 12, 31), 'x jan 5')).toBe('2027-01-05')
    expect(on(at(2026, 12, 31), 'x 12/30')).toBe('2027-12-30')
    expect(on(at(2028, 2, 28), 'x tomorrow')).toBe('2028-02-29')
    expect(on(at(2028, 2, 29), 'x tomorrow')).toBe('2028-03-01')
    expect(on(at(2027, 3, 1), 'x feb 29')).toBe('2028-02-29')
    expect(on(at(2026, 12, 30), 'x in 3 days')).toBe('2027-01-02')
  })

  it('today follows the local calendar day, not UTC', () => {
    // 21:30 New York on Sep 29 is already Sep 30 in UTC.
    expect(on(at(2026, 9, 29, 21, 30), 'x today')).toBe('2026-09-29')
    expect(on(at(2026, 9, 29, 21, 30), 'x tomorrow')).toBe('2026-09-30')
  })
})

describe('token invariants', () => {
  const corpus = [
    'Read chapter 4 tomorrow 2p #C182 !high ~2',
    'Essay due friday at 5pm #exam !urgent',
    'Standup every weekday 9:30 #work',
    'Review notes on sat 10am ~3 !med',
    'Buy "tomorrow" milk #home, then more',
    'Flashcards daily #C779, #D278.',
    'x every mon, wed and fri at 3',
    'x next week in 3 days sep 30 9/30 2026-10-03',
    'Look at 9 examples',
    '  spaced   #tag   !low   ',
    'Ünïcode #étude tomorrow',
    'a.b, c; d: e',
  ]

  it.each(corpus)('%s', (input) => {
    const r = parse(input, { knownCourseCodes: ['C182', 'C779', 'D278'] })
    let previousEnd = 0
    for (const t of r.tokens) {
      expect(t.start).toBeGreaterThanOrEqual(previousEnd)
      expect(t.end).toBeGreaterThan(t.start)
      expect(t.text).toBe(input.slice(t.start, t.end))
      expect(t.label.length).toBeGreaterThan(0)
      previousEnd = t.end
    }
    expect(r.title).toBe(r.title.trim())
    expect(r.title).not.toMatch(/\s{2,}/)
    for (const t of r.tokens) {
      if (t.kind !== 'literal') expect(r.title).not.toContain(t.text)
    }
  })

  it('never throws on odd input', () => {
    for (const odd of [
      '"',
      '""',
      '"" ""',
      '#',
      '##a',
      '!',
      '~',
      '@',
      '@@',
      'at',
      'at at',
      'every every',
      'in in in',
      'next next',
      '\u0000',
      '😀 #😀',
      '\\',
      'a​b',
    ]) {
      expect(() => parse(odd)).not.toThrow()
    }
  })

  it('parsing a plain title again finds nothing more', () => {
    const r = parse('Read chapter 4 tomorrow 2p #C182 !high ~2')
    expect(parse(r.title).tokens).toEqual([])
  })
})
