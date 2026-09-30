import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * The Goal Breakdown Planner end to end (clock fixed at Tue 2026-09-29 09:30): a pasted WGU list through
 * review, an infeasible target and "move the date", the goal page and Today, "life happened" with Undo,
 * the template path, the Claude path, and a draft that survives a refresh.
 */

const WGU_LIST = `WGU B.S. Computer Science, Term 1
C182 Introduction to IT – 4 CUs OA
- Hardware and operating systems
- Networks and the internet
- Cloud and virtualization
C779 Web Development Foundations (3 CUs) PA
- HTML structure
- CSS layout
- JavaScript basics
D278 Scripting and Programming Foundations (3 CUs) OA
- Variables and expressions
- Loops
- Functions
Target: December 18, 2026
`

const CLAUDE_JSON = JSON.stringify({
  forgePlan: 1,
  goal: { name: 'CompTIA Security+ prep', targetDate: '2026-12-15' },
  courses: [
    {
      code: 'SY0-701',
      name: 'Threats, attacks and vulnerabilities',
      estimatedHours: 24,
      units: [{ title: 'Malware and social engineering' }, { title: 'Network attacks' }],
      assessments: [{ title: 'Practice exam', kind: 'quiz' }],
    },
  ],
})

/** A one-page PDF with a line of text per row (Helvetica), built by hand so the test needs no PDF library. */
function makePdf(lines: string[]): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`)
  const content = `BT /F1 12 Tf 72 720 Td 18 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(out, 'latin1')
}

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const next = (page: Page) => page.getByRole('button', { name: 'Continue' }).click()
const heading = (page: Page, name: string | RegExp) => page.getByRole('heading', { name, level: 1 })

async function pasteAndRead(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Syllabus or course list' }).fill(WGU_LIST)
  await page.getByRole('button', { name: 'Read it' }).click()
  await expect(page.getByText('Found: 3 courses, 9 units, 3 assessments')).toBeVisible()
}

/** Reads a whole table straight from IndexedDB, so an assertion never depends on the UI under test. */
async function readTable<T>(page: Page, name: string): Promise<T[]> {
  return page.evaluate(
    (tableName) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db.transaction(tableName, 'readonly').objectStore(tableName).getAll()
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            db.close()
            resolve(req.result as T[])
          }
        }
      }),
    name,
  )
}

test.describe('a pasted course list', () => {
  test('is reviewed, checked against an early target, moved, created, and shown on the goal and Today', async ({
    page,
  }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await expect(heading(page, 'What are you planning?')).toBeVisible()

    // Continuing with nothing says what to do.
    await next(page)
    await expect(page.getByText(/Add something to plan/)).toBeVisible()

    await pasteAndRead(page)
    await next(page)

    // When: the pasted target is read.
    await expect(heading(page, 'When')).toBeVisible()
    await expect(page.getByLabel('Target finish date')).toBeVisible()
    await next(page)

    // Availability: the live summary, and a second window on Monday.
    await expect(heading(page, 'Availability')).toBeVisible()
    await expect(page.getByText(/13 h\/week/)).toBeVisible()
    await next(page)

    // Effort: CUs times the multiplier.
    await expect(heading(page, 'Effort')).toBeVisible()
    await expect(page.getByText('4 CUs × 15 h = 60 h')).toBeVisible()
    await page.getByRole('button', { name: 'Fine-tune 3 units' }).first().click()
    await page.getByRole('radio', { name: 'Know it' }).first().click()
    await expect(page.getByText('30 h').first()).toBeVisible()
    await page.getByRole('radio', { name: 'New to me' }).first().click()
    await next(page)

    // Review: edit hours, delete a unit (with Undo), reorder a course from the keyboard.
    await expect(heading(page, 'Review the plan')).toBeVisible()
    const hours = page.getByRole('textbox', { name: 'Hours for Hardware and operating systems' })
    await hours.fill('25')
    await hours.press('Enter')
    await expect(hours).toHaveValue('25')
    // The course keeps its 60 h budget: the other two units share what is left.
    await expect(
      page.getByRole('textbox', { name: 'Hours for Networks and the internet' }),
    ).toHaveAttribute('placeholder', '17.5')

    await page.getByRole('button', { name: 'Delete Cloud and virtualization' }).click()
    await expect(page.getByRole('textbox', { name: /Title of unit 3 of C182/ })).toHaveCount(0)
    await expect(toasts(page).getByText('Deleted “Cloud and virtualization”')).toBeVisible()
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByRole('textbox', { name: /Title of unit 3 of C182/ })).toHaveValue(
      'Cloud and virtualization',
    )
    await page.getByRole('button', { name: 'Delete Cloud and virtualization' }).click()
    await expect(page.getByRole('textbox', { name: /Title of unit 3 of C182/ })).toHaveCount(0)

    const codes = () =>
      page
        .getByRole('textbox', { name: /^Code of / })
        .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
    expect(await codes()).toEqual(['C182', 'C779', 'D278'])
    const grip = page.getByRole('button', {
      name: 'Reorder D278 Scripting and Programming Foundations',
    })
    await grip.focus()
    await page.keyboard.press('Space')
    // The live region says where the picked-up row is; wait for each step before the next key.
    await expect(
      page.getByText(
        'D278 Scripting and Programming Foundations is over D278 Scripting and Programming Foundations.',
      ),
    ).toBeAttached()
    await page.keyboard.press('ArrowUp')
    await expect(
      page.getByText(/^D278 Scripting and Programming Foundations is over C779/),
    ).toBeAttached()
    await page.keyboard.press('Space')
    await expect.poll(codes).toEqual(['C182', 'D278', 'C779'])
    await next(page)

    // Preview: 3 courses, about 140 h in 11 weeks of evenings does not fit; the calm card says so.
    await expect(heading(page, 'Does it fit?')).toBeVisible()
    await expect(page.getByRole('heading', { name: /doesn’t fit by Dec 18/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Add \d+ min on study days$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Move finish to / })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Cut \d+ units? \(/ })).toBeVisible()
    await expect(page.getByRole('img', { name: /Timeline of 3 courses/ })).toBeVisible()

    // Choose "move the date": the plan is re-run and now fits, with an Undo.
    await page.getByRole('button', { name: /^Move finish to / }).click()
    await expect(page.getByRole('heading', { name: /This fits/ })).toBeVisible()
    await expect(toasts(page).getByText(/Moved your finish to/)).toBeVisible()
    await next(page)

    // Confirm: create.
    await expect(heading(page, 'Confirm')).toBeVisible()
    await page.getByRole('button', { name: 'Create goal' }).click()
    await expect(page).toHaveURL(/\/goals\/[^/]+$/)
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue(
      'WGU B.S. Computer Science, Term 1',
    )
    const table = page.getByRole('table', { name: 'Courses' })
    await expect(table.getByRole('row')).toHaveCount(4)
    await expect(table.getByText('D278')).toBeVisible()
    await expect(
      toasts(page).getByText(/Created “WGU B.S. Computer Science, Term 1”/),
    ).toBeVisible()

    // Everything landed in the database in one go: the deleted unit is not there, assessments are.
    const units = await readTable<{ title: string; estimateMinutes: number }>(page, 'units')
    expect(units.map((u) => u.title)).not.toContain('Cloud and virtualization')
    expect(units.find((u) => u.title === 'Hardware and operating systems')?.estimateMinutes).toBe(
      1500,
    )
    expect(await readTable(page, 'plannedAssessments')).toHaveLength(3)

    // Today shows the goal's sessions.
    await page.getByRole('link', { name: 'Today' }).first().click()
    await expect(
      page.getByRole('button', { name: /^Open C182 · Hardware and operating systems/ }).first(),
    ).toBeVisible()
    await page.getByRole('radio', { name: 'Grouped' }).click()
    await expect(page.getByText('From your goals')).toBeVisible()
  })

  test('life happened previews the moves, applies them, and can be undone', async ({ page }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await page.getByRole('button', { name: /Personal project/ }).click()
    for (let i = 0; i < 5; i++) await next(page)
    await expect(page.getByRole('heading', { name: /This fits/ })).toBeVisible()
    await next(page)
    await page.getByRole('button', { name: 'Create goal' }).click()
    // Not `/goals/new` itself (which the plain pattern also matches): the goal's page, once the plan is
    // written, since the tasks are read straight from the database below.
    await expect(page).toHaveURL(/\/goals\/(?!new$)[^/]+$/)

    const before = await readTable<{
      scheduleKey: string | null
      doDate: string | null
      source: string
    }>(page, 'tasks')
    const planned = before.filter((t) => t.source === 'schedule' && t.scheduleKey !== null)
    expect(planned.length).toBeGreaterThan(10)
    const snapshot = JSON.stringify(planned.map((t) => [t.scheduleKey, t.doDate]).sort())

    // Open with the keyboard shortcut, pick today, preview.
    await expect(page.getByRole('button', { name: /Life happened/ })).toBeVisible()
    await page.keyboard.press('Shift+R')
    const dialog = page.getByRole('dialog', { name: 'Life happened' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Preview' })).toBeDisabled()
    await dialog.getByRole('button', { name: /Tue 29/ }).click()
    await dialog.getByRole('button', { name: 'Preview' }).click()
    await expect(dialog.getByRole('button', { name: 'Confirm re-plan' })).toBeVisible()
    await expect(dialog.getByRole('list', { name: 'Sessions that would move' })).toBeVisible()

    // Nothing changed yet.
    const untouched = await readTable<{
      scheduleKey: string | null
      doDate: string | null
      source: string
    }>(page, 'tasks')
    expect(
      JSON.stringify(
        untouched
          .filter((t) => t.source === 'schedule' && t.scheduleKey !== null)
          .map((t) => [t.scheduleKey, t.doDate])
          .sort(),
      ),
    ).toBe(snapshot)

    await dialog.getByRole('button', { name: 'Confirm re-plan' }).click()
    await expect(dialog).toBeHidden()
    await expect(toasts(page).getByText('Re-planned this week')).toBeVisible()
    const after = await readTable<{
      scheduleKey: string | null
      doDate: string | null
      source: string
    }>(page, 'tasks')
    const moved = JSON.stringify(
      after
        .filter((t) => t.source === 'schedule' && t.scheduleKey !== null)
        .map((t) => [t.scheduleKey, t.doDate])
        .sort(),
    )
    expect(moved).not.toBe(snapshot)

    await toasts(page)
      .getByText('Re-planned this week')
      .locator('xpath=ancestor::*[.//button[normalize-space()="Undo"]][1]')
      .getByRole('button', { name: 'Undo' })
      .click()
    await expect(toasts(page).getByText('Undone')).toBeVisible()
    await expect
      .poll(async () =>
        JSON.stringify(
          (
            await readTable<{ scheduleKey: string | null; doDate: string | null; source: string }>(
              page,
              'tasks',
            )
          )
            .filter((t) => t.source === 'schedule' && t.scheduleKey !== null)
            .map((t) => [t.scheduleKey, t.doDate])
            .sort(),
        ),
      )
      .toBe(snapshot)
  })
})

test.describe('templates and other ways in', () => {
  test('a template goes through the steps to a goal, and Undo brings the draft back', async ({
    page,
  }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await page.getByRole('button', { name: /Certification/ }).click()
    await next(page)
    await expect(page.getByLabel('Target finish date')).toBeVisible()
    await next(page)
    await next(page)
    await next(page)
    await expect(page.getByRole('textbox', { name: 'Goal name' })).toHaveValue(
      'CompTIA A+ Core 1 (220-1101)',
    )
    await expect(page.getByRole('textbox', { name: /^Title of / }).first()).toBeVisible()
    await next(page)
    await expect(page.getByRole('heading', { name: /This fits/ })).toBeVisible()
    await next(page)
    await page.getByRole('button', { name: 'Create goal' }).click()
    await expect(page).toHaveURL(/\/goals\/[^/]+$/)
    await expect(page.getByRole('table', { name: 'Courses' }).getByRole('row')).toHaveCount(7)

    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(page).toHaveURL(/\/goals\/new$/)
    await expect(heading(page, 'Confirm')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Goal name' })).toHaveValue(
      'CompTIA A+ Core 1 (220-1101)',
    )
  })

  test('a photo goes through Claude, and its plan is reviewed before anything is scheduled', async ({
    page,
  }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await page.getByRole('tab', { name: 'Photo (via Claude)' }).click()
    await expect(page.getByText(/Forge doesn’t read photos/)).toBeVisible()
    await page.getByRole('button', { name: 'Copy prompt' }).click()
    await expect(toasts(page).getByText('Prompt copied')).toBeVisible()
    const reply = page.getByRole('textbox', { name: 'Claude’s JSON reply' })
    await reply.fill('{ "nope": ')
    await expect(
      page
        .getByRole('alert')
        .getByText(/Line \d+/)
        .first(),
    ).toBeVisible()
    await reply.fill(CLAUDE_JSON)
    await expect(page.getByText(/Looks good: 1 course, 2 units/)).toBeVisible()
    await page.getByRole('button', { name: 'Review this plan' }).click()
    // AI output lands on the Effort step, not on a schedule.
    await expect(heading(page, 'Effort')).toBeVisible()
    await expect(page.getByText('24 h to plan')).toBeVisible()
    await next(page)
    await expect(heading(page, 'Review the plan')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Goal name' })).toHaveValue(
      'CompTIA Security+ prep',
    )
    expect(await readTable(page, 'goals')).toHaveLength(0)
  })

  test('a PDF is read on the device, under the production CSP, and becomes courses', async ({
    page,
  }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await page.getByRole('tab', { name: 'Upload a PDF' }).click()
    await page.getByLabel('Choose a PDF file').setInputFiles({
      name: 'syllabus.pdf',
      mimeType: 'application/pdf',
      buffer: makePdf([
        'C182 Introduction to IT - 4 CUs OA',
        'C779 Web Development Foundations (3 CUs) PA',
        'D278 Scripting and Programming Foundations (3 CUs) OA',
      ]),
    })
    await expect(page.getByText(/Read 1 page on this device/)).toBeVisible()
    await expect(page.getByText('Found: 3 courses')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Text from the PDF' })).toHaveValue(
      /C779 Web Development Foundations/,
    )

    // Not a PDF: a calm message, nothing thrown.
    await page.getByLabel('Choose a PDF file').setInputFiles({
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('this is not a pdf'),
    })
    await expect(page.getByText(/could not read that PDF/)).toBeVisible()
  })

  test('a typed goal offers a template skeleton', async ({ page }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await page.getByRole('tab', { name: 'Type a goal' }).click()
    await page
      .getByRole('textbox', { name: 'Your goal' })
      .fill('Pass the AWS Solutions Architect exam by Dec 15')
    await page.getByRole('button', { name: 'Use this goal' }).click()
    await expect(page.getByRole('heading', { name: /big one/ })).toBeVisible()
    await page.getByRole('button', { name: /skeleton/ }).click()
    await expect(page.getByText(/Found: 6 courses/)).toBeVisible()
  })

  test('a half-finished draft survives a refresh, and Start over clears it with an Undo', async ({
    page,
  }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await pasteAndRead(page)
    await next(page)
    await page.goto('/goals/new')
    await expect(heading(page, 'When')).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByRole('textbox', { name: 'Syllabus or course list' })).toHaveValue(
      WGU_LIST,
    )
    await page.getByRole('button', { name: 'Start over' }).click()
    await expect(page.getByRole('textbox', { name: 'Syllabus or course list' })).toHaveValue('')
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText(/Found: 3 courses/)).toBeVisible()
  })

  test('the palette and the keyboard reach the planner', async ({ page }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await page.getByRole('textbox', { name: 'Syllabus or course list' }).fill(WGU_LIST)
    await page.keyboard.press('Alt+Enter')
    await expect(heading(page, 'When')).toBeVisible()
    await page.keyboard.press('Alt+Shift+Enter')
    await expect(heading(page, 'What are you planning?')).toBeVisible()
  })
})

test.describe('the goal page', () => {
  test('plan settings save and re-plan, and the palette lists the planner commands', async ({
    page,
  }) => {
    await gotoApp(page, '/goals/goal-wgu-bscs', 'wgu')
    await page.getByRole('button', { name: /Plan settings/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Plan settings' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio', { name: '15%' }).click()
    await dialog.getByRole('button', { name: 'Save and re-plan' }).click()
    await expect(toasts(page).getByText('Plan settings saved')).toBeVisible()
    const goals = await readTable<{ planning: { bufferPct: number } }>(page, 'goals')
    expect(goals[0]?.planning.bufferPct).toBe(0.15)

    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: 'Command palette' })
    await input.fill('life happened')
    await expect(
      page.getByRole('option', { name: /Life happened — re-plan this week/ }),
    ).toBeVisible()
    await input.fill('proposals')
    await expect(page.getByRole('option', { name: /Review plan proposals/ })).toBeVisible()
  })
})

const steps = (page: Page) => page.getByRole('navigation', { name: 'Steps' })
const isoPlus = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

test.describe('number fields keep what is being typed', () => {
  test('hours per CU and CUs take "12.", can be emptied, and accept "0.5"', async ({ page }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await pasteAndRead(page)
    await next(page)
    await next(page)
    await next(page)
    await expect(heading(page, 'Effort')).toBeVisible()

    const multiplier = page.getByRole('textbox', { name: 'Hours per competency unit' })
    await expect(multiplier).toHaveValue('15')
    // Emptied while typing: nothing snaps back under the cursor.
    await multiplier.clear()
    await expect(multiplier).toHaveValue('')
    // "12." stays "12." until the field is left, then reads as 12.
    await multiplier.pressSequentially('12.')
    await expect(multiplier).toHaveValue('12.')
    await multiplier.press('Enter')
    await expect(multiplier).toHaveValue('12')
    await expect(page.getByText('4 CUs × 12 h = 48 h')).toBeVisible()
    // "0.5" gets through "0" on the way.
    await multiplier.clear()
    await multiplier.pressSequentially('0.5')
    await expect(multiplier).toHaveValue('0.5')
    await multiplier.blur()
    await expect(multiplier).toHaveValue('0.5')
    await expect(page.getByText('4 CUs × 0.5 h = 2 h')).toBeVisible()
    // Left empty, it goes back to the last good number; junk is called out and not saved.
    await multiplier.clear()
    await multiplier.blur()
    await expect(multiplier).toHaveValue('0.5')
    await multiplier.fill('lots')
    await multiplier.blur()
    await expect(page.getByText('Try 12 or 7.5')).toBeVisible()
    await multiplier.fill('15')
    await multiplier.blur()
    await expect(page.getByText('4 CUs × 15 h = 60 h')).toBeVisible()

    // The same for a course's CUs: it can be emptied and retyped.
    const cus = page.getByRole('textbox', { name: 'Competency units of C182 Introduction to IT' })
    await expect(cus).toHaveValue('4')
    await cus.clear()
    await expect(cus).toHaveValue('')
    await cus.pressSequentially('4.5')
    await expect(cus).toHaveValue('4.5')
    await cus.blur()
    await expect(page.getByText('4.5 CUs × 15 h = 67.5 h')).toBeVisible()
  })

  test('plan settings take a typed multiplier too', async ({ page }) => {
    await gotoApp(page, '/goals/goal-wgu-bscs', 'wgu')
    await page.getByRole('button', { name: /Plan settings/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Plan settings' })
    const multiplier = dialog.getByRole('textbox', { name: 'Hours per competency unit' })
    await multiplier.clear()
    await multiplier.pressSequentially('0.5')
    await expect(multiplier).toHaveValue('0.5')
    await multiplier.press('Enter')
    await expect(multiplier).toHaveValue('0.5')
    await expect(dialog.getByText('A 3-CU course is about 2 h.')).toBeVisible()
  })
})

test.describe('replacing what was reviewed', () => {
  async function reviewedOutline(page: Page): Promise<void> {
    await gotoApp(page, '/goals/new', 'empty')
    await pasteAndRead(page)
    await next(page)
    await next(page)
    await next(page)
    await expect(heading(page, 'Effort')).toBeVisible()
    // A reviewed edit: C182 is already known.
    await page.getByRole('radio', { name: 'Know it' }).first().click()
    await steps(page).getByRole('button', { name: 'Start' }).click()
    await expect(heading(page, 'What are you planning?')).toBeVisible()
  }

  test('touching the text and pressing Continue asks before replacing the reviewed outline', async ({
    page,
  }) => {
    await reviewedOutline(page)
    const text = page.getByRole('textbox', { name: 'Syllabus or course list' })
    // Whitespace is not an edit: no question, and the outline stays.
    await text.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('   ')
    await next(page)
    await expect(heading(page, 'When')).toBeVisible()
    await steps(page).getByRole('button', { name: 'Start' }).click()

    // A real edit asks first. "Keep my outline" carries on with what was reviewed.
    await text.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\nD999 Elective Seminar (3 CUs)')
    await next(page)
    const ask = page.getByRole('dialog', {
      name: 'Replace your reviewed outline with the new text?',
    })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Keep my outline' }).click()
    await expect(heading(page, 'When')).toBeVisible()
    await steps(page).getByRole('button', { name: 'Start' }).click()
    await expect(page.getByText('Found: 3 courses, 9 units, 3 assessments')).toBeVisible()
    await steps(page).getByRole('button', { name: 'Effort' }).click()
    await expect(page.getByRole('radio', { name: 'Know it' }).first()).toBeChecked()
    await steps(page).getByRole('button', { name: 'Start' }).click()

    // Editing again and choosing "Replace outline" reads the text again, with an Undo.
    await text.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\nD998 Capstone (4 CUs)')
    await next(page)
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Replace outline' }).click()
    await expect(heading(page, 'When')).toBeVisible()
    await expect(toasts(page).getByText('Read the text again')).toBeVisible()
    await steps(page).getByRole('button', { name: 'Start' }).click()
    await expect(page.getByText(/Found: 5 courses/)).toBeVisible()
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Found: 3 courses, 9 units, 3 assessments')).toBeVisible()
  })

  test('reading a PDF over an outline says so and can be undone', async ({ page }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await pasteAndRead(page)
    await page.getByRole('tab', { name: 'Upload a PDF' }).click()
    await page.getByLabel('Choose a PDF file').setInputFiles({
      name: 'other.pdf',
      mimeType: 'application/pdf',
      buffer: makePdf(['D335 Introduction to Programming in Python - 3 CUs OA']),
    })
    await expect(page.getByText('Found: 1 course')).toBeVisible()
    await expect(toasts(page).getByText('Read the PDF')).toBeVisible()
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Found: 3 courses, 9 units, 3 assessments')).toBeVisible()
  })
})

test.describe('the review screen', () => {
  test('Undo puts back exactly the deleted unit, and focus moves on', async ({ page }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await pasteAndRead(page)
    for (let i = 0; i < 4; i++) await next(page)
    await expect(heading(page, 'Review the plan')).toBeVisible()

    // Delete the second unit of C182; focus lands on the unit that took its place.
    await page.getByRole('button', { name: 'Delete Networks and the internet' }).click()
    const second = page.getByRole('textbox', { name: 'Title of unit 2 of C182 Introduction to IT' })
    await expect(second).toHaveValue('Cloud and virtualization')
    await expect(second).toBeFocused()

    // A sibling is edited after the delete...
    const cloud = page.getByRole('textbox', { name: 'Hours for Cloud and virtualization' })
    await cloud.fill('12')
    await cloud.press('Enter')
    // ...and Undo brings back only the deleted unit, leaving that edit alone.
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(
      page.getByRole('textbox', { name: 'Title of unit 2 of C182 Introduction to IT' }),
    ).toHaveValue('Networks and the internet')
    await expect(
      page.getByRole('textbox', { name: 'Hours for Cloud and virtualization' }),
    ).toHaveValue('12')
  })

  test('after deleting the last course, focus goes to the heading', async ({ page }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await pasteAndRead(page)
    for (let i = 0; i < 4; i++) await next(page)
    await page
      .getByRole('button', { name: 'Delete D278 Scripting and Programming Foundations' })
      .click()
    await expect(heading(page, 'Review the plan')).toBeFocused()
    await expect(page.getByRole('textbox', { name: /^Code of / })).toHaveCount(2)
    // One main landmark: the page shell's.
    await expect(page.getByRole('main')).toHaveCount(1)
  })
})

test.describe('a template and its dates', () => {
  test('changing the start offers to shift the template dates, and blocks Continue until they fit', async ({
    page,
  }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await page.getByRole('button', { name: /Semester course/ }).click()
    await next(page)
    await expect(heading(page, 'When')).toBeVisible()
    const target = page.getByLabel('Target finish date')
    const was = await target.inputValue()

    await page.getByLabel('Start date').fill('2026-12-01')
    // Exam dates from the template are now before the start: said inline, and Continue stays put.
    await expect(page.getByText(/before your start date/)).toBeVisible()
    await next(page)
    await expect(heading(page, 'When')).toBeVisible()

    const shift = page.getByRole('button', { name: 'Shift template dates by 63 days' })
    await expect(shift).toBeVisible()
    await shift.click()
    await expect(target).toHaveValue(isoPlus(was, 63))
    await expect(page.getByText(/before your start date/)).toHaveCount(0)
    await expect(shift).toHaveCount(0)
    await expect(toasts(page).getByText(/Moved the template’s dates 63 days later/)).toBeVisible()
    await next(page)
    await expect(heading(page, 'Availability')).toBeVisible()
  })
})
