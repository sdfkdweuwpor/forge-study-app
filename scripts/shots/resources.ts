import type { Page } from '@playwright/test'
import { putRows } from '../../e2e/idb'
import type { ShotList } from '../shot-types'

/**
 * The course resource library (Phase 11f): the panel with links, PDFs and a note (one of them done), the
 * empty state, the Add menu, the inline link form with its calm message, a note unfolded, and files being
 * dragged over the panel. The sample course is C779 (`?seed=wgu`); rows are written straight into IndexedDB,
 * PDFs included, so the shot needs no upload.
 */

const COURSE = '/goals/goal-wgu-bscs/courses/course-c779'
const PANEL = '[data-testid="resources-panel"]'
const HOUR = 3_600_000
const BASE = new Date(2026, 8, 20, 9, 0).getTime()

const common = { goalId: 'goal-wgu-bscs', milestoneId: 'course-c779' }

interface Row {
  id: string
  kind: 'link' | 'pdf' | 'note'
  title: string
  url?: string
  fileId?: string
  status?: 'toRead' | 'done'
  notes?: string
}

const ROWS: Row[] = [
  {
    id: 'shot-r1',
    kind: 'link',
    title: 'MDN: CSS grid layout',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout',
    notes: 'Read “Basic concepts” and the grid template areas section.',
  },
  {
    id: 'shot-r2',
    kind: 'pdf',
    title: 'C779 study guide',
    fileId: 'shot-f1',
    notes: 'Chapters 3 to 5 for the OA.',
  },
  {
    id: 'shot-r3',
    kind: 'note',
    title: 'Exam tips',
    notes:
      'Read the rubric first.\nBox model questions carry the most points.\nFlexbox is a one-dimensional layout; grid is two-dimensional.',
  },
  {
    id: 'shot-r4',
    kind: 'link',
    title: 'W3C: Web Accessibility Initiative fundamentals',
    url: 'https://www.w3.org/WAI/fundamentals/',
    status: 'done',
  },
  {
    id: 'shot-r5',
    kind: 'pdf',
    title: 'C779 practice assessment, version A',
    fileId: 'shot-f2',
    status: 'done',
  },
]

/** A real IndexedDB file row: a Blob cannot cross Playwright's boundary, so it is made in the page. */
async function putFile(page: Page, id: string, name: string, kb: number): Promise<void> {
  await page.evaluate(
    ([fileId, fileName, size]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['files'], 'readwrite')
          const bytes = new Uint8Array(Number(size) * 1024).fill(32)
          bytes.set(new TextEncoder().encode('%PDF-1.4\n'))
          tx.objectStore('files').put({
            id: fileId,
            createdAt: 1,
            updatedAt: 1,
            name: fileName,
            mime: 'application/pdf',
            size: bytes.length,
            blob: new Blob([bytes], { type: 'application/pdf' }),
          })
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    [id, name, String(kb)] as const,
  )
}

async function seedLibrary(page: Page): Promise<void> {
  await putFile(page, 'shot-f1', 'C779 study guide.pdf', 842)
  await putFile(page, 'shot-f2', 'C779 practice assessment A.pdf', 216)
  await putRows(
    page,
    'resources',
    ROWS.map((r, i) => ({
      ...common,
      id: r.id,
      createdAt: BASE + i * HOUR,
      updatedAt: BASE + i * HOUR,
      kind: r.kind,
      title: r.title,
      url: r.url ?? null,
      fileId: r.fileId ?? null,
      status: r.status ?? 'toRead',
      notes: r.notes ?? '',
      order: i * 1024,
    })),
  )
}

/** Every live query has answered, the panel is on screen and finite animations have settled. */
async function ready(page: Page): Promise<void> {
  await page.locator(PANEL).waitFor()
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.getAttribute('aria-busy') !== 'true',
    PANEL,
  )
  await page.locator(PANEL).scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  )
}

/** The seeded library, opened on the course page. */
async function openLibrary(page: Page): Promise<void> {
  await seedLibrary(page)
  await page.goto(COURSE)
  await ready(page)
}

const list: ShotList = {
  feature: 'resources',
  shots: [
    {
      // To read is the tab a course opens on: three rows, two done ones a tab away.
      name: 'panel',
      path: `${COURSE}?seed=wgu`,
      waitFor: 'main h1',
      element: PANEL,
      prepare: openLibrary,
    },
    {
      // Everything, the done rows muted, and the note unfolded.
      name: 'panel-all',
      path: `${COURSE}?seed=wgu`,
      waitFor: 'main h1',
      element: PANEL,
      prepare: async (page) => {
        await openLibrary(page)
        await page.locator(PANEL).getByRole('tab', { name: /^All/ }).click()
        await page.getByRole('button', { name: 'Exam tips', exact: true }).click()
        await ready(page)
      },
    },
    {
      name: 'empty',
      path: `${COURSE}?seed=wgu`,
      waitFor: 'main h1',
      element: PANEL,
      prepare: ready,
    },
    {
      name: 'add-menu',
      path: `${COURSE}?seed=wgu`,
      waitFor: 'main h1',
      prepare: async (page) => {
        await openLibrary(page)
        await page.getByRole('button', { name: 'Add a resource' }).click()
        await page.getByRole('menu', { name: 'Add a resource' }).waitFor()
        await ready(page)
      },
    },
    {
      // A pasted address that is not a web link: a calm message under the field.
      name: 'add-link-error',
      path: `${COURSE}?seed=wgu`,
      waitFor: 'main h1',
      prepare: async (page) => {
        await openLibrary(page)
        await page.keyboard.press('a')
        await page.getByRole('menuitem', { name: 'Link', exact: true }).click()
        const form = page.getByRole('form', { name: 'Add a link' })
        await form.getByRole('textbox', { name: 'Web address' }).fill('javascript:alert(1)')
        await form.getByRole('button', { name: 'Add link' }).click()
        await form.getByText('Only web links can be added').waitFor()
        await ready(page)
      },
    },
    {
      // A good address: the title field shows the name it will get.
      name: 'add-link',
      path: `${COURSE}?seed=wgu`,
      waitFor: 'main h1',
      prepare: async (page) => {
        await openLibrary(page)
        await page.keyboard.press('a')
        await page.getByRole('menuitem', { name: 'Link', exact: true }).click()
        const form = page.getByRole('form', { name: 'Add a link' })
        await form
          .getByRole('textbox', { name: 'Web address' })
          .fill('www.wgu.edu/online-it-degrees/bachelors-computer-science.html')
        await ready(page)
      },
    },
    {
      name: 'edit-note',
      path: `${COURSE}?seed=wgu`,
      waitFor: 'main h1',
      prepare: async (page) => {
        await openLibrary(page)
        await page.getByRole('button', { name: 'Actions for Exam tips' }).click()
        await page.getByRole('menuitem', { name: 'Edit' }).click()
        await page.getByRole('form', { name: 'Edit note' }).waitFor()
        await ready(page)
      },
    },
    {
      // Files dragged over the panel.
      name: 'drop',
      path: `${COURSE}?seed=wgu`,
      waitFor: 'main h1',
      prepare: async (page) => {
        await openLibrary(page)
        const dataTransfer = await page.evaluateHandle(() => {
          const dt = new DataTransfer()
          dt.items.add(new File(['%PDF-1.4'], 'D278 study guide.pdf', { type: 'application/pdf' }))
          return dt
        })
        await page.locator(PANEL).dispatchEvent('dragenter', { dataTransfer })
        await page.getByText('Drop PDFs to add them to this course').waitFor()
        await ready(page)
      },
    },
    {
      name: 'low-space',
      path: `${COURSE}?seed=wgu`,
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.evaluate(() => {
          navigator.storage.estimate = async () => ({
            usage: 988 * 1024 * 1024,
            quota: 1000 * 1024 * 1024,
          })
        })
        await page.locator(PANEL).waitFor()
        const chooser = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Add a resource' }).click()
        await page.getByRole('menuitem', { name: 'PDF', exact: true }).click()
        await (
          await chooser
        ).setFiles({
          name: 'C779 study guide.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\n'.padEnd(30 * 1024, ' ')),
        })
        await page.getByRole('dialog', { name: 'Space is running low' }).waitFor()
        await page.evaluate(() => document.fonts.ready)
      },
    },
  ],
}

export default list
