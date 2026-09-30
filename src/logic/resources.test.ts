import { describe, expect, it } from 'vitest'
import {
  MAX_PDF_BYTES,
  STORAGE_HEADROOM_BYTES,
  URL_MESSAGES,
  countByStatus,
  defaultFilter,
  filterResources,
  freeStorageBytes,
  hasPdfHeader,
  hostLabel,
  looksLikePdf,
  lowStorageMessage,
  nextOrder,
  notePreview,
  parseWebUrl,
  partitionPdfs,
  pdfProblem,
  pdfProblemMessage,
  resourceReorderPlan,
  safeHref,
  sortResources,
  storageIsLow,
  titleFromFileName,
  titleFromNote,
  titleFromUrl,
} from './resources'

const MB = 1024 * 1024

describe('parseWebUrl', () => {
  it('accepts http and https addresses and returns the normalised URL', () => {
    expect(parseWebUrl('https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout')).toEqual(
      {
        ok: true,
        url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout',
      },
    )
    expect(parseWebUrl('http://example.com')).toEqual({ ok: true, url: 'http://example.com/' })
    expect(parseWebUrl('  https://www.wgu.edu/online-it-degrees.html  ')).toEqual({
      ok: true,
      url: 'https://www.wgu.edu/online-it-degrees.html',
    })
  })

  it('adds https:// when the scheme is left off', () => {
    expect(parseWebUrl('developer.mozilla.org/docs')).toEqual({
      ok: true,
      url: 'https://developer.mozilla.org/docs',
    })
    expect(parseWebUrl('//example.com/a')).toEqual({ ok: true, url: 'https://example.com/a' })
    expect(parseWebUrl('localhost:3000/guide')).toEqual({
      ok: true,
      url: 'https://localhost:3000/guide',
    })
  })

  it('keeps the port, path, query and hash', () => {
    expect(parseWebUrl('http://localhost:5173/goals?tab=1#top')).toEqual({
      ok: true,
      url: 'http://localhost:5173/goals?tab=1#top',
    })
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(document.cookie)',
    '  javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://files.example.com/a.pdf',
    'blob:https://forge.example/1234',
    'mailto:mentor@wgu.edu',
    'tel:+18015551212',
    'chrome://settings',
    'about:blank',
  ])('rejects %s as not a web link', (input) => {
    expect(parseWebUrl(input)).toEqual({ ok: false, problem: 'blocked' })
  })

  it('rejects a scheme hidden by whitespace or control characters', () => {
    for (const input of [
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'jav\u0000ascript:alert(1)',
    ]) {
      expect(parseWebUrl(input).ok).toBe(false)
    }
  })

  it('says what is missing or wrong, calmly', () => {
    expect(parseWebUrl('')).toEqual({ ok: false, problem: 'empty' })
    expect(parseWebUrl('   ')).toEqual({ ok: false, problem: 'empty' })
    expect(parseWebUrl('hello')).toEqual({ ok: false, problem: 'invalid' })
    expect(parseWebUrl('two words.com')).toEqual({ ok: false, problem: 'invalid' })
    expect(parseWebUrl('https://')).toEqual({ ok: false, problem: 'invalid' })
    for (const message of Object.values(URL_MESSAGES)) {
      expect(message).not.toMatch(/error|invalid|illegal|forbidden|bad/i)
    }
  })

  it('lets an intranet name through when the scheme was typed', () => {
    expect(parseWebUrl('http://wiki/onboarding')).toEqual({
      ok: true,
      url: 'http://wiki/onboarding',
    })
  })
})

describe('safeHref', () => {
  it('passes web URLs and blocks everything else, including what an old backup may hold', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a')
    expect(safeHref('http://example.com')).toBe('http://example.com/')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JAVASCRIPT:alert(1)')).toBeNull()
    expect(safeHref('data:text/html;base64,PHNjcmlwdD4=')).toBeNull()
    expect(safeHref('not a url')).toBeNull()
    expect(safeHref('')).toBeNull()
    expect(safeHref(null)).toBeNull()
    expect(safeHref(undefined)).toBeNull()
  })
})

describe('titleFromUrl and hostLabel', () => {
  it('uses the host and the path, without scheme, www, query, hash or trailing slash', () => {
    expect(titleFromUrl('https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout')).toBe(
      'developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout',
    )
    expect(titleFromUrl('https://www.wgu.edu/online-it-degrees/')).toBe('wgu.edu/online-it-degrees')
    expect(titleFromUrl('https://www.khanacademy.org/?utm_source=x#top')).toBe('khanacademy.org')
    expect(titleFromUrl('http://localhost:3000/notes')).toBe('localhost:3000/notes')
  })

  it('decodes the path and cuts a very long one with an ellipsis', () => {
    expect(titleFromUrl('https://en.wikipedia.org/wiki/Von_Neumann%20architecture')).toBe(
      'en.wikipedia.org/wiki/Von_Neumann architecture',
    )
    const long = titleFromUrl(`https://example.com/${'chapter-'.repeat(20)}`)
    expect(Array.from(long)).toHaveLength(60)
    expect(long.endsWith('…')).toBe(true)
  })

  it('survives a bad escape and a string that is not a URL', () => {
    expect(titleFromUrl('https://example.com/100%')).toBe('example.com/100%')
    expect(titleFromUrl('  just words  ')).toBe('just words')
  })

  it('labels a link by its host', () => {
    expect(hostLabel('https://www.wgu.edu/x')).toBe('wgu.edu')
    expect(hostLabel('http://localhost:5173/x')).toBe('localhost:5173')
  })
})

describe('titles for notes and files', () => {
  it('takes a note title from its first line, or names it', () => {
    expect(titleFromNote('\n  Exam tips\nRead the rubric first')).toBe('Exam tips')
    expect(titleFromNote('   ')).toBe('Untitled note')
    expect(titleFromNote('x'.repeat(200)).endsWith('…')).toBe(true)
  })

  it('previews the first non-empty line of a body', () => {
    expect(notePreview('\n\nRatios first.\nThen the rest')).toBe('Ratios first.')
    expect(notePreview('')).toBe('')
    expect(Array.from(notePreview('a'.repeat(300))).length).toBe(140)
    // A title made from the first line is not repeated under itself.
    expect(notePreview('Exam tips\nRead the rubric', 140, 'Exam tips')).toBe('Read the rubric')
    expect(notePreview('Exam tips', 140, 'Exam tips')).toBe('')
  })

  it('cleans a file name into a title', () => {
    expect(titleFromFileName('C182_Study_Guide_v3.pdf')).toBe('C182 Study Guide v3')
    expect(titleFromFileName('D278 practice exam.PDF')).toBe('D278 practice exam')
    expect(titleFromFileName('.pdf')).toBe('Untitled PDF')
  })
})

describe('PDF checks', () => {
  const pdf = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
    name: 'guide.pdf',
    type: 'application/pdf',
    size: 2 * MB,
    ...over,
  })

  it('accepts a PDF by its type, or by its name when the system gave no type', () => {
    expect(pdfProblem(pdf())).toBeNull()
    expect(pdfProblem(pdf({ type: '' }))).toBeNull()
    expect(pdfProblem(pdf({ type: 'application/octet-stream', name: 'Guide.PDF' }))).toBeNull()
    expect(looksLikePdf({ name: 'x', type: 'application/pdf' })).toBe(true)
  })

  it('rejects other types, even when they are named .pdf', () => {
    expect(pdfProblem(pdf({ type: 'text/html' }))).toBe('type')
    expect(pdfProblem(pdf({ type: '', name: 'notes.docx' }))).toBe('type')
    expect(pdfProblem(pdf({ type: 'image/png', name: 'scan.pdf' }))).toBe('type')
  })

  it('rejects an empty file and one over 50 MB, and allows exactly 50 MB', () => {
    expect(pdfProblem(pdf({ size: 0 }))).toBe('empty')
    expect(pdfProblem(pdf({ size: MAX_PDF_BYTES }))).toBeNull()
    expect(pdfProblem(pdf({ size: MAX_PDF_BYTES + 1 }))).toBe('tooBig')
  })

  it('explains each problem in a sentence that names the file and the limit', () => {
    expect(pdfProblemMessage('tooBig', { name: 'lecture-slides.pdf', size: 72 * MB })).toBe(
      '“lecture-slides.pdf” is 72 MB. PDFs up to 50 MB can be added. A smaller copy, or a link to it, works too.',
    )
    expect(pdfProblemMessage('type', { name: 'notes.docx', size: 10 })).toContain('isn’t a PDF')
    expect(pdfProblemMessage('empty', { name: 'a.pdf', size: 0 })).toContain('empty')
  })

  it('splits a batch into what can be stored and a sentence for each file that cannot', () => {
    const files = [
      pdf({ name: 'a.pdf' }),
      pdf({ name: 'lecture.pdf', size: 60 * MB }),
      pdf({ name: 'notes.docx', type: 'application/msword' }),
      pdf({ name: 'b.pdf', size: 1 }),
    ]
    const { accepted, problems } = partitionPdfs(files)
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf'])
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('lecture.pdf')
    expect(problems[1]).toContain('notes.docx')
    expect(partitionPdfs([])).toEqual({ accepted: [], problems: [] })
  })

  it('finds %PDF- in the first kilobyte and nowhere else', () => {
    const bytes = (text: string) => new TextEncoder().encode(text)
    expect(hasPdfHeader(bytes('%PDF-1.7\n%âãÏÓ'))).toBe(true)
    expect(hasPdfHeader(bytes(`junk\n${'x'.repeat(100)}%PDF-1.4`))).toBe(true)
    expect(hasPdfHeader(bytes(`${'x'.repeat(1100)}%PDF-1.4`))).toBe(false)
    expect(hasPdfHeader(bytes('<html><script>alert(1)</script></html>'))).toBe(false)
    expect(hasPdfHeader(new Uint8Array())).toBe(false)
  })
})

describe('room to save', () => {
  it('reads the free space from an estimate, or says it does not know', () => {
    expect(freeStorageBytes({ usage: 100 * MB, quota: 600 * MB })).toBe(500 * MB)
    expect(freeStorageBytes({ usage: 700 * MB, quota: 600 * MB })).toBe(0)
    expect(freeStorageBytes({ usage: 1 })).toBeNull()
    expect(freeStorageBytes({})).toBeNull()
    expect(freeStorageBytes(undefined)).toBeNull()
    expect(freeStorageBytes({ usage: 0, quota: 0 })).toBeNull()
    expect(freeStorageBytes({ usage: Number.NaN, quota: 10 })).toBeNull()
  })

  it('is low when the save would leave under the headroom', () => {
    const need = 30 * MB
    expect(storageIsLow({ usage: 0, quota: 10_000 * MB }, need)).toBe(false)
    expect(storageIsLow({ usage: 0, quota: need + STORAGE_HEADROOM_BYTES }, need)).toBe(false)
    expect(storageIsLow({ usage: 1, quota: need + STORAGE_HEADROOM_BYTES }, need)).toBe(true)
    expect(storageIsLow({ usage: 590 * MB, quota: 600 * MB }, 1)).toBe(true)
  })

  it('never blocks on an estimate that is not available', () => {
    expect(storageIsLow(undefined, 500 * MB)).toBe(false)
    expect(storageIsLow({}, 500 * MB)).toBe(false)
  })

  it('says how much is left and how big the PDF is', () => {
    expect(lowStorageMessage({ usage: 562 * MB, quota: 600 * MB }, 30 * MB)).toBe(
      'Your browser has about 38 MB left for Forge, and this PDF is 30 MB. It may not fit.',
    )
    expect(lowStorageMessage({ usage: 562 * MB, quota: 600 * MB }, 30 * MB, 3)).toContain(
      'these 3 PDFs are',
    )
    expect(lowStorageMessage(undefined, 30 * MB)).toContain('short on space')
  })
})

describe('the list', () => {
  const row = (id: string, status: 'toRead' | 'done', order: number, createdAt = 1) => ({
    id,
    status,
    order,
    createdAt,
  })
  const rows = [
    row('a', 'toRead', 0),
    row('b', 'done', 1024),
    row('c', 'toRead', 2048),
    row('d', 'done', 3072),
  ]

  it('counts by status', () => {
    expect(countByStatus(rows)).toEqual({ all: 4, toRead: 2, done: 2 })
    expect(countByStatus([])).toEqual({ all: 0, toRead: 0, done: 0 })
  })

  it('opens on To read while anything waits, else All', () => {
    expect(defaultFilter({ all: 4, toRead: 2, done: 2 })).toBe('toRead')
    expect(defaultFilter({ all: 2, toRead: 0, done: 2 })).toBe('all')
    expect(defaultFilter({ all: 0, toRead: 0, done: 0 })).toBe('all')
  })

  it('filters by status and keeps the order', () => {
    expect(filterResources(rows, 'toRead').map((r) => r.id)).toEqual(['a', 'c'])
    expect(filterResources(rows, 'done').map((r) => r.id)).toEqual(['b', 'd'])
    expect(filterResources(rows, 'all').map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('sorts by order, then age, then id, without changing its input', () => {
    const input = [
      row('z', 'toRead', 5, 1),
      row('b', 'toRead', 5, 1),
      row('m', 'toRead', 1, 9),
      row('q', 'toRead', 5, 0),
    ]
    expect(sortResources(input).map((r) => r.id)).toEqual(['m', 'q', 'b', 'z'])
    expect(input.map((r) => r.id)).toEqual(['z', 'b', 'm', 'q'])
  })

  it('appends one step after the last', () => {
    expect(nextOrder([])).toBe(0)
    expect(nextOrder(rows)).toBe(3072 + 1024)
  })
})

describe('resourceReorderPlan', () => {
  const rows = [
    { id: 'a', order: 0 },
    { id: 'b', order: 1024 },
    { id: 'c', order: 2048 },
    { id: 'd', order: 3072 },
  ]

  it('moves a row by swapping the positions the listed rows hold', () => {
    expect(resourceReorderPlan(rows, ['b', 'a', 'c', 'd'])).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1024 },
    ])
  })

  it('reorders a filtered subset and leaves the hidden rows where they were', () => {
    // The To read tab shows a and c; dragging c above a puts them in the slots 0 and 2048.
    expect(resourceReorderPlan(rows, ['c', 'a'])).toEqual([
      { id: 'c', order: 0 },
      { id: 'a', order: 2048 },
    ])
  })

  it('writes nothing when the order is unchanged', () => {
    expect(resourceReorderPlan(rows, ['a', 'b', 'c', 'd'])).toEqual([])
    expect(resourceReorderPlan(rows, [])).toEqual([])
  })

  it('ignores unknown ids and repeats', () => {
    expect(resourceReorderPlan(rows, ['b', 'ghost', 'a', 'b'])).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1024 },
    ])
  })

  it('renumbers the listed rows when two of them hold the same position', () => {
    const same = [
      { id: 'a', order: 5 },
      { id: 'b', order: 5 },
    ]
    expect(resourceReorderPlan(same, ['b', 'a'])).toEqual([
      { id: 'b', order: 0 },
      { id: 'a', order: 1024 },
    ])
  })
})
