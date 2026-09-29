import type { Locator, Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Phase 3C: the BlockEditor on /design#block-editor. Typing, the slash menu, markdown shortcuts,
 * Enter/Backspace/arrow navigation, inline marks, paste, reordering, undo, and the empty,
 * read-only, loading and error states. Everything runs in the light column.
 */

const DESKTOP = { width: 1440, height: 1000 }
test.use({ viewport: DESKTOP })

interface Row {
  type: string
  text: string
  checked: boolean
}

const light = (page: Page): Locator => page.locator('section#block-editor [data-column="light"]')
const editor = (page: Page, name: string): Locator => light(page).getByRole('group', { name })
/** The empty specimen: a blank page to type into. */
const blank = (page: Page): Locator => editor(page, 'New notes')
/** The prefilled C182 notes. */
const notes = (page: Page): Locator => editor(page, 'C182 notes')
const menu = (page: Page): Locator => page.getByRole('listbox', { name: 'Insert a block' })

async function openEditor(page: Page): Promise<void> {
  await gotoApp(page, '/design#block-editor')
  await expect(page.locator('section#block-editor')).toBeInViewport()
  await expect(notes(page).getByRole('textbox').first()).toBeVisible()
}

/** Type and text of every block, in order. Text is what the block shows (markup hidden when formatted). */
async function rows(ed: Locator): Promise<Row[]> {
  return ed.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-type]')).map((row) => ({
      type: row.dataset.type ?? '',
      text: row.querySelector('[role="textbox"]')?.textContent ?? '',
      checked: row.hasAttribute('data-checked'),
    })),
  )
}

const texts = async (ed: Locator): Promise<string[]> => (await rows(ed)).map((r) => r.text)
const types = async (ed: Locator): Promise<string[]> => (await rows(ed)).map((r) => r.type)

/** Where the caret is, as an offset in the focused block's text. */
async function caretOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const field = document.activeElement
    const selection = window.getSelection()
    if (!(field instanceof HTMLElement) || !selection || selection.rangeCount === 0) return -1
    const range = document.createRange()
    range.selectNodeContents(field)
    range.setEnd(selection.anchorNode ?? field, selection.anchorOffset)
    return range.toString().length
  })
}

const focusedRole = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.activeElement?.getAttribute('role') ?? null)

const focusedText = (page: Page): Promise<string> =>
  page.evaluate(() => document.activeElement?.textContent ?? '')

test.describe('typing and block structure', () => {
  test('types text, converts with /todo, splits with Enter, merges with Backspace', async ({
    page,
  }) => {
    await openEditor(page)
    const ed = blank(page)
    await ed.getByRole('textbox').first().click()
    await page.keyboard.type('Read chapter 4 of C182')
    expect(await rows(ed)).toEqual([{ type: 'p', text: 'Read chapter 4 of C182', checked: false }])

    // Enter at the end starts a new block; "/todo" turns it into a to-do.
    await page.keyboard.press('Enter')
    await page.keyboard.type('/todo')
    await expect(menu(page)).toBeVisible()
    await expect(menu(page).getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(menu(page)).toHaveCount(0)
    expect(await types(ed)).toEqual(['p', 'todo'])

    await page.keyboard.type('Flashcards: hardware and software')
    await page.keyboard.press('Enter') // a to-do continues the list
    await page.keyboard.type('Practice quiz')
    expect(await rows(ed)).toEqual([
      { type: 'p', text: 'Read chapter 4 of C182', checked: false },
      { type: 'todo', text: 'Flashcards: hardware and software', checked: false },
      { type: 'todo', text: 'Practice quiz', checked: false },
    ])

    // Enter mid-text splits at the caret.
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Enter')
    expect(await texts(ed)).toEqual([
      'Read chapter 4 of C182',
      'Flashcards: hardware and software',
      'Practice',
      ' quiz',
    ])
    expect(await caretOffset(page)).toBe(0)

    // Backspace at the start of a to-do makes it a paragraph first, then merges it up.
    await page.keyboard.press('Backspace')
    expect(await types(ed)).toEqual(['p', 'todo', 'todo', 'p'])
    await page.keyboard.press('Backspace')
    expect(await rows(ed)).toEqual([
      { type: 'p', text: 'Read chapter 4 of C182', checked: false },
      { type: 'todo', text: 'Flashcards: hardware and software', checked: false },
      { type: 'todo', text: 'Practice quiz', checked: false },
    ])
    expect(await caretOffset(page)).toBe('Practice'.length)
    await page.keyboard.type('!')
    expect(await texts(ed)).toEqual([
      'Read chapter 4 of C182',
      'Flashcards: hardware and software',
      'Practice! quiz',
    ])
  })

  test('Enter on an empty list item leaves the list; Delete pulls the next block up', async ({
    page,
  }) => {
    await openEditor(page)
    const ed = blank(page)
    await ed.getByRole('textbox').first().click()
    await page.keyboard.type('- Binary')
    expect(await types(ed)).toEqual(['bullet'])
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    expect(await types(ed)).toEqual(['bullet', 'p'])
    await page.keyboard.type('Octal')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('End')
    await page.keyboard.press('Delete')
    expect(await rows(ed)).toEqual([{ type: 'bullet', text: 'BinaryOctal', checked: false }])
    expect(await caretOffset(page)).toBe('Binary'.length)
  })

  test('Shift+Enter adds a line inside the block, including a trailing empty line', async ({
    page,
  }) => {
    await openEditor(page)
    const ed = blank(page)
    const field = ed.getByRole('textbox').first()
    await field.click()
    await page.keyboard.type('OSI model')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('Layer 1: physical')
    await page.keyboard.press('Shift+Enter')
    expect(await texts(ed)).toEqual(['OSI model\nLayer 1: physical\n'])
    // The empty last line is visible: three lines of text.
    const box = await field.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThan(24 * 2.5)
    await page.keyboard.type('Layer 2: data link')
    expect(await texts(ed)).toEqual(['OSI model\nLayer 1: physical\nLayer 2: data link'])
    expect(await types(ed)).toEqual(['p'])
  })

  test('markdown shortcuts convert a paragraph', async ({ page }) => {
    await openEditor(page)
    const ed = blank(page)
    await ed.getByRole('textbox').first().click()
    const line = async (typed: string): Promise<void> => {
      await page.keyboard.type(typed)
      await page.keyboard.press('Enter')
    }
    await line('# Networks')
    await line('## Layers')
    await line('### Physical')
    await line('- Cables')
    await line('[] Label the ports')
    await line('> Exam Friday')
    await page.keyboard.type('---')
    expect(await rows(ed)).toEqual([
      { type: 'h1', text: 'Networks', checked: false },
      { type: 'h2', text: 'Layers', checked: false },
      { type: 'h3', text: 'Physical', checked: false },
      { type: 'bullet', text: 'Cables', checked: false },
      { type: 'todo', text: 'Label the ports', checked: false },
      { type: 'callout', text: 'Exam Friday', checked: false },
      { type: 'divider', text: '', checked: false },
      { type: 'p', text: '', checked: false },
    ])
    // The caret moved on to the paragraph after the divider.
    await page.keyboard.type('after')
    expect((await texts(ed)).at(-1)).toBe('after')
  })

  test('a slash typed in the middle of a line keeps the text and converts the block', async ({
    page,
  }) => {
    await openEditor(page)
    const ed = blank(page)
    await ed.getByRole('textbox').first().click()
    await page.keyboard.type('Review chapter 4 /todo')
    await expect(menu(page)).toBeVisible()
    await page.keyboard.press('Enter')
    expect(await rows(ed)).toEqual([{ type: 'todo', text: 'Review chapter 4', checked: false }])
    // A slash inside a word is just a slash.
    await page.keyboard.press('Enter')
    await page.keyboard.type('and/or')
    await expect(menu(page)).toHaveCount(0)
  })
})

test.describe('slash menu', () => {
  test('lists every block type, filters, and is a listbox with an active descendant', async ({
    page,
  }) => {
    await openEditor(page)
    const ed = blank(page)
    const field = ed.getByRole('textbox').first()
    await field.click()
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()
    await expect(menu(page).getByRole('option')).toHaveText([
      /Text/,
      /Heading 1/,
      /Heading 2/,
      /Heading 3/,
      /Bulleted list/,
      /To-do/,
      /Callout/,
      /Divider/,
    ])
    // The field keeps focus and points at the highlighted option.
    await expect(field).toBeFocused()
    await expect(field).toHaveAttribute('aria-controls', /.+/)
    const first = menu(page).getByRole('option').first()
    await expect(first).toHaveAttribute('aria-selected', 'true')
    const activeId = await field.getAttribute('aria-activedescendant')
    expect(await first.getAttribute('id')).toBe(activeId)

    await page.keyboard.type('head')
    await expect(menu(page).getByRole('option')).toHaveText([/Heading 1/, /Heading 2/, /Heading 3/])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(menu(page).getByRole('option').nth(2)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowDown') // wraps
    await expect(menu(page).getByRole('option').nth(0)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowUp') // and back
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    expect(await rows(ed)).toEqual([{ type: 'h2', text: '', checked: false }])
    await expect(menu(page)).toHaveCount(0)
  })

  test('Esc closes it and keeps the text; the mouse chooses without moving focus', async ({
    page,
  }) => {
    await openEditor(page)
    const ed = blank(page)
    const field = ed.getByRole('textbox').first()
    await field.click()
    await page.keyboard.type('/call')
    await expect(menu(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(field).toBeFocused() // Esc closed the menu, not the editor
    expect(await texts(ed)).toEqual(['/call'])

    // Typing another slash brings it back; a click on an option applies it.
    await page.keyboard.press('Control+a')
    await page.keyboard.type('/')
    await expect(menu(page)).toBeVisible()
    await menu(page)
      .getByRole('option', { name: /Bulleted list/ })
      .click()
    expect(await rows(ed)).toEqual([{ type: 'bullet', text: '', checked: false }])
    await expect(ed.getByRole('textbox').first()).toBeFocused()
    await page.keyboard.type('Cables')
    expect(await texts(ed)).toEqual(['Cables'])
  })

  test('opens under the caret and follows a caret that moves away by closing', async ({ page }) => {
    await openEditor(page)
    const ed = blank(page)
    const field = ed.getByRole('textbox').first()
    await field.click()
    await page.keyboard.type('Plan /')
    await expect(menu(page)).toBeVisible()
    const panel = await menu(page).boundingBox()
    const block = await field.boundingBox()
    // Under the block (or above it when there is no room), and near the caret's column.
    expect(panel).not.toBeNull()
    expect(block).not.toBeNull()
    expect(Math.abs((panel?.x ?? 0) - ((block?.x ?? 0) + 40))).toBeLessThan(120)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(menu(page)).toHaveCount(0)
  })

  test('the + button adds a block below with the menu open', async ({ page }) => {
    await openEditor(page)
    const ed = notes(page)
    const row = ed.locator('[data-type="h2"]')
    await row.hover()
    await row.getByRole('button', { name: 'Add block below' }).click()
    await expect(menu(page)).toBeVisible()
    await expect(ed.getByRole('textbox', { name: 'Text' }).filter({ hasText: '/' })).toBeFocused()
    await page.keyboard.type('divider')
    await page.keyboard.press('Enter')
    const all = await types(ed)
    expect(all.slice(3, 7)).toEqual(['h2', 'divider', 'p', 'todo'])
  })
})

test.describe('inline marks', () => {
  test('render when the block is not focused and show as typed while editing', async ({ page }) => {
    await openEditor(page)
    const ed = blank(page)
    const field = ed.getByRole('textbox').first()
    await field.click()
    const raw = 'Use **bold**, *italic*, `code` and [WGU](https://www.wgu.edu) here'
    await page.keyboard.type(raw)
    await expect(field).toHaveText(raw) // raw while focused
    expect(await field.locator('strong, em, code, a').count()).toBe(0)

    await page.keyboard.press('Escape') // leave the editor
    await expect(field).not.toBeFocused()
    await expect(field.locator('strong')).toHaveText('bold')
    await expect(field.locator('em')).toHaveText('italic')
    await expect(field.locator('code')).toHaveText('code')
    const link = field.locator('a')
    await expect(link).toHaveText('WGU')
    await expect(link).toHaveAttribute('href', 'https://www.wgu.edu')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(field).toHaveText('Use bold, italic, code and WGU here')
  })

  test('clicking formatted text puts the caret at the matching place in the raw text', async ({
    page,
  }) => {
    await openEditor(page)
    const ed = blank(page)
    const field = ed.getByRole('textbox').first()
    await field.click()
    await page.keyboard.type('Study **networking** today')
    await page.keyboard.press('Escape')
    const strong = await field.locator('strong').boundingBox()
    if (!strong) throw new Error('no formatted run')
    await page.mouse.click(strong.x + strong.width / 2, strong.y + strong.height / 2)
    await expect(field).toBeFocused()
    await expect(field).toHaveText('Study **networking** today')
    await page.keyboard.type('X')
    const [text] = await texts(ed)
    expect(text).toMatch(/^Study \*\*[a-z]*X[a-z]+\*\* today$/)
  })

  test('Mod+B, Mod+I and Mod+E wrap the selection and unwrap it again', async ({ page }) => {
    await openEditor(page)
    const ed = blank(page)
    const field = ed.getByRole('textbox').first()
    await field.click()
    await page.keyboard.type('subnet mask')
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Control+b')
    expect(await texts(ed)).toEqual(['subnet **mask**'])
    await page.keyboard.press('Control+b')
    expect(await texts(ed)).toEqual(['subnet mask'])
    await page.keyboard.press('Control+i')
    expect(await texts(ed)).toEqual(['subnet *mask*'])
    await page.keyboard.press('Control+i')
    await page.keyboard.press('Control+e')
    expect(await texts(ed)).toEqual(['subnet `mask`'])
  })
})

test.describe('moving around', () => {
  test('arrow keys cross block edges, land on dividers and keep the column', async ({ page }) => {
    await openEditor(page)
    const ed = blank(page)
    const field = ed.getByRole('textbox').first()
    await field.click()
    await page.keyboard.type('Physical layer moves bits')
    await page.keyboard.press('Enter')
    await page.keyboard.type('---')
    await page.keyboard.type('Data link layer frames them')
    await page.keyboard.press('Home')
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
    expect(await caretOffset(page)).toBe(10)

    await page.keyboard.press('ArrowUp') // divider
    expect(await focusedRole(page)).toBe('separator')
    await page.keyboard.press('ArrowUp') // back into the first block, at its end
    expect(await focusedText(page)).toBe('Physical layer moves bits')
    expect(await caretOffset(page)).toBe('Physical layer moves bits'.length)
    await page.keyboard.press('ArrowDown')
    expect(await focusedRole(page)).toBe('separator')
    await page.keyboard.press('ArrowDown')
    expect(await focusedText(page)).toBe('Data link layer frames them')
    expect(await caretOffset(page)).toBe(0)

    // Left at the start and Right at the end step over the edge too.
    await page.keyboard.press('ArrowLeft')
    expect(await focusedRole(page)).toBe('separator')
    await page.keyboard.press('Backspace') // deletes the divider
    expect(await types(ed)).toEqual(['p', 'p'])
    expect(await focusedText(page)).toBe('Physical layer moves bits')
  })

  test('the caret column carries over between blocks', async ({ page }) => {
    await openEditor(page)
    const ed = blank(page)
    await ed.getByRole('textbox').first().click()
    await page.keyboard.type('abcdefghij')
    await page.keyboard.press('Enter')
    await page.keyboard.type('abcdefghij')
    await page.keyboard.press('Home')
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowUp')
    expect(await caretOffset(page)).toBe(5)
    await page.keyboard.press('ArrowDown')
    expect(await caretOffset(page)).toBe(5)
  })

  test('inside a multi-line block the arrows move between its lines first', async ({ page }) => {
    await openEditor(page)
    const ed = blank(page)
    await ed.getByRole('textbox').first().click()
    await page.keyboard.type('first block')
    await page.keyboard.press('Enter')
    await page.keyboard.type('line one')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('line two')
    await page.keyboard.press('ArrowUp')
    expect(await focusedText(page)).toBe('line one\nline two') // still in the block, on line one
    await page.keyboard.press('ArrowUp')
    expect(await focusedText(page)).toBe('first block')
  })

  test('Alt+Up and Alt+Down move the block and keep the caret in it', async ({ page }) => {
    await openEditor(page)
    const ed = blank(page)
    await ed.getByRole('textbox').first().click()
    for (const line of ['one', 'two', 'three']) {
      await page.keyboard.type(line)
      if (line !== 'three') await page.keyboard.press('Enter')
    }
    await page.keyboard.press('Alt+ArrowUp')
    expect(await texts(ed)).toEqual(['one', 'three', 'two'])
    expect(await focusedText(page)).toBe('three')
    await page.keyboard.press('Alt+ArrowUp')
    expect(await texts(ed)).toEqual(['three', 'one', 'two'])
    await page.keyboard.press('Alt+ArrowUp') // already first: nothing happens
    expect(await texts(ed)).toEqual(['three', 'one', 'two'])
    await page.keyboard.press('Alt+ArrowDown')
    expect(await texts(ed)).toEqual(['one', 'three', 'two'])
    await page.keyboard.type('!')
    expect(await texts(ed)).toEqual(['one', 'three!', 'two'])
  })

  test('Tab moves focus out (no keyboard trap); Esc leaves too; a single tab stop', async ({
    page,
  }) => {
    await openEditor(page)
    const ed = notes(page)
    await expect(ed.locator('[role="textbox"][tabindex="0"]')).toHaveCount(1)
    const field = ed.getByRole('textbox', { name: 'Heading 3' })
    await field.click()
    await expect(ed.locator('[role="textbox"][tabindex="0"]')).toHaveCount(1)
    await expect(field).toHaveAttribute('tabindex', '0')
    const focusIsOutside = () => ed.evaluate((el) => !el.contains(document.activeElement))
    await page.keyboard.press('Tab')
    await expect(field).not.toBeFocused()
    expect(await focusIsOutside()).toBe(true)
    // The editor's one tab stop is where Shift+Tab brings you back to.
    await page.keyboard.press('Shift+Tab')
    await expect(field).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(field).not.toBeFocused()
    expect(await focusIsOutside()).toBe(true)
    await field.click()
    await page.keyboard.press('Escape')
    await expect(field).not.toBeFocused()
  })
})

test.describe('pasting, undo and reordering', () => {
  test('paste inserts plain text, one block per line', async ({ page }) => {
    await openEditor(page)
    const ed = blank(page)
    const field = ed.getByRole('textbox').first()
    await field.click()
    await page.keyboard.type('Topics: ')
    await field.evaluate((el) => {
      const data = new DataTransfer()
      data.setData('text/plain', 'TCP\r\nUDP\n\nICMP\n')
      data.setData('text/html', '<b>bold html that must not be used</b>')
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
    })
    expect(await rows(ed)).toEqual([
      { type: 'p', text: 'Topics: TCP', checked: false },
      { type: 'p', text: 'UDP', checked: false },
      { type: 'p', text: 'ICMP', checked: false },
    ])
    expect(await caretOffset(page)).toBe('ICMP'.length)
    await page.keyboard.type('!')
    expect((await texts(ed)).at(-1)).toBe('ICMP!')
  })

  test('undo and redo span blocks', async ({ page }) => {
    await openEditor(page)
    const ed = blank(page)
    await ed.getByRole('textbox').first().click()
    await page.keyboard.type('Subnetting')
    await page.keyboard.press('Enter')
    await page.keyboard.type('CIDR')
    expect(await texts(ed)).toEqual(['Subnetting', 'CIDR'])

    await page.keyboard.press('Control+z') // the typing in the second block
    expect(await texts(ed)).toEqual(['Subnetting', ''])
    await page.keyboard.press('Control+z') // the Enter
    expect(await texts(ed)).toEqual(['Subnetting'])
    expect(await caretOffset(page)).toBeGreaterThan(0)
    await page.keyboard.press('Control+Shift+z')
    expect(await texts(ed)).toEqual(['Subnetting', ''])
    await page.keyboard.press('Control+y')
    expect(await texts(ed)).toEqual(['Subnetting', 'CIDR'])
    await page.keyboard.press('Control+y') // nothing left to redo
    expect(await texts(ed)).toEqual(['Subnetting', 'CIDR'])
  })

  test('a to-do ticks with its checkbox and with Mod+Shift+Enter', async ({ page }) => {
    await openEditor(page)
    const ed = notes(page)
    const flashcards = ed.locator('[data-type="todo"]').nth(1)
    await expect(flashcards).not.toHaveAttribute('data-checked')
    await flashcards.getByRole('checkbox').check({ force: true })
    await expect(flashcards).toHaveAttribute('data-checked', 'true')
    await flashcards.getByRole('textbox').click()
    await page.keyboard.press('Control+Shift+Enter')
    await expect(flashcards).not.toHaveAttribute('data-checked')
  })

  test('a block can be dragged by its handle, or moved with the keyboard on the handle', async ({
    page,
  }) => {
    await openEditor(page)
    const ed = notes(page)
    const initial = await texts(ed)
    const ideas = ed.locator('[data-type="h3"]')
    const week = ed.locator('[data-type="h2"]')
    await ideas.hover()
    const handle = await ideas.getByRole('button', { name: 'Drag to reorder' }).boundingBox()
    const target = await week.getByRole('textbox').boundingBox()
    if (!handle || !target) throw new Error('missing geometry')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2, handle.y - 30, { steps: 5 })
    await page.mouse.move(handle.x + handle.width / 2, target.y + 4, { steps: 15 })
    await page.mouse.up()
    await expect.poll(async () => (await types(ed)).slice(2, 5)).toEqual(['callout', 'h3', 'h2'])
    expect((await texts(ed)).length).toBe(initial.length)

    const first = ed.locator('[data-type="todo"]').first()
    await first.hover()
    const grip = first.getByRole('button', { name: 'Drag to reorder' })
    await grip.focus()
    // dnd-kit listens for the arrow keys a tick after the pick-up, so wait for each step to show.
    await page.keyboard.press('Space')
    await expect(grip).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('status').filter({ hasText: 'position 7 of 11' })).toBeAttached()
    await page.keyboard.press('Space')
    await expect
      .poll(async () => (await texts(ed)).filter((t) => /Read chapter 4|Flashcards/.test(t)))
      .toEqual(['Flashcards: hardware and software', 'Read chapter 4: Networks and the Internet'])
  })

  test('the callout emoji can be changed', async ({ page }) => {
    await openEditor(page)
    const ed = notes(page)
    const callout = ed.locator('[data-type="callout"]')
    await callout.getByRole('button', { name: 'Change callout emoji' }).click()
    await page
      .getByRole('dialog', { name: 'Choose emoji' })
      .getByRole('button', { name: 'Rocket' })
      .click()
    await expect(callout.getByRole('button', { name: 'Change callout emoji' })).toHaveText('🚀')
    await expect(callout.getByRole('textbox')).toBeFocused()
  })
})

test.describe('states', () => {
  test('empty: the hint is visible without focus and names the slash menu', async ({ page }) => {
    await openEditor(page)
    const field = blank(page).getByRole('textbox').first()
    await expect(field).toHaveAttribute('data-empty', 'true')
    const hint = await field.evaluate((el) => getComputedStyle(el, '::before').content)
    expect(hint).toContain("Type '/' for commands")
    await expect(field).toHaveAttribute('aria-placeholder', "Type '/' for commands")
  })

  test('read-only: nothing is editable and links stay links', async ({ page }) => {
    await openEditor(page)
    const ed = editor(page, 'D278 notes (read-only)')
    const fields = ed.getByRole('textbox')
    await expect(fields).toHaveCount(3)
    for (const field of await fields.all()) {
      await expect(field).toHaveAttribute('contenteditable', 'false')
      await expect(field).toHaveAttribute('aria-readonly', 'true')
    }
    await expect(ed.getByRole('button', { name: 'Drag to reorder' })).toHaveCount(0)
    await expect(ed.getByRole('checkbox')).toBeDisabled()
    await fields.first().click()
    await page.keyboard.type('nope')
    expect(await texts(ed)).toEqual([
      'D278 Scripting and Programming Foundations',
      'Variables, loops and functions in pseudocode',
      'Finish the zyBooks challenge activities',
    ])
    await expect(editor(page, 'Empty notes (read-only)')).toContainText(
      'No notes for this course yet.',
    )
  })

  test('loading and error', async ({ page }) => {
    await openEditor(page)
    await expect(editor(page, 'Loading notes')).toHaveAttribute('aria-busy', 'true')
    await expect(editor(page, 'Loading notes').getByRole('textbox')).toHaveCount(0)
    const failed = editor(page, 'Notes with an error')
    await expect(failed.getByRole('alert')).toContainText('could not be loaded')
    await expect(failed.getByRole('alert')).toContainText('C182 could not be read')
    await expect(failed.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  test('a new value replaces the document and clears undo', async ({ page }) => {
    await openEditor(page)
    const ed = notes(page)
    await ed.getByRole('textbox', { name: 'Heading 1' }).click()
    await page.keyboard.type(' (edited)')
    await light(page).getByRole('button', { name: 'Load D278 notes' }).click()
    await expect(ed.getByRole('textbox', { name: 'Heading 2' })).toHaveText(
      'D278 Scripting and Programming Foundations',
    )
    expect(await rows(ed)).toHaveLength(3)
    await ed.getByRole('textbox').first().click()
    await page.keyboard.press('Control+z') // history from the old document is gone
    expect(await texts(ed)).toHaveLength(3)
    await light(page).getByRole('button', { name: 'Reset to C182' }).click()
    await expect(ed.getByRole('textbox', { name: 'Heading 1' })).toHaveText(
      'C182 Introduction to IT',
    )
  })

  test('the demo reports the edit and the delayed save', async ({ page }) => {
    await openEditor(page)
    const status = light(page).getByTestId('be-status')
    await expect(status).toContainText('saved')
    await notes(page).getByRole('textbox', { name: 'Heading 1' }).click()
    await page.keyboard.type('!')
    await expect(status).toContainText('saving')
    await expect(status).toContainText('saved')
  })
})
