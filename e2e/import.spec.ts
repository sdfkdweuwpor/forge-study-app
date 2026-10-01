import type { Locator, Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'
import { readTable } from './idb'

/**
 * Phase 5C: importing a plan from Claude (BRIEF §5.4). Copy the prompt, paste the JSON, see errors by
 * line, preview, and import with an explicit click. Merge tests run on the goal page of the sample goal
 * (`?seed=wgu`: C182, C779, D278, C172, C959). The "new goal" flow is opened from its /design demo
 * until the goals list places `ImportGoalButton`; only `openNewGoalImport` needs re-pointing then.
 */

const GOAL_URL = '/goals/goal-wgu-bscs'

/** A reply the way Claude sends it: chatter, a code fence, the JSON, more chatter. The error is on line 8. */
const BROKEN_REPLY = [
  'Here is the plan you asked for:',
  '',
  '```json',
  '{',
  '  "forgePlan": 1,',
  '  "goal": { "name": "WGU" },',
  '  "courses": [',
  '    { "code": "C173", "name": "Scripting and Programming Applications", "estimatedHours": -5 }',
  '  ]',
  '}',
  '```',
  'Let me know if you want changes.',
].join('\n')

const MISSING_COMMA = '{\n  "forgePlan": 1\n  "goal": { "name": "WGU" }\n}'

/** Updates D278 (hours 34 → 40), adds C173, leaves C182, C779, C172 and C959 out. */
const MERGE_PLAN = JSON.stringify(
  {
    forgePlan: 1,
    goal: { name: 'ignored: an existing goal keeps its name' },
    courses: [
      { code: 'D278', name: 'Scripting and Programming Foundations', estimatedHours: 40 },
      {
        code: 'C173',
        name: 'Scripting and Programming Applications',
        cus: 4,
        type: 'PA',
        estimatedHours: 60,
        prerequisites: ['D278'],
        units: [
          { title: 'Data structures', estimatedHours: 20 },
          { title: 'Algorithms', estimatedHours: 40 },
        ],
      },
    ],
  },
  null,
  2,
)
const FENCED_MERGE = `Sure, here you go:\n\n\`\`\`json\n${MERGE_PLAN}\n\`\`\`\n\nAnything else?`

const NEW_GOAL_PLAN = JSON.stringify({
  forgePlan: 1,
  goal: { name: 'Network+ certification', icon: '🌐', targetDate: '2027-01-15' },
  courses: [
    { code: 'N10', name: 'Network fundamentals', cus: 3, type: 'OA', estimatedHours: 30 },
    { code: 'N20', name: 'Network security', estimatedHours: 25, prerequisites: ['N10'] },
  ],
})

const panel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Import plan from Claude' })
const editor = (page: Page): Locator => page.getByLabel(/reply \(JSON\)/)
// Exact: the preview inside the panel is a table named "Courses in this plan".
const courses = (page: Page): Locator =>
  page.getByRole('table', { name: 'Courses', exact: true })
const toasts = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
const importButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Import', exact: true })

async function openPanel(page: Page): Promise<void> {
  await gotoApp(page, GOAL_URL, 'wgu')
  await panel(page).getByRole('button', { name: /^Import plan/ }).click()
  await expect(panel(page).getByRole('tab', { name: '1 Copy prompt' })).toBeVisible()
}

async function pasteStep(page: Page, text: string): Promise<void> {
  await panel(page).getByRole('button', { name: 'I have the JSON' }).click()
  await editor(page).fill(text)
}

/** Opens the new-goal import from its demo on /design (light column), on an empty database. */
async function openNewGoalImport(page: Page): Promise<Locator> {
  await gotoApp(page, '/design#plan-import', 'empty')
  await page
    .locator('#plan-import [data-column="light"]')
    .getByRole('button', { name: 'Import from Claude' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Import a goal from Claude' })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('Import plan from Claude: goal page', () => {
  test('the panel is collapsed until asked for and says nothing is ever deleted', async ({ page }) => {
    await gotoApp(page, GOAL_URL, 'wgu')
    await expect(panel(page)).toContainText('nothing is ever deleted')
    await expect(panel(page).getByRole('tab')).toHaveCount(0)
    await panel(page).getByRole('button', { name: /^Import plan/ }).click()
    await expect(panel(page).getByRole('tab')).toHaveCount(3)
    await panel(page).getByRole('button', { name: 'Close' }).click()
    await expect(panel(page).getByRole('tab')).toHaveCount(0)
  })

  test('invalid JSON: the error shows its line, jumps to it, and blocks the preview', async ({
    page,
  }) => {
    await openPanel(page)
    await pasteStep(page, BROKEN_REPLY)

    const row = panel(page).getByRole('button', { name: /^Line 8:/ })
    await expect(row).toBeVisible()
    await expect(row).toContainText('courses[0].estimatedHours must be a positive number of hours')
    await expect(panel(page).getByText('1 problem to fix before you can import')).toBeVisible()
    await expect(panel(page).getByRole('button', { name: /^Preview/ })).toBeDisabled()
    await expect(panel(page).getByRole('tab', { name: '3 Preview' })).toBeDisabled()
    await expect(editor(page)).toHaveAttribute('aria-invalid', 'true')

    // Click-to-jump selects that whole line of the paste (not of the extracted object).
    await row.click()
    const selected = await editor(page).evaluate(
      (el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd),
    )
    expect(selected).toBe(BROKEN_REPLY.split('\n')[7])
    await expect(editor(page)).toBeFocused()

    // Fixing the line clears the problem.
    await editor(page).fill(BROKEN_REPLY.replace('-5', '55'))
    await expect(panel(page).getByText(/^Valid:/)).toBeVisible()
    await expect(panel(page).getByRole('button', { name: /^Line 8:/ })).toHaveCount(0)
  })

  test('a syntax error names the line where the comma is missing', async ({ page }) => {
    await openPanel(page)
    await pasteStep(page, MISSING_COMMA)
    const row = panel(page).getByRole('button', { name: /^Line 2:/ })
    await expect(row).toContainText('A comma or "}" is missing after this value')
    await expect(panel(page).getByRole('button', { name: /^Preview/ })).toBeDisabled()
  })

  test('schema problems come first; duplicate codes and unknown prerequisites follow once those are fixed', async ({
    page,
  }) => {
    await openPanel(page)
    const plan = {
      forgePlan: 1,
      goal: { name: 'G' },
      courses: [
        { code: 'A1', name: 'A', estimatedHours: 5, prereqs: ['B1'] },
        { code: 'a1', name: 'B', estimatedHours: 5, prerequisites: ['Z9'] },
      ],
    }
    await pasteStep(page, JSON.stringify(plan, null, 2))
    const problems = panel(page).getByRole('button', { name: /^Line \d+:/ })
    // Stage 1: the misspelled field, with a suggestion. Cross-course checks wait for a valid shape.
    await expect(problems).toHaveCount(1)
    await expect(problems).toContainText('courses[0].prereqs is not a known field; did you mean "prerequisites"?')

    // Stage 2: with the typo fixed, the duplicate code and the unknown prerequisite are both reported.
    await editor(page).fill(JSON.stringify(plan, null, 2).replace('"prereqs"', '"prerequisites"'))
    await expect(problems).toHaveCount(3)
    await expect(panel(page)).toContainText('courses[1].code is already used by courses[0]')
    await expect(panel(page)).toContainText('refers to "Z9", which is not a course in this plan')
    await expect(panel(page)).toContainText('refers to "B1", which is not a course in this plan')
  })

  test('valid JSON in a fenced reply: preview first, import only on an explicit click, then undo', async ({
    page,
  }) => {
    await openPanel(page)
    await pasteStep(page, FENCED_MERGE)
    await expect(panel(page).getByText('Valid: 2 courses · 100 h · 4 CUs')).toBeVisible()

    await panel(page).getByRole('button', { name: /^Preview/ }).click()
    const preview = panel(page).getByRole('table', { name: 'Courses in this plan' })
    await expect(preview.getByRole('row', { name: /D278.*Updated/ })).toContainText('hours')
    await expect(preview.getByRole('row', { name: /C173.*PA.*60.*D278.*New/ })).toBeVisible()
    await expect(panel(page)).toContainText('The goal keeps its name and icon.')
    await expect(panel(page)).toContainText('nothing is ever deleted')

    // Previewing wrote nothing: read the database itself, not the page, which a late write could still change.
    expect(
      (await readTable<{ title: string }>(page, 'milestones')).map((m) => m.title),
    ).not.toContain('Scripting and Programming Applications')
    await expect(courses(page).getByText('C173')).toHaveCount(0)
    await expect(courses(page).getByText('40 h', { exact: false })).toHaveCount(0)

    await importButton(page).click()
    await expect(toasts(page)).toContainText('Plan imported')
    await expect(toasts(page)).toContainText('Added 1 course, updated 1. Nothing was deleted.')
    await expect(panel(page).getByRole('tab')).toHaveCount(0)

    // The new course is on the goal page; the courses left out of the plan are untouched.
    for (const code of ['C182', 'C779', 'D278', 'C172', 'C959', 'C173']) {
      await expect(courses(page).getByText(code, { exact: true })).toBeVisible()
    }
    await expect(courses(page).getByText('Scripting and Programming Applications')).toBeVisible()
    // D278's own estimate (its field's label; the cell shows the units' total instead) moved 45 → 40.
    const hoursOf = (code: string, hours: number): Locator =>
      courses(page).getByRole('button', {
        name: new RegExp(`^Estimated hours of ${code} .*: ${hours}\\. Edit$`),
      })
    await expect(hoursOf('D278', 40)).toBeVisible()
    await expect(hoursOf('C173', 60)).toBeVisible()

    // Undo puts everything back.
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(courses(page).getByText('C173', { exact: true })).toHaveCount(0)
    await expect(hoursOf('D278', 45)).toBeVisible()
    await expect(courses(page).getByText('C959', { exact: true })).toBeVisible()
  })

  test('importing the same plan twice changes nothing the second time', async ({ page }) => {
    await openPanel(page)
    await pasteStep(page, MERGE_PLAN)
    await panel(page).getByRole('button', { name: /^Preview/ }).click()
    await importButton(page).click()
    await expect(toasts(page)).toContainText('Plan imported')

    await panel(page).getByRole('button', { name: /^Import plan/ }).click()
    await pasteStep(page, MERGE_PLAN)
    await panel(page).getByRole('button', { name: /^Preview/ }).click()
    await expect(panel(page)).toContainText('Everything in this plan is already in the goal')
    await expect(importButton(page)).toBeDisabled()
  })

  test('copies the prompt with the placeholder, the example and the photo hint', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openPanel(page)
    await panel(page).getByRole('button', { name: 'Copy prompt' }).click()
    await expect(panel(page).getByRole('button', { name: 'Copied' })).toBeVisible()
    await expect(panel(page)).toContainText('Prompt copied')

    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain('PASTE YOUR COURSE OUTLINE / DEGREE PLAN HERE')
    expect(copied).toContain('Reply with ONLY the JSON object')
    expect(copied).toContain('attach a photo or PDF of your syllabus')
    for (const code of ['C182', 'C779', 'D278']) expect(copied).toContain(code)
    expect(copied).toContain('Today is 2026-09-29.')
  })

  test('the schema reference is generated from the schema and can load the example', async ({
    page,
  }) => {
    await openPanel(page)
    await panel(page).getByText('Schema reference').click()
    const table = panel(page).getByRole('table', { name: 'Schema fields' })
    await expect(table.getByRole('row', { name: /estimatedHours.*number > 0, up to 1000.*Required/ })).toBeVisible()
    await expect(table.getByRole('row', { name: /type.*"OA" \| "PA".*Optional/ })).toBeVisible()
    await expect(table.getByRole('row', { name: /start.*date YYYY-MM-DD.*Required in term/ })).toBeVisible()
    await expect(table.getByRole('row', { name: /kind.*"exam" \| "project" \| "quiz"/ })).toBeVisible()

    await panel(page).getByRole('button', { name: 'Try this example' }).click()
    await expect(editor(page)).toHaveValue(/"forgePlan": 1/)
    await expect(panel(page).getByText(/^Valid: 3 courses/)).toBeVisible()
  })

  test('opens from the "i" key and from the command palette', async ({ page }) => {
    await gotoApp(page, GOAL_URL, 'wgu')
    // The goal page is lazy: wait for it (and so for its shortcuts) before pressing a key.
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByRole('tab')).toHaveCount(0)
    await page.keyboard.press('i')
    await expect(panel(page).getByRole('tab', { name: '1 Copy prompt' })).toBeVisible()
    // Focus lands on the first action, so Enter copies the prompt.
    await expect(panel(page).getByRole('button', { name: 'Copy prompt' })).toBeFocused()

    await panel(page).getByRole('button', { name: 'Close' }).click()
    await expect(panel(page).getByRole('tab')).toHaveCount(0)

    await page.keyboard.press('Control+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('import plan')
    await page.getByRole('option', { name: /Import plan from Claude/ }).click()
    await expect(panel(page).getByRole('tab', { name: '1 Copy prompt' })).toBeVisible()
    await expect(page).not.toHaveURL(/import=1/)
  })

  test('Ctrl+Enter moves on to the preview, and never imports', async ({ page }) => {
    await openPanel(page)
    await pasteStep(page, MERGE_PLAN)
    await expect(panel(page).getByText(/^Valid:/)).toBeVisible()
    await editor(page).press('Control+Enter')
    await expect(panel(page).getByRole('tab', { name: '3 Preview', selected: true })).toBeVisible()
    await expect(importButton(page)).toBeFocused()
    await expect(toasts(page)).not.toContainText('Plan imported')
    await expect(courses(page).getByText('C173', { exact: true })).toHaveCount(0)
  })

  test('on a phone the panel never scrolls the page sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openPanel(page)
    await pasteStep(page, MERGE_PLAN)
    await panel(page).getByRole('button', { name: /^Preview/ }).click()
    await expect(importButton(page)).toBeVisible()
    await panel(page).getByText('Schema reference').click()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('Import from Claude: a new goal', () => {
  test('pasting valid JSON creates the goal, opens it, and the courses are on its page', async ({
    page,
  }) => {
    const dialog = await openNewGoalImport(page)
    await dialog.getByRole('button', { name: 'I have the JSON' }).click()
    await dialog.getByLabel(/reply \(JSON\)/).fill(NEW_GOAL_PLAN)
    await dialog.getByRole('button', { name: /^Preview/ }).click()
    await expect(dialog.getByText('New goal', { exact: true })).toBeVisible()
    await expect(dialog).toContainText('Network+ certification')
    await expect(dialog).toContainText('The plan gave none, so this is a starting point')

    await dialog.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page).toHaveURL(/\/goals\/[^/]+$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Network+ certification')
    await expect(toasts(page)).toContainText('Created “Network+ certification”')
    for (const code of ['N10', 'N20']) {
      await expect(courses(page).getByText(code, { exact: true })).toBeVisible()
    }
    await expect(courses(page).getByText('Network security')).toBeVisible()

    // Undo removes the goal and leaves the goal page for the list.
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(page).toHaveURL(/\/goals$/)
  })

  test('errors show their line inside the dialog and Escape closes it', async ({ page }) => {
    const dialog = await openNewGoalImport(page)
    await dialog.getByRole('button', { name: 'I have the JSON' }).click()
    await dialog.getByLabel(/reply \(JSON\)/).fill(BROKEN_REPLY)
    await expect(dialog.getByRole('button', { name: /^Line 8:/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
