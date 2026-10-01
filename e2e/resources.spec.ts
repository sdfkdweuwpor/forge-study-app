import { closeSync, ftruncateSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { FIXED_NOW, expect, gotoApp, test } from './fixtures'
import { putRows, readTable } from './idb'

/**
 * Phase 11f: the Resources panel on a course page (WGU sample, clock frozen at Tue 2026-09-29 09:30).
 * Links, PDFs (stored in IndexedDB) and notes are added the way a person does it, ticked off, filtered,
 * reordered from the keyboard, deleted with Undo and found again after a reload; then the edges: a link that
 * is not a web link, a PDF that is too big or not a PDF, a full browser, a dropped or pasted file, a file
 * that went missing, and the palette search that lands on the panel.
 */

const GOAL = '/goals/goal-wgu-bscs'
const C779 = `${GOAL}/courses/course-c779`
const C182 = `${GOAL}/courses/course-c182`
const MB = 1024 * 1024

/** A tiny but real PDF, made here so the spec ships no fixture file. */
const PDF_BYTES = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n'),
)
const pdfFile = (name: string, buffer: Buffer = PDF_BYTES) => ({
  name,
  mimeType: 'application/pdf',
  buffer,
})

const MDN = 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout'

const panel = (page: Page) => page.getByRole('region', { name: 'Resources' })
const addButton = (page: Page) => panel(page).getByRole('button', { name: 'Add a resource' })
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const tab = (page: Page, name: string) =>
  panel(page).getByRole('tab', { name: new RegExp(`^${name}`) })
const rows = (page: Page) => panel(page).getByRole('list').getByRole('listitem')
const rowTitles = async (page: Page): Promise<string[]> =>
  (await rows(page).locator('[data-row-title], span[class*="plain"]').allTextContents()).map((t) =>
    t.replace(/ \(opens in a new tab\)$/, ''),
  )
const rowOf = (page: Page, title: string): Locator =>
  rows(page).filter({ has: page.getByRole('checkbox', { name: `Done: ${title}` }) })
const handleOf = (page: Page, title: string) =>
  panel(page).getByRole('button', { name: `Reorder ${title}` })
const menuOf = (page: Page, title: string) =>
  panel(page).getByRole('button', { name: `Actions for ${title}` })

interface StoredResource {
  id: string
  goalId: string
  milestoneId: string
  kind: 'link' | 'pdf' | 'note'
  title: string
  url: string | null
  fileId: string | null
  status: 'toRead' | 'done'
  notes: string
  order: number
}
interface StoredFile {
  id: string
  name: string
  mime: string
  size: number
}
interface StoredTrash {
  id: string
  entityTable: string
  title: string
}

const resources = (page: Page) => readTable<StoredResource>(page, 'resources')
const files = (page: Page) => readTable<StoredFile>(page, 'files')
const trash = (page: Page) => readTable<StoredTrash>(page, 'trash')
/** The saved resources of the WGU sample's C779, in list order. */
const c779Titles = async (page: Page): Promise<string[]> =>
  (await resources(page))
    .filter((r) => r.milestoneId === 'course-c779')
    .sort((a, b) => a.order - b.order)
    .map((r) => r.title)

async function openCourse(page: Page, path = C779): Promise<void> {
  await gotoApp(page, path, 'wgu')
  await expect(panel(page)).toBeVisible()
  // The panel is a lazy chunk; wait for its rows to load.
  await expect(panel(page)).not.toHaveAttribute('aria-busy', 'true')
}

async function chooseAdd(page: Page, item: 'Link' | 'PDF' | 'Note'): Promise<void> {
  await addButton(page).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

async function addLink(page: Page, url: string, title = ''): Promise<void> {
  await chooseAdd(page, 'Link')
  const form = page.getByRole('form', { name: 'Add a link' })
  await form.getByRole('textbox', { name: 'Web address' }).fill(url)
  if (title !== '') await form.getByRole('textbox', { name: /^Title/ }).fill(title)
  await form.getByRole('button', { name: 'Add link' }).click()
  await expect(form).toBeHidden()
}

async function addNote(page: Page, title: string, body: string): Promise<void> {
  await chooseAdd(page, 'Note')
  const form = page.getByRole('form', { name: 'Add a note' })
  await form.getByRole('textbox', { name: 'Title' }).fill(title)
  await form.getByRole('textbox', { name: 'Note' }).fill(body)
  await form.getByRole('button', { name: 'Add note' }).click()
  await expect(form).toBeHidden()
}

async function addPdf(page: Page, file: ReturnType<typeof pdfFile>): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await chooseAdd(page, 'PDF')
  await (await chooser).setFiles(file)
}

/** Stub for `window.open`: records where the tab was pointed, or (with `blocked`) refuses to open one. */
async function stubOpen(page: Page, blocked = false): Promise<void> {
  await page.addInitScript((refuse) => {
    const w = window as unknown as {
      __opened: string[]
      __blobs: Blob[]
      __revoked: string[]
    }
    w.__opened = []
    w.__blobs = []
    w.__revoked = []
    const create = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob) w.__blobs.push(obj)
      return create(obj)
    }
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url: string) => {
      w.__revoked.push(url)
      revoke(url)
    }
    window.open = () => {
      if (refuse) return null
      const tab = {
        opener: {} as unknown,
        closed: false,
        close() {
          this.closed = true
        },
        location: {
          set href(value: string) {
            w.__opened.push(value)
          },
        },
      }
      return tab as unknown as Window
    }
  }, blocked)
}

test.describe('the Resources panel', () => {
  test('add a link, a note and a PDF; tick, filter, reorder from the keyboard, delete with Undo; it all survives a reload', async ({
    page,
  }) => {
    await openCourse(page)
    // Nothing yet: a helpful empty state, not a bare list.
    await expect(panel(page).getByRole('heading', { name: 'No resources yet' })).toBeVisible()
    await expect(panel(page).getByRole('button', { name: 'Add a link' })).toBeVisible()

    // A link: with the title typed. It opens in a new tab and never hands the tab our window.
    await addLink(page, MDN, 'MDN: CSS grid guide')
    const link = panel(page).getByRole('link', { name: /MDN: CSS grid guide/ })
    await expect(link).toHaveAttribute('href', MDN)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    await expect(link).toHaveAttribute('rel', /noreferrer/)
    await expect(rowOf(page, 'MDN: CSS grid guide')).toContainText('developer.mozilla.org')

    // A note: title and body, unfolds when its title is clicked.
    await addNote(
      page,
      'Exam tips',
      'Read the rubric first.\nBox model questions carry the most points.',
    )
    const note = rowOf(page, 'Exam tips')
    await expect(note).toContainText('Read the rubric first.')
    await note.getByRole('button', { name: 'Exam tips', exact: true }).click()
    await expect(note.getByText('Box model questions carry the most points.')).toBeVisible()

    // A PDF made from a Buffer: stored in IndexedDB, with its size shown.
    await addPdf(page, pdfFile('C779 study guide.pdf'))
    await expect(rowOf(page, 'C779 study guide')).toContainText(`PDF · ${PDF_BYTES.length} B`)
    await expect(toasts(page)).toContainText('PDF added')
    const [stored] = await files(page)
    expect(stored).toMatchObject({
      name: 'C779 study guide.pdf',
      mime: 'application/pdf',
      size: PDF_BYTES.length,
    })

    expect(await c779Titles(page)).toEqual(['MDN: CSS grid guide', 'Exam tips', 'C779 study guide'])
    const saved = await resources(page)
    expect(saved.every((r) => r.status === 'toRead' && r.goalId === 'goal-wgu-bscs')).toBe(true)
    expect(saved.find((r) => r.kind === 'pdf')?.fileId).toBe(stored?.id)

    // Tick the note off: the row goes quiet, the counts follow, and the filters show the right rows.
    await expect(tab(page, 'All')).toContainText('3')
    await page.getByRole('checkbox', { name: 'Done: Exam tips' }).click()
    await expect(page.getByRole('checkbox', { name: 'Done: Exam tips' })).toBeChecked()
    await expect(note.locator('[data-done]')).toHaveCount(1)
    await expect(tab(page, 'To read')).toContainText('2')
    await expect(tab(page, 'Done')).toContainText('1')
    expect((await resources(page)).find((r) => r.title === 'Exam tips')?.status).toBe('done')

    await tab(page, 'To read').click()
    await expect(rows(page)).toHaveCount(2)
    await expect(rowOf(page, 'Exam tips')).toHaveCount(0)
    await tab(page, 'Done').click()
    await expect(rows(page)).toHaveCount(1)
    await expect(rowOf(page, 'Exam tips')).toBeVisible()
    await tab(page, 'All').click()
    await expect(rows(page)).toHaveCount(3)

    // Reorder from the keyboard: pick the PDF up, one place up, drop.
    await handleOf(page, 'C779 study guide').focus()
    await page.keyboard.press('Space')
    await expect(page.getByText(/^C779 study guide is over C779 study guide\./)).toBeAttached()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByText(/^C779 study guide is over Exam tips\./)).toBeAttached()
    await page.keyboard.press('Space')
    await expect
      .poll(() => c779Titles(page))
      .toEqual(['MDN: CSS grid guide', 'C779 study guide', 'Exam tips'])
    expect(await rowTitles(page)).toEqual(['MDN: CSS grid guide', 'C779 study guide', 'Exam tips'])

    // Delete the PDF: it goes to the Trash with its file, and Undo brings both back in place.
    await menuOf(page, 'C779 study guide').click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(toasts(page)).toContainText('to the trash')
    await expect(rowOf(page, 'C779 study guide')).toHaveCount(0)
    await expect.poll(async () => (await files(page)).length).toBe(0)
    const [entry] = await trash(page)
    expect(entry).toMatchObject({ entityTable: 'resources', title: 'C779 study guide' })

    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(rowOf(page, 'C779 study guide')).toBeVisible()
    await expect.poll(async () => (await files(page)).length).toBe(1)
    expect(await trash(page)).toHaveLength(0)
    expect(await c779Titles(page)).toEqual(['MDN: CSS grid guide', 'C779 study guide', 'Exam tips'])

    // A reload: same rows, same order, the note still done, and the PDF still opens with its own bytes.
    await stubOpen(page)
    await page.reload()
    await expect(panel(page)).toBeVisible()
    // To read while anything waits: the note is done, so it is filtered out.
    await expect(tab(page, 'To read')).toHaveAttribute('aria-selected', 'true')
    await expect(tab(page, 'To read')).toContainText('2')
    expect(await rowTitles(page)).toEqual(['MDN: CSS grid guide', 'C779 study guide'])
    await tab(page, 'All').click()
    expect(await rowTitles(page)).toEqual(['MDN: CSS grid guide', 'C779 study guide', 'Exam tips'])
    await expect(page.getByRole('checkbox', { name: 'Done: Exam tips' })).toBeChecked()

    await panel(page).getByRole('button', { name: 'Open C779 study guide' }).click()
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length),
      )
      .toBe(1)
    const text = await page.evaluate(async () => {
      const blob = (window as unknown as { __blobs: Blob[] }).__blobs[0]
      return { type: blob?.type, head: (await blob?.text())?.slice(0, 8) }
    })
    expect(text).toEqual({ type: 'application/pdf', head: '%PDF-1.4' })
  })

  test('falls back to a download when the browser blocks the new tab', async ({ page }) => {
    await stubOpen(page, true)
    await openCourse(page)
    await addPdf(page, pdfFile('D278 practice exam.pdf'))
    const download = page.waitForEvent('download')
    await panel(page).getByRole('button', { name: 'Open D278 practice exam' }).click()
    expect((await download).suggestedFilename()).toBe('D278 practice exam.pdf')
    await expect(toasts(page)).toContainText('Downloaded instead')
  })

  test('accepts only web links, with a calm message under the field', async ({ page }) => {
    await openCourse(page)
    await chooseAdd(page, 'Link')
    const form = page.getByRole('form', { name: 'Add a link' })
    const address = form.getByRole('textbox', { name: 'Web address' })
    await expect(address).toBeFocused()

    for (const bad of [
      'javascript:alert(document.cookie)',
      'data:text/html,<b>x</b>',
      'file:///etc/passwd',
    ]) {
      await address.fill(bad)
      await form.getByRole('button', { name: 'Add link' }).click()
      await expect(form).toContainText('Only web links can be added')
      await expect(address).toHaveAttribute('aria-invalid', 'true')
    }
    await address.fill('dr.okafor@wgu.edu')
    await address.press('Enter')
    await expect(form).toContainText('That looks like an email address, not a web link.')
    await address.fill('https://user:secret@example.com/notes')
    await address.press('Enter')
    await expect(form).toContainText('username or password')
    await address.fill('hello')
    await address.press('Enter')
    await expect(form).toContainText('doesn’t look like a web address')
    await address.fill('')
    await address.press('Enter')
    await expect(form).toContainText('Paste a link to add it')
    expect(await resources(page)).toHaveLength(0)

    // Typing again clears the message; a bare address gets https:// and a title from its host and path.
    await address.fill('www.wgu.edu/online-it-degrees/')
    await expect(form).not.toContainText('Paste a link')
    await expect(form.getByRole('textbox', { name: /^Title/ })).toHaveAttribute(
      'placeholder',
      'wgu.edu/online-it-degrees',
    )
    await address.press('Enter')
    await expect(form).toBeHidden()
    const [row] = await resources(page)
    expect(row).toMatchObject({
      kind: 'link',
      url: 'https://www.wgu.edu/online-it-degrees/',
      title: 'wgu.edu/online-it-degrees',
    })
    // Focus goes back to where the person started.
    await expect(addButton(page)).toBeFocused()
  })

  test('reorders by dragging the handle, and the order stays through a reload', async ({
    page,
  }) => {
    await gotoApp(page, C779, 'wgu')
    const base = { createdAt: 1, updatedAt: 1, goalId: 'goal-wgu-bscs', milestoneId: 'course-c779' }
    await putRows(page, 'resources', [
      {
        ...base,
        id: 'd1',
        kind: 'link',
        title: 'MDN: CSS grid guide',
        url: MDN,
        fileId: null,
        status: 'toRead',
        notes: '',
        order: 0,
      },
      {
        ...base,
        id: 'd2',
        kind: 'link',
        title: 'W3C accessibility fundamentals',
        url: 'https://www.w3.org/WAI/fundamentals/',
        fileId: null,
        status: 'toRead',
        notes: '',
        order: 1024,
      },
      {
        ...base,
        id: 'd3',
        kind: 'note',
        title: 'Exam tips',
        url: null,
        fileId: null,
        status: 'toRead',
        notes: '',
        order: 2048,
      },
    ])
    await page.goto(C779)
    await expect(rows(page)).toHaveCount(3)

    // Pick the last row up by its handle and drop it on the first.
    await rowOf(page, 'Exam tips').hover() // scrolls it into view; measure after that
    const first = await rows(page).first().boundingBox()
    const grip = await handleOf(page, 'Exam tips').boundingBox()
    if (!first || !grip) throw new Error('rows are not on screen')
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
    await page.mouse.down()
    await page.mouse.move(grip.x + grip.width / 2, grip.y - 20, { steps: 6 })
    await page.mouse.move(grip.x + grip.width / 2, first.y + 4, { steps: 12 })
    await page.mouse.up()

    await expect
      .poll(() => c779Titles(page))
      .toEqual(['Exam tips', 'MDN: CSS grid guide', 'W3C accessibility fundamentals'])
    expect(await rowTitles(page)).toEqual([
      'Exam tips',
      'MDN: CSS grid guide',
      'W3C accessibility fundamentals',
    ])
    await page.reload()
    await expect(rows(page)).toHaveCount(3)
    expect(await rowTitles(page)).toEqual([
      'Exam tips',
      'MDN: CSS grid guide',
      'W3C accessibility fundamentals',
    ])
  })

  test('a stored address that is not a web link is never drawn as a link', async ({ page }) => {
    await gotoApp(page, C779, 'wgu')
    await putRows(page, 'resources', [
      {
        id: 'r-unsafe',
        createdAt: 1,
        updatedAt: 1,
        goalId: 'goal-wgu-bscs',
        milestoneId: 'course-c779',
        kind: 'link',
        title: 'From an old backup',
        url: 'javascript:alert(1)',
        fileId: null,
        status: 'toRead',
        notes: '',
        order: 0,
      },
    ])
    await page.goto(C779)
    const row = rowOf(page, 'From an old backup')
    await expect(row).toContainText('Not a web link')
    await expect(row.getByRole('link')).toHaveCount(0)
    await expect(panel(page).locator('a[href^="javascript"]')).toHaveCount(0)
  })

  test('says so when a PDF is too big or not a PDF, and adds the good ones in the same batch', async ({
    page,
  }) => {
    await openCourse(page)
    // 51 MB, made sparse on disk: Playwright's in-memory buffers stop at 50 MB.
    const dir = mkdtempSync(join(tmpdir(), 'forge-pdf-'))
    const big = join(dir, 'lecture-slides.pdf')
    const fd = openSync(big, 'w')
    ftruncateSync(fd, 51 * MB)
    closeSync(fd)

    const notes = join(dir, 'notes.docx')
    writeFileSync(notes, 'not a pdf')
    const good = join(dir, 'C182 study guide.pdf')
    writeFileSync(good, PDF_BYTES)

    const chooser = page.waitForEvent('filechooser')
    await chooseAdd(page, 'PDF')
    await (await chooser).setFiles([big, notes, good])

    await expect(toasts(page)).toContainText('PDF added')
    await expect(toasts(page)).toContainText('Couldn’t add 2 files')
    await expect(toasts(page)).toContainText(
      '“lecture-slides.pdf” is 51 MB. PDFs up to 50 MB can be added',
    )
    await expect(toasts(page)).toContainText('“notes.docx” isn’t a PDF')
    await expect(rows(page)).toHaveCount(1)
    expect(await files(page)).toHaveLength(1)
    expect(await c779Titles(page)).toEqual(['C182 study guide'])
  })

  test('refuses a file that is named .pdf but is not one', async ({ page }) => {
    await openCourse(page)
    await addPdf(page, pdfFile('trick.pdf', Buffer.from('<html><script>alert(1)</script></html>')))
    await expect(toasts(page)).toContainText('doesn’t look like a PDF')
    expect(await files(page)).toHaveLength(0)
    expect(await resources(page)).toHaveLength(0)
  })

  test('adds a PDF that is dropped on the panel, and one that is pasted', async ({ page }) => {
    await openCourse(page)
    const bytes = [...PDF_BYTES]
    const dataTransfer = await page.evaluateHandle((data) => {
      const dt = new DataTransfer()
      dt.items.add(
        new File([new Uint8Array(data)], 'D278 practice exam.pdf', { type: 'application/pdf' }),
      )
      return dt
    }, bytes)

    await panel(page).dispatchEvent('dragenter', { dataTransfer })
    await expect(panel(page).getByText('Drop PDFs to add them to this course')).toBeVisible()
    await panel(page).dispatchEvent('dragover', { dataTransfer })
    await panel(page).dispatchEvent('drop', { dataTransfer })
    await expect(panel(page).getByText('Drop PDFs to add them to this course')).toBeHidden()
    await expect(rowOf(page, 'D278 practice exam')).toBeVisible()

    // A drag of something that is not a file (text from another page) does nothing.
    const text = await page.evaluateHandle(() => {
      const dt = new DataTransfer()
      dt.setData('text/plain', 'hello')
      return dt
    })
    await panel(page).dispatchEvent('dragenter', { dataTransfer: text })
    await expect(panel(page).getByText('Drop PDFs to add them to this course')).toBeHidden()

    // Paste: a PDF on the clipboard is added; pasted text is left alone.
    await page.evaluate((data) => {
      const dt = new DataTransfer()
      dt.items.add(
        new File([new Uint8Array(data)], 'C182 Security_and_Ethics.pdf', {
          type: 'application/pdf',
        }),
      )
      document.body.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      )
    }, bytes)
    await expect(rowOf(page, 'C182 Security and Ethics')).toBeVisible()
    expect(await files(page)).toHaveLength(2)
  })

  test('warns before saving when the browser is nearly out of space, and saves only if you say so', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // Both numbers are what `navigator.storage.estimate()` reports: 12 MB left.
      navigator.storage.estimate = async () => ({
        usage: 988 * 1024 * 1024,
        quota: 1000 * 1024 * 1024,
      })
    })
    await openCourse(page)

    await addPdf(page, pdfFile('C779 study guide.pdf'))
    const dialog = page.getByRole('dialog', { name: 'Space is running low' })
    await expect(dialog).toContainText('Your browser has about 12 MB left for Forge')
    await expect(dialog).toContainText('It may not fit')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(await files(page)).toHaveLength(0)

    await addPdf(page, pdfFile('C779 study guide.pdf'))
    await dialog.getByRole('button', { name: 'Save anyway' }).click()
    await expect(rowOf(page, 'C779 study guide')).toBeVisible()
    expect(await files(page)).toHaveLength(1)
  })

  test('edits a link, a note and a PDF in place; Esc cancels', async ({ page }) => {
    await openCourse(page)
    await addLink(page, MDN, 'MDN grid')
    await addNote(page, 'Exam tips', 'Read the rubric first.')
    await addPdf(page, pdfFile('C779 study guide.pdf'))

    // The link: a new title and a bad address that is refused; nothing is written until it is fine.
    await menuOf(page, 'MDN grid').click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    const form = page.getByRole('form', { name: 'Edit link' })
    await expect(form.getByRole('textbox', { name: 'Web address' })).toBeFocused()
    await form.getByRole('textbox', { name: 'Web address' }).fill('javascript:alert(1)')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form).toContainText('Only web links can be added')
    await form
      .getByRole('textbox', { name: 'Web address' })
      .fill('https://css-tricks.com/snippets/css/complete-guide-grid/')
    await form.getByRole('textbox', { name: 'Title' }).fill('CSS-Tricks: complete guide to grid')
    await form.getByRole('textbox', { name: 'Note (optional)' }).fill('Best diagrams of the three.')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form).toBeHidden()
    const edited = rowOf(page, 'CSS-Tricks: complete guide to grid')
    await expect(edited).toContainText('css-tricks.com · Best diagrams of the three.')
    await expect(menuOf(page, 'CSS-Tricks: complete guide to grid')).toBeFocused()

    // Esc cancels without saving.
    await menuOf(page, 'Exam tips').click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    const noteForm = page.getByRole('form', { name: 'Edit note' })
    await noteForm.getByRole('textbox', { name: 'Note' }).fill('Something else entirely')
    await page.keyboard.press('Escape')
    await expect(noteForm).toBeHidden()
    expect((await resources(page)).find((r) => r.title === 'Exam tips')?.notes).toBe(
      'Read the rubric first.',
    )

    // Saving from the keyboard with Mod+Enter, and a PDF's own title.
    await menuOf(page, 'Exam tips').click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    await noteForm
      .getByRole('textbox', { name: 'Note' })
      .fill('Read the rubric first.\nThen the unit tests.')
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(noteForm).toBeHidden()
    await expect(page.getByRole('dialog', { name: 'Quick add task' })).toHaveCount(0)
    expect((await resources(page)).find((r) => r.title === 'Exam tips')?.notes).toBe(
      'Read the rubric first.\nThen the unit tests.',
    )

    await menuOf(page, 'C779 study guide').click()
    await page.getByRole('menuitem', { name: 'Edit' }).click()
    const pdfForm = page.getByRole('form', { name: 'Edit PDF' })
    await pdfForm.getByRole('textbox', { name: 'Title' }).fill('Official study guide')
    await pdfForm.getByRole('button', { name: 'Save' }).click()
    await expect(rowOf(page, 'Official study guide')).toContainText('PDF ·')
  })

  test('deleting goes to the Trash with Undo; Restore on the Trash page brings the resource back', async ({
    page,
  }) => {
    await openCourse(page)
    await addLink(page, MDN, 'MDN: CSS grid guide')
    await addPdf(page, pdfFile('C779 study guide.pdf'))

    // Delete both; focus moves to what is left instead of being lost.
    await menuOf(page, 'MDN: CSS grid guide').click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(rowOf(page, 'MDN: CSS grid guide')).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: 'Done: C779 study guide' })).toBeFocused()
    await menuOf(page, 'C779 study guide').click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(panel(page).getByRole('heading', { name: 'No resources yet' })).toBeVisible()
    await expect.poll(async () => (await trash(page)).length).toBe(2)
    expect(await files(page)).toHaveLength(0)

    // The Trash page lists them under Resources; restoring the PDF brings its file back.
    await page.keyboard.press('o')
    await page.keyboard.press('t')
    await expect(page).toHaveURL(/\/trash$/)
    await expect(page.getByRole('heading', { level: 2, name: /^Resources/ })).toBeVisible()
    await page.getByRole('button', { name: 'Restore “C779 study guide”' }).click()
    await expect.poll(async () => (await files(page)).length).toBe(1)
    expect(await resources(page)).toHaveLength(1)

    await page.goto(C779)
    await expect(rowOf(page, 'C779 study guide')).toBeVisible()
    await expect(rowOf(page, 'MDN: CSS grid guide')).toHaveCount(0)
  })

  test('moving the course to the Trash takes its resources and files; Undo brings them back', async ({
    page,
  }) => {
    await openCourse(page)
    await addLink(page, MDN, 'MDN: CSS grid guide')
    await addPdf(page, pdfFile('C779 study guide.pdf'))
    await expect(rows(page)).toHaveCount(2)

    await page.getByRole('button', { name: 'More actions' }).first().click() // the page's own, before its tasks'
    await page.getByRole('menuitem', { name: 'Move to trash' }).click()
    await expect(page).toHaveURL(/\/goals\/goal-wgu-bscs$/)
    await expect.poll(async () => (await resources(page)).length).toBe(0)
    expect(await files(page)).toHaveLength(0)

    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await resources(page)).length).toBe(2)
    expect(await files(page)).toHaveLength(1)
    await page.goto(C779)
    await expect(rows(page)).toHaveCount(2)
  })

  /** A library across two courses, written while the app sits on the Inbox; the palette is then opened there. */
  async function seedPaletteLibrary(page: Page): Promise<void> {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    const base = { createdAt: 1, updatedAt: 1, goalId: 'goal-wgu-bscs', fileId: null, notes: '' }
    await putRows(page, 'resources', [
      {
        ...base,
        id: 'r1',
        milestoneId: 'course-c182',
        kind: 'link',
        title: 'CompTIA IT Fundamentals overview',
        url: 'https://www.comptia.org/certifications/it-fundamentals',
        status: 'toRead',
        order: 0,
      },
      {
        ...base,
        id: 'r2',
        milestoneId: 'course-c779',
        kind: 'link',
        title: 'MDN: CSS grid guide',
        url: MDN,
        status: 'done',
        order: 0,
      },
      {
        ...base,
        id: 'r3',
        milestoneId: 'course-c779',
        kind: 'note',
        title: 'Exam tips',
        url: null,
        status: 'toRead',
        order: 1024,
        notes: 'Read the rubric first.',
      },
    ])
    await page.goto('/tasks/inbox')
    // The sidebar's search button opens it as soon as the page is up; a key pressed a moment too early is lost.
    await page.getByRole('button', { name: 'Search and commands' }).click()
  }

  test('the palette finds a resource by title and opens its course at the panel', async ({
    page,
  }) => {
    await seedPaletteLibrary(page)
    const input = page.getByRole('combobox', { name: 'Command palette' })
    await input.fill('mdn grid')
    const option = page.getByRole('option', { name: /MDN: CSS grid guide/ })
    await expect(option).toContainText('Link · C779 Web Development Foundations')
    await expect(page.getByRole('group', { name: 'Resources' })).toBeVisible()
    await option.click()

    // On the course page, the panel is on screen with the row found (it is done, so under All) and focused.
    await expect(page).toHaveURL(new RegExp(`${C779}$`))
    await expect(panel(page)).toBeInViewport()
    await expect(tab(page, 'All')).toHaveAttribute('aria-selected', 'true')
    await expect(panel(page).getByRole('link', { name: /MDN: CSS grid guide/ })).toBeFocused()
    await expect(page.getByRole('checkbox', { name: 'Done: MDN: CSS grid guide' })).toBeChecked()
  })

  test('a resource of another course opens that course, not the one you were on', async ({
    page,
  }) => {
    await seedPaletteLibrary(page)
    const input = page.getByRole('combobox', { name: 'Command palette' })
    await input.fill('comptia')
    await page.getByRole('option', { name: /CompTIA IT Fundamentals overview/ }).click()
    await expect(page).toHaveURL(new RegExp(`${C182}$`))
    await expect(
      panel(page).getByRole('link', { name: /CompTIA IT Fundamentals overview/ }),
    ).toBeFocused()
  })

  test('shows a PDF whose file is missing without breaking, and it can still be deleted', async ({
    page,
  }) => {
    await gotoApp(page, C779, 'wgu')
    await putRows(page, 'resources', [
      {
        id: 'r-gone',
        createdAt: 1,
        updatedAt: 1,
        goalId: 'goal-wgu-bscs',
        milestoneId: 'course-c779',
        kind: 'pdf',
        title: 'Restored study guide',
        url: null,
        fileId: 'no-such-file',
        status: 'toRead',
        notes: '',
        order: 0,
      },
    ])
    await page.goto(C779)
    const row = rowOf(page, 'Restored study guide')
    await expect(row).toContainText('File missing')
    await expect(row.getByRole('button', { name: /^Open/ })).toHaveCount(0)
    await menuOf(page, 'Restored study guide').click()
    await expect(page.getByRole('menuitem', { name: 'Download' })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(row).toHaveCount(0)
  })

  test('opens the Add menu with a, and the palette adds to the course you are on', async ({
    page,
  }) => {
    await openCourse(page)
    await page.keyboard.press('a')
    await expect(page.getByRole('menu', { name: 'Add a resource' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)

    await page.keyboard.press('ControlOrMeta+k')
    const input = page.getByRole('combobox', { name: 'Command palette' })
    await input.fill('add a note to')
    await page.getByRole('option', { name: /Add a note to this course/ }).click()
    await expect(page.getByRole('form', { name: 'Add a note' })).toBeVisible()
    await expect(
      page.getByRole('form', { name: 'Add a note' }).getByRole('textbox', { name: 'Title' }),
    ).toBeFocused()

    // Not offered away from a course page.
    await page.getByRole('link', { name: 'Goals', exact: true }).first().click()
    await page.keyboard.press('ControlOrMeta+k')
    await input.fill('add a link to')
    await expect(page.getByRole('option', { name: /Add a link to this course/ })).toHaveCount(0)
  })

  test('says "marked done" again when the same change is made twice', async ({ page }) => {
    await gotoApp(page, C779, 'wgu')
    await putRows(page, 'resources', [
      {
        id: 'a1',
        createdAt: 1,
        updatedAt: 1,
        goalId: 'goal-wgu-bscs',
        milestoneId: 'course-c779',
        kind: 'link',
        title: 'MDN grid',
        url: MDN,
        fileId: null,
        status: 'toRead',
        notes: '',
        order: 0,
      },
    ])
    await page.goto(C779)
    await tab(page, 'All').click()
    const announcer = page.getByTestId('resources-announcer')
    // Every time the live region's text is set to something, note it.
    await announcer.evaluate((el) => {
      const seen: string[] = []
      ;(window as unknown as { __said: string[] }).__said = seen
      new MutationObserver(() => {
        if (el.textContent) seen.push(el.textContent)
      }).observe(el, { childList: true, characterData: true, subtree: true })
    })
    const box = page.getByRole('checkbox', { name: 'Done: MDN grid' })
    await box.click()
    await expect(box).toBeChecked()
    await box.click()
    await expect(box).not.toBeChecked()
    await box.click()
    await expect(box).toBeChecked()
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __said: string[] }).__said))
      .toEqual(['MDN grid marked done', 'MDN grid marked to read', 'MDN grid marked done'])
  })

  test('works at phone width: no sideways scroll, and every row control is reachable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openCourse(page)
    await addLink(page, MDN, 'MDN: CSS grid guide, the long-form reference with every property')
    await addNote(page, 'Exam tips', 'Read the rubric first.')
    await addPdf(page, pdfFile('C779 study guide.pdf'))
    await expect(rows(page)).toHaveCount(3)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(menuOf(page, 'Exam tips')).toBeVisible()
    await expect(handleOf(page, 'Exam tips')).toBeVisible()
    await menuOf(page, 'Exam tips').click()
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible()
  })
})

test.describe('the Resources panel with a controlled clock', () => {
  test.use({ fixedClock: false })

  test('opens a PDF in a new tab through an object URL, and revokes it a minute later', async ({
    page,
  }) => {
    await page.clock.install({ time: FIXED_NOW })
    await stubOpen(page)
    await openCourse(page)
    await page.clock.setSystemTime(FIXED_NOW)
    await addPdf(page, pdfFile('C779 study guide.pdf'))
    await panel(page).getByRole('button', { name: 'Open C779 study guide' }).click()

    const opened = () => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
    await expect.poll(async () => (await opened()).length).toBe(1)
    const [url] = await opened()
    expect(url).toMatch(/^blob:http:\/\/localhost:\d+\//)
    expect(
      await page.evaluate(() => (window as unknown as { __revoked: string[] }).__revoked),
    ).toEqual([])

    await page.clock.fastForward('01:05')
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __revoked: string[] }).__revoked))
      .toEqual([url])
  })
})

test.describe('the Resources panel with a damaged row', () => {
  // React logs an error its boundary caught; this test provokes one on purpose.
  test.use({
    ignoreConsoleErrors: ['Cannot read properties of undefined', 'The above error occurred'],
  })

  test('a row that cannot be drawn shows a calm message in the panel, not a broken page', async ({
    page,
  }) => {
    await gotoApp(page, C779, 'wgu')
    await putRows(page, 'resources', [
      // No `notes` at all: what a hand-edited or damaged backup could hold.
      {
        id: 'r-bad',
        createdAt: 1,
        updatedAt: 1,
        goalId: 'goal-wgu-bscs',
        milestoneId: 'course-c779',
        kind: 'link',
        title: 'Damaged row',
        url: 'https://example.com',
        fileId: null,
        status: 'toRead',
        order: 0,
      },
    ])
    await page.goto(C779)
    const region = panel(page)
    await expect(region).toContainText(
      'Couldn’t load the resources for this course. They are safe.',
    )
    await expect(region.getByRole('button', { name: 'Try again' })).toBeVisible()
    // The rest of the course page is still there.
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Units' })).toBeVisible()
  })
})

test.describe('the Resources panel on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } })

  test('every control in a row, the title included, is at least 44 px tall', async ({ page }) => {
    await gotoApp(page, C779, 'wgu')
    const base = { createdAt: 1, updatedAt: 1, goalId: 'goal-wgu-bscs', milestoneId: 'course-c779' }
    await putRows(page, 'resources', [
      {
        ...base,
        id: 't1',
        kind: 'link',
        title: 'MDN grid',
        url: MDN,
        fileId: null,
        status: 'toRead',
        notes: '',
        order: 0,
      },
      {
        ...base,
        id: 't2',
        kind: 'note',
        title: 'Exam tips',
        url: null,
        fileId: null,
        status: 'toRead',
        notes: 'Read the rubric.',
        order: 1024,
      },
    ])
    await page.goto(C779)
    await expect(rows(page)).toHaveCount(2)
    const heights = await panel(page).evaluate((el) => {
      const h = (sel: string) =>
        Array.from(el.querySelectorAll<HTMLElement>(sel)).map((n) =>
          Math.round(n.getBoundingClientRect().height),
        )
      return {
        titles: h('[data-row-title]'),
        checks: h('input[type="checkbox"]'),
        menus: h('button[aria-haspopup="menu"]:not([data-role])'),
        grips: h('button[aria-label^="Reorder"]'),
        rowHeights: h('li'),
      }
    })
    for (const list of [heights.titles, heights.checks, heights.menus, heights.grips]) {
      expect(list).toHaveLength(2)
      for (const height of list) expect(height).toBeGreaterThanOrEqual(44)
    }
    // Rows do not balloon to make room for it: a title, its line under it and the padding.
    for (const height of heights.rowHeights) expect(height).toBeLessThan(90)
  })
})
