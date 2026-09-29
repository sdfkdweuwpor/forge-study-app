import { describe, expect, it } from 'vitest'
import {
  applySlashCommand,
  BLOCK_TYPES,
  changeBlockType,
  filterSlash,
  isSafeUrl,
  mergeWithPrevious,
  parseInline,
  slashCommands,
  slashQuery,
  splitBlock,
  stripInline,
  toPlainText,
  type Block,
  type InlineSpan,
} from '@/logic/blocks'

const plain = (text: string): InlineSpan => ({
  text,
  bold: false,
  italic: false,
  code: false,
  href: null,
})
const span = (text: string, style: Partial<InlineSpan> = {}): InlineSpan => ({
  ...plain(text),
  ...style,
})

/** Freezes a document so any in-place mutation throws. */
function frozen(blocks: Block[]): Block[] {
  return Object.freeze(blocks.map((b) => Object.freeze({ ...b }))) as Block[]
}

describe('parseInline', () => {
  it('plain text', () => {
    expect(parseInline('Read chapter 4')).toEqual([plain('Read chapter 4')])
    expect(parseInline('')).toEqual([])
  })

  it('bold, italic and code', () => {
    expect(parseInline('a **bold** b')).toEqual([
      plain('a '),
      span('bold', { bold: true }),
      plain(' b'),
    ])
    expect(parseInline('a *it* b')).toEqual([
      plain('a '),
      span('it', { italic: true }),
      plain(' b'),
    ])
    expect(parseInline('run `npm test` now')).toEqual([
      plain('run '),
      span('npm test', { code: true }),
      plain(' now'),
    ])
  })

  it('links', () => {
    expect(parseInline('see [WGU](https://www.wgu.edu) now')).toEqual([
      plain('see '),
      span('WGU', { href: 'https://www.wgu.edu' }),
      plain(' now'),
    ])
    expect(parseInline('[mail me](mailto:a@b.co)')).toEqual([
      span('mail me', { href: 'mailto:a@b.co' }),
    ])
    expect(parseInline('[a](http://example.com/x?y=1&z=2#f)')).toEqual([
      span('a', { href: 'http://example.com/x?y=1&z=2#f' }),
    ])
  })

  it('bold and italic nest', () => {
    expect(parseInline('***both***')).toEqual([span('both', { bold: true, italic: true })])
    expect(parseInline('**bold *and italic* bold**')).toEqual([
      span('bold ', { bold: true }),
      span('and italic', { bold: true, italic: true }),
      span(' bold', { bold: true }),
    ])
    expect(parseInline('*italic **and bold** italic*')).toEqual([
      span('italic ', { italic: true }),
      span('and bold', { bold: true, italic: true }),
      span(' italic', { italic: true }),
    ])
    expect(parseInline('**bold *it***')).toEqual([
      span('bold ', { bold: true }),
      span('it', { bold: true, italic: true }),
    ])
  })

  it('formats link labels and links inside emphasis', () => {
    expect(parseInline('[**bold** link](https://a.com)')).toEqual([
      span('bold', { bold: true, href: 'https://a.com' }),
      span(' link', { href: 'https://a.com' }),
    ])
    expect(parseInline('**[a](https://x.com)**')).toEqual([
      span('a', { bold: true, href: 'https://x.com' }),
    ])
  })

  it('code is literal: markers inside are not parsed', () => {
    expect(parseInline('`**not bold**`')).toEqual([span('**not bold**', { code: true })])
    expect(parseInline('`[x](https://a.com)`')).toEqual([
      span('[x](https://a.com)', { code: true }),
    ])
    expect(parseInline('**bold `code` bold**')).toEqual([
      span('bold ', { bold: true }),
      span('code', { bold: true, code: true }),
      span(' bold', { bold: true }),
    ])
  })

  it('leaves unmatched markers as literal text', () => {
    expect(parseInline('**abc')).toEqual([plain('**abc')])
    expect(parseInline('*abc')).toEqual([plain('*abc')])
    expect(parseInline('abc**')).toEqual([plain('abc**')])
    expect(parseInline('a ` b')).toEqual([plain('a ` b')])
    expect(parseInline('****')).toEqual([plain('****')])
    expect(parseInline('``')).toEqual([plain('``')])
    expect(parseInline('[label]')).toEqual([plain('[label]')])
    expect(parseInline('[label](')).toEqual([plain('[label](')])
    expect(parseInline('**a *b**')).toEqual([span('a *b', { bold: true })])
  })

  it('does not treat spaced stars as emphasis (2 * 3 * 4)', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([plain('2 * 3 * 4')])
    expect(parseInline('** a **')).toEqual([plain('** a **')])
  })

  it('a backslash escapes a marker', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([plain('*not italic*')])
    expect(parseInline('a \\`b\\` c')).toEqual([plain('a `b` c')])
    expect(parseInline('\\[x\\](https://a.com)')).toEqual([plain('[x](https://a.com)')])
    expect(parseInline('c:\\temp')).toEqual([plain('c:\\temp')]) // not an escapable char
    expect(parseInline('a\\\\b')).toEqual([plain('a\\b')])
  })

  it('merges adjacent spans with the same style', () => {
    expect(parseInline('a\\*b')).toEqual([plain('a*b')])
    expect(parseInline('**a****b**')).toEqual([span('ab', { bold: true })])
  })

  it('only allows http, https and mailto links', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html;base64,AAAA',
      'file:///etc/passwd',
      'ftp://example.com',
      'vbscript:x',
      '//evil.example.com',
      '/relative/path',
      'example.com',
      'https://',
      'https:///nohost',
      'mailto:',
      'mailto:nobody',
    ]) {
      const text = `[click](${bad})`
      const spans = parseInline(text)
      expect(spans.every((s) => s.href === null)).toBe(true)
      expect(spans.map((s) => s.text).join('')).toBe(text)
    }
  })

  it('does not link when the URL has spaces or the label is empty', () => {
    expect(parseInline('[x](https://a.com/a b)').every((s) => s.href === null)).toBe(true)
    expect(parseInline('[](https://a.com)').every((s) => s.href === null)).toBe(true)
  })

  it('allows balanced parentheses in a URL', () => {
    expect(parseInline('[w](https://en.wikipedia.org/wiki/Foo_(bar)) x')).toEqual([
      span('w', { href: 'https://en.wikipedia.org/wiki/Foo_(bar)' }),
      plain(' x'),
    ])
  })

  it('never nests links', () => {
    const spans = parseInline('[a [b](https://x.com)](https://y.com)')
    for (const s of spans) expect([null, 'https://x.com']).toContain(s.href)
    expect(spans.map((s) => s.text).join('')).toBe('[a b](https://y.com)')
  })

  it('never emits an unsafe href, whatever the input', () => {
    const inputs = [
      '[x](javascript:alert(1))',
      '**[x](https://ok.com)** [y](javascript:1) `[z](data:x)`',
      '[[x](https://ok.com)](javascript:1)',
      '[x]((https://ok.com))',
      '\\[x](https://ok.com)',
      '[x](https://ok.com "title")',
    ]
    for (const input of inputs) {
      for (const s of parseInline(input)) {
        if (s.href !== null) expect(isSafeUrl(s.href)).toBe(true)
      }
    }
  })

  it('never loses or invents visible characters outside markup', () => {
    for (const input of ['Plain words only.', 'Ünïcode ✓ text', '  spaced  out  ']) {
      expect(
        parseInline(input)
          .map((s) => s.text)
          .join(''),
      ).toBe(input)
    }
  })

  it('does not throw or hang on adversarial input', () => {
    const nasty = [
      '*'.repeat(200),
      '**'.repeat(200),
      '['.repeat(100),
      '`'.repeat(101),
      '*a*'.repeat(200),
      '[a](b'.repeat(100),
      '\\'.repeat(51),
      '**a *'.repeat(100),
    ]
    for (const input of nasty) {
      const start = performance.now()
      expect(() => parseInline(input)).not.toThrow()
      expect(performance.now() - start).toBeLessThan(500)
    }
  })
})

describe('isSafeUrl', () => {
  it('accepts http, https and mailto', () => {
    expect(isSafeUrl('https://example.com')).toBe(true)
    expect(isSafeUrl('http://example.com/a?b=c#d')).toBe(true)
    expect(isSafeUrl('HTTPS://EXAMPLE.COM')).toBe(true)
    expect(isSafeUrl('mailto:me@example.com')).toBe(true)
    expect(isSafeUrl('mailto:me@example.com?subject=Hi')).toBe(true)
    expect(isSafeUrl('  https://example.com  ')).toBe(true)
  })

  it('rejects everything else', () => {
    for (const bad of [
      '',
      ' ',
      'javascript:alert(1)',
      'data:text/plain,hi',
      'https://exa mple.com',
      'https://example.com/\nx',
      'https://example.com/\u0000',
      'https://',
      'file:///x',
      'tel:123',
    ]) {
      expect(isSafeUrl(bad)).toBe(false)
    }
  })
})

describe('stripInline / toPlainText', () => {
  it('removes markup', () => {
    expect(stripInline('a **b** *c* `d` [e](https://f.com)')).toBe('a b c d e')
  })

  it('joins blocks with newlines, skips dividers, drops markup', () => {
    const doc: Block[] = [
      { id: 'a', type: 'h1', text: 'Plan for **C182**' },
      { id: 'b', type: 'divider', text: '' },
      { id: 'c', type: 'todo', text: 'Read [chapter 4](https://example.com)', checked: true },
      { id: 'd', type: 'callout', text: 'Exam on *Friday*', emoji: '!' },
      { id: 'e', type: 'bullet', text: '' },
    ]
    expect(toPlainText(doc)).toBe('Plan for C182\nRead chapter 4\nExam on Friday\n')
    expect(toPlainText([])).toBe('')
  })
})

describe('splitBlock', () => {
  const doc = (): Block[] => [
    { id: 'a', type: 'p', text: 'Hello world' },
    { id: 'b', type: 'p', text: 'Second' },
  ]

  it('splits at the caret; the new block gets the rest', () => {
    const edit = splitBlock(doc(), 'a', 5)
    expect(edit.doc).toEqual([
      { id: 'a', type: 'p', text: 'Hello' },
      { id: 'a-1', type: 'p', text: ' world' },
      { id: 'b', type: 'p', text: 'Second' },
    ])
    expect(edit.focusId).toBe('a-1')
    expect(edit.caret).toBe(0)
  })

  it('Enter at the end adds an empty block below', () => {
    const edit = splitBlock(doc(), 'a', 11)
    expect(edit.doc.map((b) => b.text)).toEqual(['Hello world', '', 'Second'])
    expect(edit.focusId).toBe('a-1')
  })

  it('Enter at the start inserts an empty block above and keeps the caret on the text', () => {
    const edit = splitBlock(doc(), 'a', 0)
    expect(edit.doc.map((b) => [b.id, b.text])).toEqual([
      ['a-1', ''],
      ['a', 'Hello world'],
      ['b', 'Second'],
    ])
    expect(edit.focusId).toBe('a')
    expect(edit.caret).toBe(0)
  })

  it('clamps the offset', () => {
    expect(splitBlock(doc(), 'a', -5).doc.map((b) => b.text)).toEqual(['', 'Hello world', 'Second'])
    expect(splitBlock(doc(), 'a', 999).doc.map((b) => b.text)).toEqual([
      'Hello world',
      '',
      'Second',
    ])
    expect(splitBlock(doc(), 'a', 2.9).doc[0]?.text).toBe('He')
  })

  it('uses the id factory when given, and never duplicates an id', () => {
    let n = 0
    const edit = splitBlock(doc(), 'a', 5, () => `new-${++n}`)
    expect(edit.doc[1]?.id).toBe('new-1')
    const clash = splitBlock(doc(), 'a', 5, () => 'b')
    const ids = clash.doc.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    const taken: Block[] = [
      { id: 'a', type: 'p', text: 'x' },
      { id: 'a-1', type: 'p', text: 'y' },
    ]
    expect(splitBlock(taken, 'a', 1).doc.map((b) => b.id)).toEqual(['a', 'a-2', 'a-1'])
  })

  it('bullets and to-dos continue the list; to-dos start unchecked', () => {
    const bullet = splitBlock([{ id: 'a', type: 'bullet', text: 'one two' }], 'a', 3)
    expect(bullet.doc.map((b) => [b.type, b.text])).toEqual([
      ['bullet', 'one'],
      ['bullet', ' two'],
    ])
    const todo = splitBlock([{ id: 'a', type: 'todo', text: 'one two', checked: true }], 'a', 3)
    expect(todo.doc).toEqual([
      { id: 'a', type: 'todo', text: 'one', checked: true },
      { id: 'a-1', type: 'todo', text: ' two', checked: false },
    ])
  })

  it('headings and callouts continue as a paragraph; the head keeps its type and emoji', () => {
    const heading = splitBlock([{ id: 'a', type: 'h2', text: 'Week one' }], 'a', 8)
    expect(heading.doc.map((b) => b.type)).toEqual(['h2', 'p'])
    const callout = splitBlock([{ id: 'a', type: 'callout', text: 'Note it', emoji: '!' }], 'a', 7)
    expect(callout.doc).toEqual([
      { id: 'a', type: 'callout', text: 'Note it', emoji: '!' },
      { id: 'a-1', type: 'p', text: '' },
    ])
  })

  it('Enter at the start of a to-do inserts an empty unchecked to-do above', () => {
    const edit = splitBlock([{ id: 'a', type: 'todo', text: 'Task', checked: true }], 'a', 0)
    expect(edit.doc).toEqual([
      { id: 'a-1', type: 'todo', text: '', checked: false },
      { id: 'a', type: 'todo', text: 'Task', checked: true },
    ])
  })

  it('Enter on an empty bullet, to-do or callout leaves the list as a paragraph', () => {
    for (const type of ['bullet', 'todo', 'callout'] as const) {
      const start: Block[] = [
        { id: 'a', type: 'p', text: 'x' },
        { id: 'b', type, text: '', ...(type === 'todo' ? { checked: true } : {}) },
      ]
      const edit = splitBlock(start, 'b', 0)
      expect(edit.doc).toEqual([
        { id: 'a', type: 'p', text: 'x' },
        { id: 'b', type: 'p', text: '' },
      ])
      expect(edit.focusId).toBe('b')
    }
  })

  it('Enter on an empty paragraph or heading adds another block', () => {
    expect(splitBlock([{ id: 'a', type: 'p', text: '' }], 'a', 0).doc).toHaveLength(2)
    expect(splitBlock([{ id: 'a', type: 'h1', text: '' }], 'a', 0).doc.map((b) => b.type)).toEqual([
      'h1',
      'p',
    ])
  })

  it('Enter on a divider adds a paragraph after it', () => {
    const edit = splitBlock(
      [
        { id: 'a', type: 'divider', text: '' },
        { id: 'b', type: 'p', text: 'x' },
      ],
      'a',
      0,
    )
    expect(edit.doc.map((b) => b.type)).toEqual(['divider', 'p', 'p'])
    expect(edit.focusId).toBe('a-1')
  })

  it('returns the document unchanged for an unknown id', () => {
    const edit = splitBlock(doc(), 'zzz', 3)
    expect(edit.doc).toEqual(doc())
    expect(edit.focusId).toBe('zzz')
  })

  it('does not mutate its input', () => {
    const input = frozen(doc())
    expect(() => splitBlock(input, 'a', 3)).not.toThrow()
    expect(() => splitBlock(input, 'a', 0)).not.toThrow()
    expect(input[0]?.text).toBe('Hello world')
  })

  it('round-trips with merge', () => {
    const split = splitBlock(doc(), 'a', 5)
    const merged = mergeWithPrevious(split.doc, split.focusId)
    expect(merged?.doc).toEqual(doc())
    expect(merged?.focusId).toBe('a')
    expect(merged?.caret).toBe(5)
  })
})

describe('mergeWithPrevious', () => {
  it('joins the text onto the previous block with the caret at the seam', () => {
    const edit = mergeWithPrevious(
      [
        { id: 'a', type: 'p', text: 'Hello' },
        { id: 'b', type: 'p', text: ' world' },
        { id: 'c', type: 'p', text: 'End' },
      ],
      'b',
    )
    expect(edit?.doc).toEqual([
      { id: 'a', type: 'p', text: 'Hello world' },
      { id: 'c', type: 'p', text: 'End' },
    ])
    expect(edit?.focusId).toBe('a')
    expect(edit?.caret).toBe(5)
  })

  it('the merged block keeps the previous block type and fields', () => {
    const edit = mergeWithPrevious(
      [
        { id: 'a', type: 'todo', text: 'Task', checked: true },
        { id: 'b', type: 'h1', text: ' more' },
      ],
      'b',
    )
    expect(edit?.doc).toEqual([{ id: 'a', type: 'todo', text: 'Task more', checked: true }])
  })

  it('merging an empty block just removes it', () => {
    const edit = mergeWithPrevious(
      [
        { id: 'a', type: 'p', text: 'Hello' },
        { id: 'b', type: 'bullet', text: '' },
      ],
      'b',
    )
    expect(edit?.doc).toEqual([{ id: 'a', type: 'p', text: 'Hello' }])
    expect(edit?.caret).toBe(5)
  })

  it('returns null for the first block and for an unknown id', () => {
    const doc: Block[] = [
      { id: 'a', type: 'p', text: 'x' },
      { id: 'b', type: 'p', text: 'y' },
    ]
    expect(mergeWithPrevious(doc, 'a')).toBeNull()
    expect(mergeWithPrevious(doc, 'zzz')).toBeNull()
    expect(mergeWithPrevious([], 'a')).toBeNull()
  })

  it('backspace after a divider deletes the divider and keeps the text', () => {
    const edit = mergeWithPrevious(
      [
        { id: 'a', type: 'p', text: 'above' },
        { id: 'd', type: 'divider', text: '' },
        { id: 'b', type: 'p', text: 'below' },
      ],
      'b',
    )
    expect(edit?.doc).toEqual([
      { id: 'a', type: 'p', text: 'above' },
      { id: 'b', type: 'p', text: 'below' },
    ])
    expect(edit?.focusId).toBe('b')
    expect(edit?.caret).toBe(0)
  })

  it('backspace on a divider removes it and focuses the end of the previous block', () => {
    const edit = mergeWithPrevious(
      [
        { id: 'a', type: 'p', text: 'above' },
        { id: 'd', type: 'divider', text: '' },
      ],
      'd',
    )
    expect(edit?.doc).toEqual([{ id: 'a', type: 'p', text: 'above' }])
    expect(edit?.focusId).toBe('a')
    expect(edit?.caret).toBe(5)
  })

  it('does not mutate its input', () => {
    const input = frozen([
      { id: 'a', type: 'p', text: 'Hello' },
      { id: 'b', type: 'p', text: ' world' },
    ])
    expect(() => mergeWithPrevious(input, 'b')).not.toThrow()
    expect(input).toHaveLength(2)
  })
})

describe('changeBlockType', () => {
  it('keeps the text and fixes the type-specific fields', () => {
    const doc: Block[] = [{ id: 'a', type: 'p', text: 'Buy milk' }]
    expect(changeBlockType(doc, 'a', 'todo')).toEqual([
      { id: 'a', type: 'todo', text: 'Buy milk', checked: false },
    ])
    expect(changeBlockType(doc, 'a', 'h2')).toEqual([{ id: 'a', type: 'h2', text: 'Buy milk' }])
    expect(changeBlockType(doc, 'a', 'divider')).toEqual([{ id: 'a', type: 'divider', text: '' }])
  })

  it('a to-do stays checked when converted to a to-do; leaving to-do drops checked', () => {
    const doc: Block[] = [{ id: 'a', type: 'todo', text: 'x', checked: true }]
    expect(changeBlockType(doc, 'a', 'todo')[0]?.checked).toBe(true)
    expect(changeBlockType(doc, 'a', 'p')[0]).toEqual({ id: 'a', type: 'p', text: 'x' })
  })

  it('leaves other blocks alone', () => {
    const doc: Block[] = [
      { id: 'a', type: 'p', text: 'x' },
      { id: 'b', type: 'p', text: 'y' },
    ]
    const next = changeBlockType(doc, 'b', 'h1')
    expect(next[0]).toBe(doc[0])
  })
})

describe('slash menu', () => {
  it('lists every block type the editor can create, in menu order', () => {
    expect(slashCommands.map((c) => c.id)).toEqual([
      'text',
      'h1',
      'h2',
      'h3',
      'bullet',
      'todo',
      'callout',
      'divider',
    ])
    expect(new Set(slashCommands.map((c) => c.type))).toEqual(new Set(BLOCK_TYPES))
    for (const c of slashCommands) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.description.length).toBeGreaterThan(0)
    }
  })

  it('an empty query lists everything', () => {
    expect(filterSlash('').map((c) => c.id)).toEqual(slashCommands.map((c) => c.id))
    expect(filterSlash('/').map((c) => c.id)).toEqual(slashCommands.map((c) => c.id))
    expect(filterSlash('  ')).toHaveLength(slashCommands.length)
  })

  it.each([
    ['todo', 'todo'],
    ['/todo', 'todo'],
    ['TODO', 'todo'],
    ['tod', 'todo'],
    ['h1', 'h1'],
    ['h2', 'h2'],
    ['h3', 'h3'],
    ['divider', 'divider'],
    ['div', 'divider'],
    ['hr', 'divider'],
    ['callout', 'callout'],
    ['call', 'callout'],
    ['bullet', 'bullet'],
    ['bul', 'bullet'],
    ['text', 'text'],
    ['paragraph', 'text'],
  ])('/%s puts %s first', (query, first) => {
    expect(filterSlash(query)[0]?.id).toBe(first)
  })

  it('/heading finds all three heading levels first, in order', () => {
    expect(filterSlash('heading').map((c) => c.id)).toEqual(['h1', 'h2', 'h3'])
  })

  it('/h1 finds only heading 1', () => {
    expect(filterSlash('h1').map((c) => c.id)).toEqual(['h1'])
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(filterSlash('zzz')).toEqual([])
    expect(filterSlash('/qqq')).toEqual([])
  })

  it('ranks exact and prefix matches above loose ones', () => {
    expect(filterSlash('t').map((c) => c.id)[0]).toBe('text')
    const ids = filterSlash('l').map((c) => c.id)
    expect(ids.length).toBeGreaterThan(0)
  })

  it('slashQuery reads what follows a leading slash', () => {
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('/tod')).toBe('tod')
    expect(slashQuery('/todo')).toBe('todo')
    expect(slashQuery('/todo now')).toBeNull()
    expect(slashQuery('todo')).toBeNull()
    expect(slashQuery(' /todo')).toBeNull()
    expect(slashQuery('')).toBeNull()
    expect(slashQuery('a/b')).toBeNull()
  })
})

describe('applySlashCommand', () => {
  const doc = (): Block[] => [
    { id: 'a', type: 'p', text: 'Intro' },
    { id: 'b', type: 'p', text: '/todo' },
    { id: 'c', type: 'p', text: 'After' },
  ]

  it('clears the slash text and converts the block', () => {
    const edit = applySlashCommand(doc(), 'b', 'todo')
    expect(edit.doc[1]).toEqual({ id: 'b', type: 'todo', text: '', checked: false })
    expect(edit.doc).toHaveLength(3)
    expect(edit.focusId).toBe('b')
    expect(edit.caret).toBe(0)
  })

  it.each([
    ['h1', 'h1'],
    ['h2', 'h2'],
    ['h3', 'h3'],
    ['bullet', 'bullet'],
    ['callout', 'callout'],
    ['text', 'p'],
  ] as const)('%s → %s', (command, type) => {
    const edit = applySlashCommand(doc(), 'b', command)
    expect(edit.doc[1]).toEqual({ id: 'b', type, text: '' })
  })

  it('a divider gets an empty paragraph after it to hold the caret', () => {
    const edit = applySlashCommand(doc(), 'b', 'divider')
    expect(edit.doc.map((b) => b.type)).toEqual(['p', 'divider', 'p', 'p'])
    expect(edit.focusId).toBe('b-1')
    expect(edit.doc[2]).toEqual({ id: 'b-1', type: 'p', text: '' })
  })

  it('a divider reuses an empty paragraph that already follows', () => {
    const start: Block[] = [
      { id: 'b', type: 'p', text: '/divider' },
      { id: 'c', type: 'p', text: '' },
    ]
    const edit = applySlashCommand(start, 'b', 'divider')
    expect(edit.doc.map((b) => b.type)).toEqual(['divider', 'p'])
    expect(edit.focusId).toBe('c')
  })

  it('a divider at the end of the document still gets a paragraph', () => {
    const edit = applySlashCommand(
      [{ id: 'b', type: 'p', text: '/divider' }],
      'b',
      'divider',
      () => 'n1',
    )
    expect(edit.doc.map((b) => b.id)).toEqual(['b', 'n1'])
    expect(edit.focusId).toBe('n1')
  })

  it('keeps a callout emoji when converting a callout again', () => {
    const start: Block[] = [{ id: 'b', type: 'callout', text: '/callout', emoji: '!' }]
    expect(applySlashCommand(start, 'b', 'callout').doc[0]).toEqual({
      id: 'b',
      type: 'callout',
      text: '',
      emoji: '!',
    })
  })

  it('ignores an unknown block', () => {
    const edit = applySlashCommand(doc(), 'zzz', 'todo')
    expect(edit.doc).toEqual(doc())
  })

  it('does not mutate its input', () => {
    const input = frozen(doc())
    expect(() => applySlashCommand(input, 'b', 'divider')).not.toThrow()
    expect(input[1]?.type).toBe('p')
  })
})
