import { describe, expect, it } from 'vitest'
import {
  applyMarkdownShortcut,
  applySlashAt,
  applySlashCommand,
  backspaceAtStart,
  BLOCK_TYPES,
  changeBlockType,
  deleteAtEnd,
  filterSlash,
  inlineSourceMap,
  isSafeUrl,
  markdownShortcut,
  mergeWithPrevious,
  moveBlockToIndex,
  parseInline,
  pasteText,
  removeBlock,
  replaceRange,
  setBlockChecked,
  setBlockEmoji,
  setBlockText,
  slashCommands,
  slashContext,
  slashQuery,
  sourceOffset,
  splitAtSelection,
  splitBlock,
  stripInline,
  toggleInlineMarker,
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
    expect(parseInline('**a\\*b**')).toEqual([span('a*b', { bold: true })])
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

describe('inlineSourceMap / sourceOffset', () => {
  it('maps each visible character back to the raw text', () => {
    const raw = 'a **bold** and `code` [WGU](https://www.wgu.edu) \\* end'
    const visible = stripInline(raw)
    const map = inlineSourceMap(raw)
    expect(map).toHaveLength(visible.length)
    map.forEach((rawIndex, k) => expect(raw[rawIndex]).toBe(visible[k]))
    expect([...map]).toEqual([...map].sort((a, b) => a - b))
  })

  it('plain text maps to itself', () => {
    expect(inlineSourceMap('abc')).toEqual([0, 1, 2])
    expect(inlineSourceMap('')).toEqual([])
  })

  it('a caret in formatted text lands just before the next visible character', () => {
    const raw = 'a **bold** c'
    // visible: "a bold c"
    expect(sourceOffset(raw, 0)).toBe(0)
    expect(sourceOffset(raw, 2)).toBe(4) // before "b", after the opening **
    expect(sourceOffset(raw, 4)).toBe(6) // inside the word, before "l"
    expect(sourceOffset(raw, 6)).toBe(10) // after "d": past the closing **
    expect(sourceOffset(raw, 8)).toBe(raw.length)
  })

  it('clamps out-of-range offsets', () => {
    expect(sourceOffset('**a**', -3)).toBe(0)
    expect(sourceOffset('**a**', 99)).toBe(5)
    expect(sourceOffset('', 0)).toBe(0)
  })

  it('never throws on adversarial input', () => {
    for (const raw of ['****', '`', '[', '](', '\\', '*'.repeat(200), '[a](b'.repeat(50)]) {
      expect(() => sourceOffset(raw, raw.length >> 1)).not.toThrow()
      expect(inlineSourceMap(raw)).toHaveLength(stripInline(raw).length)
    }
  })
})

describe('replaceRange / setBlockText / setBlockChecked / setBlockEmoji', () => {
  it('replaces a range and reports the caret after the insertion', () => {
    expect(replaceRange('Hello world', 5, 11, '!')).toEqual({ text: 'Hello!', caret: 6 })
    expect(replaceRange('abc', 1, 1, 'XY')).toEqual({ text: 'aXYbc', caret: 3 })
  })

  it('orders and clamps the range', () => {
    expect(replaceRange('abc', 3, 1, '-')).toEqual({ text: 'a-', caret: 2 })
    expect(replaceRange('abc', -5, 99, '')).toEqual({ text: '', caret: 0 })
    expect(replaceRange('abc', Number.NaN, 1, 'x')).toEqual({ text: 'xbc', caret: 1 })
  })

  it('setBlockText keeps the identity of untouched blocks', () => {
    const start: Block[] = [
      { id: 'a', type: 'p', text: 'one' },
      { id: 'b', type: 'p', text: 'two' },
    ]
    const next = setBlockText(start, 'b', 'TWO')
    expect(next[0]).toBe(start[0])
    expect(next[1]).toEqual({ id: 'b', type: 'p', text: 'TWO' })
    expect(setBlockText(start, 'b', 'two')[1]).toBe(start[1])
  })

  it('setBlockChecked only touches to-dos', () => {
    const start: Block[] = [
      { id: 'a', type: 'todo', text: 'Read', checked: false },
      { id: 'b', type: 'p', text: 'Note' },
    ]
    expect(setBlockChecked(start, 'a', true)[0]).toEqual({
      id: 'a',
      type: 'todo',
      text: 'Read',
      checked: true,
    })
    expect(setBlockChecked(start, 'b', true)[1]).toBe(start[1])
    expect(setBlockChecked(start, 'a', false)[0]).toBe(start[0])
  })

  it('setBlockEmoji sets and removes a callout emoji', () => {
    const start: Block[] = [{ id: 'a', type: 'callout', text: 'Tip', emoji: '💡' }]
    expect(setBlockEmoji(start, 'a', '🎯')[0]).toEqual({
      id: 'a',
      type: 'callout',
      text: 'Tip',
      emoji: '🎯',
    })
    expect(setBlockEmoji(start, 'a', null)[0]).toEqual({ id: 'a', type: 'callout', text: 'Tip' })
    const plain: Block[] = [{ id: 'p', type: 'p', text: 'x' }]
    expect(setBlockEmoji(plain, 'p', '🎯')[0]).toBe(plain[0])
  })
})

describe('splitAtSelection', () => {
  const doc = (): Block[] => [{ id: 'a', type: 'p', text: 'Hello world' }]

  it('a collapsed selection is splitBlock', () => {
    expect(splitAtSelection(doc(), 'a', 5, 5)).toEqual(splitBlock(doc(), 'a', 5))
  })

  it('deletes the selected text, then splits where the selection began', () => {
    const edit = splitAtSelection(doc(), 'a', 5, 6)
    expect(edit.doc.map((b) => b.text)).toEqual(['Hello', 'world'])
    expect(edit.focusId).toBe('a-1')
  })

  it('works with a reversed range and a selection that covers the whole block', () => {
    expect(splitAtSelection(doc(), 'a', 6, 5).doc.map((b) => b.text)).toEqual(['Hello', 'world'])
    const all = splitAtSelection(doc(), 'a', 0, 11)
    expect(all.doc.map((b) => b.text)).toEqual(['', ''])
    expect(all.focusId).toBe('a-1')
  })

  it('ignores an unknown block', () => {
    expect(splitAtSelection(doc(), 'zzz', 0, 1).doc).toEqual(doc())
  })
})

describe('removeBlock', () => {
  const doc = (): Block[] => [
    { id: 'a', type: 'p', text: 'First' },
    { id: 'b', type: 'divider', text: '' },
    { id: 'c', type: 'p', text: 'Third' },
  ]

  it('focuses the end of the previous block', () => {
    const edit = removeBlock(doc(), 'c')
    expect(edit.doc.map((b) => b.id)).toEqual(['a', 'b'])
    expect(edit.focusId).toBe('b')
    expect(edit.caret).toBe(0) // the previous block is a divider
    const other = removeBlock(doc(), 'b')
    expect(other.focusId).toBe('a')
    expect(other.caret).toBe(5)
  })

  it('the first block hands focus to the next one', () => {
    const edit = removeBlock(doc(), 'a')
    expect(edit.doc.map((b) => b.id)).toEqual(['b', 'c'])
    expect(edit.focusId).toBe('b')
  })

  it('removing the only block leaves an empty paragraph', () => {
    const edit = removeBlock([{ id: 'a', type: 'divider', text: '' }], 'a', () => 'n1')
    expect(edit.doc).toEqual([{ id: 'n1', type: 'p', text: '' }])
    expect(edit.focusId).toBe('n1')
  })

  it('ignores an unknown block', () => {
    expect(removeBlock(doc(), 'zzz').doc).toEqual(doc())
  })
})

describe('backspaceAtStart', () => {
  it.each(['h1', 'h2', 'h3', 'bullet', 'todo', 'callout'] as const)(
    'a %s becomes a paragraph and keeps its text',
    (type) => {
      const start: Block[] = [
        { id: 'a', type: 'p', text: 'Above' },
        { id: 'b', type, text: 'Keep me' },
      ]
      const edit = backspaceAtStart(start, 'b')
      expect(edit?.doc[1]).toEqual({ id: 'b', type: 'p', text: 'Keep me' })
      expect(edit?.doc).toHaveLength(2)
      expect(edit?.focusId).toBe('b')
      expect(edit?.caret).toBe(0)
    },
  )

  it('a paragraph merges into the previous block', () => {
    const start: Block[] = [
      { id: 'a', type: 'p', text: 'Above' },
      { id: 'b', type: 'p', text: 'Below' },
    ]
    const edit = backspaceAtStart(start, 'b')
    expect(edit?.doc).toEqual([{ id: 'a', type: 'p', text: 'AboveBelow' }])
    expect(edit?.caret).toBe(5)
  })

  it('the first paragraph has nothing to merge into', () => {
    expect(backspaceAtStart([{ id: 'a', type: 'p', text: 'Only' }], 'a')).toBeNull()
    expect(backspaceAtStart([], 'zzz')).toBeNull()
  })

  it('a divider is deleted, even as the first block', () => {
    const second = backspaceAtStart(
      [
        { id: 'a', type: 'p', text: 'Above' },
        { id: 'b', type: 'divider', text: '' },
      ],
      'b',
    )
    expect(second?.doc.map((b) => b.id)).toEqual(['a'])
    expect(second?.focusId).toBe('a')
    const first = backspaceAtStart(
      [
        { id: 'b', type: 'divider', text: '' },
        { id: 'c', type: 'p', text: 'Below' },
      ],
      'b',
    )
    expect(first?.doc.map((b) => b.id)).toEqual(['c'])
    expect(first?.focusId).toBe('c')
  })
})

describe('deleteAtEnd', () => {
  it('pulls the next block text into this one', () => {
    const start: Block[] = [
      { id: 'a', type: 'h2', text: 'Head' },
      { id: 'b', type: 'bullet', text: 'tail' },
      { id: 'c', type: 'p', text: 'end' },
    ]
    const edit = deleteAtEnd(start, 'a')
    expect(edit?.doc).toEqual([
      { id: 'a', type: 'h2', text: 'Headtail' },
      { id: 'c', type: 'p', text: 'end' },
    ])
    expect(edit?.focusId).toBe('a')
    expect(edit?.caret).toBe(4)
  })

  it('a next divider is deleted and the caret stays put', () => {
    const edit = deleteAtEnd(
      [
        { id: 'a', type: 'p', text: 'Above' },
        { id: 'b', type: 'divider', text: '' },
        { id: 'c', type: 'p', text: 'Below' },
      ],
      'a',
    )
    expect(edit?.doc.map((b) => b.id)).toEqual(['a', 'c'])
    expect(edit?.focusId).toBe('a')
    expect(edit?.caret).toBe(5)
  })

  it('deleting on a divider removes it; the end of the document does nothing', () => {
    const start: Block[] = [
      { id: 'a', type: 'p', text: 'Above' },
      { id: 'b', type: 'divider', text: '' },
    ]
    expect(deleteAtEnd(start, 'b')?.doc.map((b) => b.id)).toEqual(['a'])
    expect(deleteAtEnd(start, 'a')?.doc.map((b) => b.id)).toEqual(['a'])
    expect(deleteAtEnd([{ id: 'a', type: 'p', text: 'x' }], 'a')).toBeNull()
  })
})

describe('moveBlockToIndex', () => {
  const doc = (): Block[] => ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'p', text: id }))
  const ids = (blocks: Block[]): string => blocks.map((b) => b.id).join('')

  it('moves a block down and up', () => {
    expect(ids(moveBlockToIndex(doc(), 'a', 2))).toBe('bcad')
    expect(ids(moveBlockToIndex(doc(), 'd', 1))).toBe('adbc')
  })

  it('clamps and treats a no-op as a copy', () => {
    expect(ids(moveBlockToIndex(doc(), 'b', 99))).toBe('acdb')
    expect(ids(moveBlockToIndex(doc(), 'b', -3))).toBe('bacd')
    const start = doc()
    const same = moveBlockToIndex(start, 'b', 1)
    expect(same).toEqual(start)
    expect(same).not.toBe(start)
    expect(ids(moveBlockToIndex(start, 'zzz', 0))).toBe('abcd')
  })

  it('does not mutate its input', () => {
    const input = frozen(doc())
    expect(() => moveBlockToIndex(input, 'a', 3)).not.toThrow()
  })
})

describe('slashContext', () => {
  it('finds a slash at the start of the text', () => {
    expect(slashContext('/', 1)).toEqual({ start: 0, end: 1, query: '' })
    expect(slashContext('/tod', 4)).toEqual({ start: 0, end: 4, query: 'tod' })
  })

  it('finds a slash after a space, with text before it', () => {
    expect(slashContext('Read this /head', 15)).toEqual({ start: 10, end: 15, query: 'head' })
    expect(slashContext('a\n/todo', 7)).toEqual({ start: 2, end: 7, query: 'todo' })
  })

  it('reads only up to the caret', () => {
    expect(slashContext('/todo later', 3)).toEqual({ start: 0, end: 3, query: 'to' })
  })

  it('ignores slashes inside words and after the query ended', () => {
    expect(slashContext('and/or', 6)).toBeNull()
    expect(slashContext('https://wgu.edu', 15)).toBeNull()
    expect(slashContext('a /todo b', 9)).toBeNull() // caret is past a space
    expect(slashContext('plain text', 10)).toBeNull()
    expect(slashContext('/a/b', 4)).toBeNull()
    expect(slashContext('', 0)).toBeNull()
  })

  it('clamps the caret', () => {
    expect(slashContext('/x', 99)).toEqual({ start: 0, end: 2, query: 'x' })
    expect(slashContext('/x', -4)).toBeNull()
  })
})

describe('applySlashAt', () => {
  const doc = (text: string): Block[] => [
    { id: 'a', type: 'p', text: 'Intro' },
    { id: 'b', type: 'p', text },
  ]

  it('a block that is only the slash text is applySlashCommand', () => {
    expect(applySlashAt(doc('/todo'), 'b', 'todo', { start: 0, end: 5 })).toEqual(
      applySlashCommand(doc('/todo'), 'b', 'todo'),
    )
  })

  it('keeps the text around the slash and converts the block', () => {
    const edit = applySlashAt(doc('Read chapter 4 /todo'), 'b', 'todo', { start: 15, end: 20 })
    expect(edit.doc[1]).toEqual({ id: 'b', type: 'todo', text: 'Read chapter 4', checked: false })
    expect(edit.focusId).toBe('b')
    expect(edit.caret).toBe(14)
  })

  it('keeps text after the caret and puts the caret where the slash was', () => {
    const edit = applySlashAt(doc('Before /h2 after'), 'b', 'h2', { start: 7, end: 10 })
    expect(edit.doc[1]).toEqual({ id: 'b', type: 'h2', text: 'Before  after' })
    expect(edit.caret).toBe(7)
  })

  it('a divider goes after the block that keeps its text', () => {
    const edit = applySlashAt(doc('Summary /divider'), 'b', 'divider', { start: 8, end: 16 })
    expect(edit.doc.map((b) => [b.type, b.text])).toEqual([
      ['p', 'Intro'],
      ['p', 'Summary'],
      ['divider', ''],
      ['p', ''],
    ])
    expect(edit.focusId).toBe(edit.doc[3]?.id)
  })

  it('ignores an unknown block', () => {
    expect(applySlashAt(doc('/todo'), 'zzz', 'todo', { start: 0, end: 5 }).doc).toEqual(
      doc('/todo'),
    )
  })

  it('does not mutate its input', () => {
    const input = frozen(doc('x /divider'))
    expect(() => applySlashAt(input, 'b', 'divider', { start: 2, end: 10 })).not.toThrow()
  })
})

describe('markdownShortcut', () => {
  it.each([
    ['# ', 'h1'],
    ['## ', 'h2'],
    ['### ', 'h3'],
    ['- ', 'bullet'],
    ['* ', 'bullet'],
    ['[] ', 'todo'],
    ['[ ] ', 'todo'],
    ['> ', 'callout'],
  ] as const)('%j at the start becomes %s', (prefix, type) => {
    expect(markdownShortcut(prefix, prefix.length)).toEqual({ type, text: '', checked: false })
  })

  it('[x] starts a checked to-do', () => {
    expect(markdownShortcut('[x] ', 4)).toEqual({ type: 'todo', text: '', checked: true })
  })

  it('--- as the whole text is a divider', () => {
    expect(markdownShortcut('---', 3)).toEqual({ type: 'divider', text: '', checked: false })
    expect(markdownShortcut('--', 2)).toBeNull()
    expect(markdownShortcut('---x', 3)).toBeNull()
  })

  it('keeps the text that follows the prefix', () => {
    expect(markdownShortcut('# Chapter 4', 2)).toEqual({
      type: 'h1',
      text: 'Chapter 4',
      checked: false,
    })
  })

  it('needs the caret right after the prefix and nothing before it', () => {
    expect(markdownShortcut('# Chapter 4', 5)).toBeNull()
    expect(markdownShortcut(' # ', 3)).toBeNull()
    expect(markdownShortcut('a- ', 3)).toBeNull()
    expect(markdownShortcut('#', 1)).toBeNull()
    expect(markdownShortcut('#hashtag', 1)).toBeNull()
    expect(markdownShortcut('####', 4)).toBeNull()
    expect(markdownShortcut('', 0)).toBeNull()
  })
})

describe('applyMarkdownShortcut', () => {
  const doc = (): Block[] => [
    { id: 'a', type: 'p', text: '# Chapter 4' },
    { id: 'b', type: 'p', text: 'After' },
  ]

  it('converts the block, drops the prefix and puts the caret at the start', () => {
    const shortcut = markdownShortcut('# Chapter 4', 2)
    if (!shortcut) throw new Error('expected a shortcut')
    const edit = applyMarkdownShortcut(doc(), 'a', shortcut)
    expect(edit.doc[0]).toEqual({ id: 'a', type: 'h1', text: 'Chapter 4' })
    expect(edit.focusId).toBe('a')
    expect(edit.caret).toBe(0)
    expect(edit.doc[1]).toEqual({ id: 'b', type: 'p', text: 'After' })
  })

  it('a checked to-do keeps checked', () => {
    const edit = applyMarkdownShortcut(
      doc(),
      'a',
      { type: 'todo', text: '', checked: true },
      undefined,
    )
    expect(edit.doc[0]).toEqual({ id: 'a', type: 'todo', text: '', checked: true })
  })

  it('a divider gets a paragraph after it', () => {
    const edit = applyMarkdownShortcut(
      [{ id: 'a', type: 'p', text: '---' }],
      'a',
      { type: 'divider', text: '', checked: false },
      () => 'n1',
    )
    expect(edit.doc.map((b) => b.type)).toEqual(['divider', 'p'])
    expect(edit.focusId).toBe('n1')
  })

  it('ignores an unknown block', () => {
    const edit = applyMarkdownShortcut(doc(), 'zzz', { type: 'h1', text: '', checked: false })
    expect(edit.doc).toEqual(doc())
  })
})

describe('pasteText', () => {
  const doc = (): Block[] => [
    { id: 'a', type: 'p', text: 'Hello world' },
    { id: 'b', type: 'p', text: 'After' },
  ]

  it('one line is inserted at the caret, replacing the selection', () => {
    const edit = pasteText(doc(), 'a', 5, 11, ', C182')
    expect(edit.doc[0]).toEqual({ id: 'a', type: 'p', text: 'Hello, C182' })
    expect(edit.focusId).toBe('a')
    expect(edit.caret).toBe(11)
  })

  it('several lines become several blocks; the tail follows the last line', () => {
    const edit = pasteText(doc(), 'a', 5, 5, ' one\ntwo\nthree')
    expect(edit.doc.map((b) => b.text)).toEqual(['Hello one', 'two', 'three world', 'After'])
    expect(edit.doc.map((b) => b.type)).toEqual(['p', 'p', 'p', 'p'])
    expect(edit.focusId).toBe(edit.doc[2]?.id)
    expect(edit.caret).toBe(5)
  })

  it('accepts Windows and old Mac line endings', () => {
    expect(pasteText(doc(), 'a', 0, 0, 'x\r\ny\rz').doc.map((b) => b.text)).toEqual([
      'x',
      'y',
      'zHello world',
      'After',
    ])
  })

  it('drops blank lines and trailing whitespace; a trailing newline is not a block', () => {
    expect(pasteText(doc(), 'a', 11, 11, 'x\n\n\ny  \n').doc.map((b) => b.text)).toEqual([
      'Hello worldx',
      'y',
      'After',
    ])
    const single = pasteText(doc(), 'a', 0, 0, 'Line\n')
    expect(single.doc.map((b) => b.text)).toEqual(['LineHello world', 'After'])
  })

  it('bullets and to-dos continue as the same kind; new to-dos are unchecked', () => {
    const start: Block[] = [{ id: 'a', type: 'todo', text: '', checked: true }]
    const edit = pasteText(start, 'a', 0, 0, 'Read ch 4\nTake quiz\nSubmit')
    expect(edit.doc.map((b) => b.type)).toEqual(['todo', 'todo', 'todo'])
    expect(edit.doc[0]).toEqual({ id: 'a', type: 'todo', text: 'Read ch 4', checked: true })
    expect(edit.doc[1]).toMatchObject({ text: 'Take quiz', checked: false })
    const heading = pasteText([{ id: 'h', type: 'h1', text: '' }], 'h', 0, 0, 'A\nB')
    expect(heading.doc.map((b) => b.type)).toEqual(['h1', 'p'])
  })

  it('never reuses an id, with or without an id factory', () => {
    const plain = pasteText(doc(), 'a', 0, 0, 'a\nb\nc').doc.map((b) => b.id)
    expect(new Set(plain).size).toBe(plain.length)
    let n = 0
    const made = pasteText(doc(), 'a', 0, 0, 'a\nb\nc', () => `id${++n}`).doc.map((b) => b.id)
    expect(new Set(made).size).toBe(made.length)
  })

  it('whitespace-only multi-line paste changes nothing; a divider takes no text', () => {
    expect(pasteText(doc(), 'a', 3, 3, '\n\n \n').doc).toEqual(doc())
    const withDivider: Block[] = [{ id: 'd', type: 'divider', text: '' }]
    expect(pasteText(withDivider, 'd', 0, 0, 'x').doc).toEqual(withDivider)
    expect(pasteText(doc(), 'zzz', 0, 0, 'x').doc).toEqual(doc())
  })

  it('does not mutate its input', () => {
    const input = frozen(doc())
    expect(() => pasteText(input, 'a', 2, 4, 'x\ny')).not.toThrow()
  })
})

describe('toggleInlineMarker', () => {
  it('wraps a selection and keeps it selected', () => {
    expect(toggleInlineMarker('make it bold', 8, 12, '**')).toEqual({
      text: 'make it **bold**',
      start: 10,
      end: 14,
    })
    expect(toggleInlineMarker('say hi', 4, 6, '*')).toEqual({ text: 'say *hi*', start: 5, end: 7 })
    expect(toggleInlineMarker('run npm', 4, 7, '`')).toEqual({
      text: 'run `npm`',
      start: 5,
      end: 8,
    })
  })

  it('a collapsed caret gets an empty pair with the caret between', () => {
    expect(toggleInlineMarker('ab', 1, 1, '**')).toEqual({ text: 'a****b', start: 3, end: 3 })
  })

  it('unwraps a selection that sits inside the markers', () => {
    expect(toggleInlineMarker('make it **bold**', 10, 14, '**')).toEqual({
      text: 'make it bold',
      start: 8,
      end: 12,
    })
    expect(toggleInlineMarker('a `b` c', 3, 4, '`')).toEqual({ text: 'a b c', start: 2, end: 3 })
  })

  it('unwraps a selection that includes the markers', () => {
    expect(toggleInlineMarker('make it **bold**', 8, 16, '**')).toEqual({
      text: 'make it bold',
      start: 8,
      end: 12,
    })
  })

  it('an empty pair with the caret inside is removed', () => {
    expect(toggleInlineMarker('a****b', 3, 3, '**')).toEqual({ text: 'ab', start: 1, end: 1 })
  })

  it('italic inside bold adds a star instead of removing one', () => {
    expect(toggleInlineMarker('**bold**', 2, 6, '*')).toEqual({
      text: '***bold***',
      start: 3,
      end: 7,
    })
    // …and toggling it off again leaves the bold
    expect(toggleInlineMarker('***bold***', 3, 7, '*')).toEqual({
      text: '**bold**',
      start: 2,
      end: 6,
    })
    // bold inside italic
    expect(toggleInlineMarker('*it*', 1, 3, '**')).toEqual({ text: '***it***', start: 3, end: 5 })
  })

  it('a selection covering **bold** with the italic shortcut adds italic', () => {
    expect(toggleInlineMarker('**bold**', 0, 8, '*').text).toBe('***bold***')
  })

  it('round-trips through the parser', () => {
    const wrapped = toggleInlineMarker('C182 notes', 5, 10, '**').text
    expect(parseInline(wrapped)).toEqual([plain('C182 '), span('notes', { bold: true })])
    const unwrapped = toggleInlineMarker(wrapped, 7, 12, '**').text
    expect(unwrapped).toBe('C182 notes')
  })

  it('clamps the range', () => {
    expect(toggleInlineMarker('abc', -2, 99, '*').text).toBe('*abc*')
  })
})
