import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Phase 5B: the goals screens end to end on the WGU sample (clock fixed at Tue 2026-09-29 09:30):
 * the list, the new-goal flow, the goal page's inline edits and reordering, the course page, the sidebar
 * tree, palette search, and trash with Undo. Goals import and the timeline have their own specs.
 */

const GOAL = '/goals/goal-wgu-bscs'
const C779 = `${GOAL}/courses/course-c779`
const C779_NAME = 'C779 Web Development Foundations'

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const undo = (page: Page) => toasts(page).getByRole('button', { name: 'Undo' })
const wizard = (page: Page) => page.getByRole('dialog', { name: 'New goal' })
const paletteInput = (page: Page) => page.getByRole('combobox', { name: 'Command palette' })
const pageTitle = (page: Page) => page.getByRole('textbox', { name: 'Page title' })
const table = (page: Page) => page.getByRole('table', { name: 'Courses' })

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

interface StoredCourse {
  id: string
  code: string | null
  status: string
  order: number
  cus: number | null
  prerequisiteIds: string[]
}
interface StoredTask {
  source: string
  status: string
  milestoneId: string | null
  goalId: string | null
}

test.describe('the goals list', () => {
  test('shows each goal with its progress and a calm projection, and the sidebar tree opens its courses', async ({
    page,
  }) => {
    await gotoApp(page, '/goals', 'wgu')
    await expect(page.getByRole('heading', { level: 1, name: 'Goals' })).toBeVisible()
    const list = page.getByRole('list', { name: 'Goals' })
    await expect(list.getByRole('link', { name: 'B.S. Computer Science — WGU' })).toBeVisible()
    await expect(list.getByText('18% of hours done')).toBeVisible()
    // Slip is told in plain words with a date, never as an alarm.
    await expect(list.getByText(/^Projected .+ · \d+ days? (before|after) target$/)).toBeVisible()
    await expect(list.getByText('4 of 18 CUs this term')).toBeVisible()

    const nav = page.getByRole('navigation', { name: 'Main' })
    await nav.getByRole('button', { name: 'Expand B.S. Computer Science — WGU' }).click()
    await expect(nav.getByRole('link', { name: 'C182 Introduction to IT' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'C959 Discrete Mathematics I' })).toBeVisible()
  })

  test('the sidebar marks the goal and the course you are on', async ({ page }) => {
    await gotoApp(page, C779, 'wgu')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link', { name: C779_NAME })).toHaveAttribute('aria-current', 'page')
    await expect(
      nav.getByRole('link', { name: 'B.S. Computer Science — WGU' }),
    ).not.toHaveAttribute('aria-current', 'page')
    await nav.getByRole('link', { name: 'B.S. Computer Science — WGU' }).click()
    await expect(nav.getByRole('link', { name: 'B.S. Computer Science — WGU' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('an empty list offers the flow, and n opens it', async ({ page }) => {
    await gotoApp(page, '/goals', 'empty')
    await expect(page.getByRole('heading', { name: 'No goals yet' })).toBeVisible()
    await expect(page.getByText(/WGU degree/)).toBeVisible()
    await page.keyboard.press('n')
    await expect(wizard(page)).toBeVisible()
    await expect(page).toHaveURL(/\/goals\/new$/)
    await page.keyboard.press('Escape')
    await expect(wizard(page)).toBeHidden()
    await expect(page).toHaveURL(/\/goals$/)
  })

  test('a link to a goal that is gone says so', async ({ page }) => {
    await gotoApp(page, '/goals/nope', 'wgu')
    await expect(page.getByRole('heading', { name: 'Goal not found' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to goals' }).click()
    await expect(page).toHaveURL(/\/goals$/)
    await gotoApp(page, `${GOAL}/courses/nope`)
    await expect(page.getByRole('heading', { name: 'Course not found' })).toBeVisible()
  })
})

test.describe('the new-goal flow', () => {
  test('asks for a name before moving on, then walks the steps from the keyboard', async ({
    page,
  }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await expect(wizard(page)).toBeVisible()
    await wizard(page).getByRole('button', { name: 'Next' }).click()
    await expect(wizard(page).getByText('Give the goal a name.')).toBeVisible()

    await wizard(page).getByRole('textbox', { name: 'Goal name' }).fill('Security+ prep')
    await page.keyboard.press('Control+Enter')
    await expect(wizard(page).getByText('Step 2 of 4 · Courses')).toBeVisible()

    // Courses: nothing yet, so the step says so and offers to add one.
    await wizard(page)
      .getByRole('button', { name: 'Next' })
      .click()
      .catch(() => undefined)
    await wizard(page).getByRole('button', { name: 'Add a course' }).click()
    await wizard(page)
      .getByRole('textbox', { name: 'Name of course 1' })
      .fill('Network fundamentals')
    // Enter in the last row's name starts the next row.
    await page.keyboard.press('Enter')
    await expect(wizard(page).getByRole('textbox', { name: 'Name of course 2' })).toBeFocused()
    await wizard(page)
      .getByRole('textbox', { name: 'Name of course 2' })
      .fill('Threats and attacks')
    await page.keyboard.press('Control+Enter')
    await expect(wizard(page).getByText('Hours from 0.5 to 2000.').first()).toBeVisible()
    await wizard(page).getByRole('textbox', { name: 'Estimated hours of course 1' }).fill('12')
    await wizard(page).getByRole('textbox', { name: 'Estimated hours of course 2' }).fill('8')
    await page.keyboard.press('Control+Enter')
    await expect(wizard(page).getByText('Step 3 of 4 · Availability')).toBeVisible()
    await expect(wizard(page).getByText('5 study days · 5 h a week')).toBeVisible()
    await page.keyboard.press('Control+Enter')
    // 20 h at an hour a day on weekdays: four weeks.
    await expect(wizard(page).getByText(/At this pace you’d finish around/)).toBeVisible()
    await page.keyboard.press('Control+Enter')
    await expect(page).toHaveURL(/\/goals\/[^/]+$/)
    await expect(pageTitle(page)).toHaveValue('Security+ prep')
    await expect(table(page).getByRole('row')).toHaveCount(3)
    const tasks = await readTable<StoredTask>(page, 'tasks')
    expect(tasks.filter((t) => t.source === 'schedule').length).toBeGreaterThan(10)
  })

  test('loads the WGU template, previews the finish, and creates the plan', async ({ page }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await wizard(page)
      .getByRole('button', { name: 'Load the B.S. Computer Science template' })
      .click()
    await expect(wizard(page).getByRole('textbox', { name: 'Name of course 1' })).toHaveValue(
      'Introduction to IT',
    )
    await expect(wizard(page).getByRole('textbox', { name: 'Code of course 7' })).toHaveValue(
      'C867',
    )
    await wizard(page).getByRole('button', { name: 'Next' }).click()
    await wizard(page).getByRole('button', { name: 'Next' }).click()
    await expect(wizard(page).getByText(/7 courses · 24 CUs · 310 h of study/)).toBeVisible()
    await wizard(page).getByRole('button', { name: 'Create goal' }).click()

    await expect(page).toHaveURL(/\/goals\/[^/]+$/)
    await expect(pageTitle(page)).toHaveValue('B.S. Computer Science')
    await expect(table(page).getByRole('row')).toHaveCount(8)
    await expect(toasts(page).getByText(/study blocks scheduled/)).toBeVisible()
    // The sidebar tree has it, open, with its courses.
    await expect(
      page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: 'C867 Scripting and Programming Applications' }),
    ).toBeVisible()
    const courses = await readTable<StoredCourse>(page, 'milestones')
    const d278 = courses.find((c) => c.code === 'D278')
    expect(courses.find((c) => c.code === 'C867')?.prerequisiteIds).toEqual([d278?.id])
  })

  test('a half-finished draft survives a refresh, and Start over clears it', async ({ page }) => {
    await gotoApp(page, '/goals/new', 'empty')
    await wizard(page).getByRole('textbox', { name: 'Goal name' }).fill('Cert prep')
    await page.goto('/goals/new')
    await expect(wizard(page).getByRole('textbox', { name: 'Goal name' })).toHaveValue('Cert prep')
    await wizard(page).getByRole('button', { name: 'Start over' }).click()
    await expect(wizard(page).getByRole('textbox', { name: 'Goal name' })).toHaveValue('')
  })

  test('the palette starts it, and the template can be undone', async ({ page }) => {
    await gotoApp(page, '/goals', 'empty')
    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('new goal')
    await page
      .getByRole('option', { name: /New goal/ })
      .first()
      .click()
    await expect(wizard(page)).toBeVisible()
    await wizard(page)
      .getByRole('button', { name: 'Load the B.S. Computer Science template' })
      .click()
    await expect(wizard(page).getByRole('textbox', { name: 'Name of course 1' })).toBeVisible()
    await undo(page).click()
    await expect(wizard(page).getByText('Step 1 of 4 · Basics')).toBeVisible()
    await expect(wizard(page).getByRole('textbox', { name: 'Goal name' })).toHaveValue('')
  })
})

test.describe('the goal page', () => {
  test('shows progress, the calm projection, the term bar and the courses as a table', async ({
    page,
  }) => {
    await gotoApp(page, GOAL, 'wgu')
    await expect(pageTitle(page)).toHaveValue('B.S. Computer Science — WGU')
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Goals')
    await expect(page.getByRole('heading', { name: '18% of hours done' })).toBeVisible()
    await expect(page.getByRole('progressbar', { name: /hours done/ })).toHaveAttribute(
      'aria-valuenow',
      '18',
    )
    await expect(page.getByText(/^Projected .+ · 9 days before target$/)).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'CUs completed this term' })).toBeVisible()
    await expect(page.getByText('4 of 18 CUs')).toBeVisible()
    await expect(table(page).getByRole('row')).toHaveCount(6)
    const done = table(page).getByRole('row').filter({ hasText: 'C182' })
    await expect(done.getByText('Done Sep 20')).toBeVisible()
    await expect(done.getByText('30 / 30 h')).toBeVisible()
    const active = table(page).getByRole('row').filter({ hasText: 'C779' })
    await expect(active.getByText('4.5 / 30 h')).toBeVisible()
    await expect(active.getByText('Oct 15')).toBeVisible()
    // The goal.header, goal.panels slots are rendered (the import panel lives in goal.panels).
    await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible()
  })

  test('edits code and CUs in place, and refuses a bad value', async ({ page }) => {
    await gotoApp(page, GOAL, 'wgu')
    const row = table(page).getByRole('row').filter({ hasText: 'C172' })
    await row.getByRole('button', { name: /^Code of Network and Security Foundations/ }).click()
    await page.getByRole('textbox', { name: /^Code of Network/ }).fill('C172X')
    await page.keyboard.press('Enter')
    await expect(row.getByText('C172X')).toBeVisible()

    await row.getByRole('button', { name: /^Competency units of/ }).click()
    await page.getByRole('textbox', { name: /^Competency units of/ }).fill('9')
    await page.keyboard.press('Enter')
    await expect(row.getByRole('cell').filter({ hasText: /^9$/ })).toBeVisible()

    // A bad value is refused and the old one stays.
    await row.getByRole('button', { name: /^Competency units of/ }).click()
    await page.getByRole('textbox', { name: /^Competency units of/ }).fill('lots')
    await page.keyboard.press('Enter')
    await expect(row.getByRole('cell').filter({ hasText: /^9$/ })).toBeVisible()

    const courses = await readTable<StoredCourse>(page, 'milestones')
    const c172 = courses.find((c) => c.id === 'course-c172')
    expect(c172).toMatchObject({ code: 'C172X', cus: 9 })
  })

  test('marks a course complete from its menu, with Undo, and the plan pulls forward', async ({
    page,
  }) => {
    await gotoApp(page, GOAL, 'wgu')
    await page.getByRole('button', { name: `Actions for ${C779_NAME}` }).click()
    await page.getByRole('menuitem', { name: 'Mark complete' }).click()
    await expect(toasts(page).getByText(`Marked ${C779_NAME} complete`)).toBeVisible()
    const row = table(page).getByRole('row').filter({ hasText: 'C779' })
    await expect(row.getByRole('button', { name: /^Status of .*Done/ })).toBeVisible()
    let tasks = await readTable<StoredTask>(page, 'tasks')
    expect(
      tasks.filter(
        (t) => t.source === 'schedule' && t.milestoneId === 'course-c779' && t.status !== 'done',
      ),
    ).toHaveLength(0)

    await undo(page).click()
    await expect(row.getByRole('button', { name: /^Status of .*In progress/ })).toBeVisible()
    tasks = await readTable<StoredTask>(page, 'tasks')
    expect(
      tasks.filter(
        (t) => t.source === 'schedule' && t.milestoneId === 'course-c779' && t.status !== 'done',
      ).length,
    ).toBeGreaterThan(0)
  })

  test('reorders courses from the keyboard and the order is saved', async ({ page }) => {
    await gotoApp(page, GOAL, 'wgu')
    const handle = page.getByRole('button', { name: 'Reorder C182 Introduction to IT' })
    await handle.focus()
    await page.keyboard.press('Space')
    // The live region says where the picked-up row is; it replaces "Picked up" at once.
    await expect(
      page.getByText('C182 Introduction to IT is over C182 Introduction to IT.'),
    ).toBeAttached()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByText(/^C182 Introduction to IT is over C779/)).toBeAttached()
    await page.keyboard.press('Space')
    await expect
      .poll(async () => {
        const courses = await readTable<StoredCourse>(page, 'milestones')
        return courses.sort((a, b) => a.order - b.order).map((c) => c.code)
      })
      .toEqual(['C779', 'C182', 'D278', 'C172', 'C959'])
    await expect(table(page).getByRole('row').nth(1)).toContainText('C779')
  })

  test('adds a course with c, and moves one to the trash with Undo', async ({ page }) => {
    await gotoApp(page, GOAL, 'wgu')
    await expect(table(page)).toBeVisible()
    await page.keyboard.press('c')
    const form = page.getByRole('form', { name: 'New course' })
    await form.getByRole('textbox', { name: 'Course code' }).fill('D335')
    await form
      .getByRole('textbox', { name: 'Course name' })
      .fill('Introduction to Programming in Python')
    await form.getByRole('button', { name: 'Add course' }).click()
    await expect(form.getByText('Estimated hours, from 0.5 to 2000.')).toBeVisible()
    await form.getByRole('textbox', { name: 'Estimated hours' }).fill('35')
    await form.getByRole('button', { name: 'Add course' }).click()
    await expect(table(page).getByRole('row')).toHaveCount(7)
    await page.keyboard.press('Escape')
    await expect(form).toBeHidden()

    // A course without unit estimates is planned from its hours, and the cell edits them.
    const added = table(page).getByRole('row').filter({ hasText: 'D335' })
    await expect(added.getByText('0 / 35 h')).toBeVisible()
    await added.getByRole('button', { name: /^Estimated hours of/ }).click()
    await page.getByRole('textbox', { name: /^Estimated hours of/ }).fill('50')
    await page.keyboard.press('Enter')
    await expect(added.getByText('0 / 50 h')).toBeVisible()

    await page.getByRole('button', { name: /^Actions for D335/ }).click()
    await page.getByRole('menuitem', { name: 'Move to trash' }).click()
    await expect(table(page).getByRole('row')).toHaveCount(6)
    await undo(page).click()
    await expect(table(page).getByRole('row')).toHaveCount(7)
  })

  test('edits the schedule settings and re-plans', async ({ page }) => {
    await gotoApp(page, GOAL, 'wgu')
    await page.getByRole('button', { name: 'Schedule' }).click()
    const dialog = page.getByRole('dialog', { name: 'Schedule settings' })
    await expect(dialog.getByText('7 study days · 10 h a week')).toBeVisible()
    await dialog.getByRole('switch', { name: 'Sunday' }).click()
    await expect(dialog.getByText('6 study days · 9 h a week')).toBeVisible()
    await dialog.getByRole('button', { name: 'Add days off' }).click()
    await dialog.getByRole('button', { name: 'Save and re-plan' }).click()
    await expect(
      dialog.getByText('Pick a start and an end date, or remove this range.'),
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Remove days off 1' }).click()
    await dialog.getByRole('button', { name: 'Save and re-plan' }).click()
    await expect(dialog).toBeHidden()
  })

  test('moves the goal to the trash with Undo', async ({ page }) => {
    await gotoApp(page, GOAL, 'wgu')
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Move to trash' }).click()
    await expect(page).toHaveURL(/\/goals$/)
    await expect(page.getByRole('heading', { name: 'No goals yet' })).toBeVisible()
    await undo(page).click()
    await expect(
      page.getByRole('link', { name: 'B.S. Computer Science — WGU' }).first(),
    ).toBeVisible()
  })
})

test.describe('the course page', () => {
  test('shows the breadcrumbs, the facts, the units and the scheduled tasks', async ({ page }) => {
    await gotoApp(page, C779, 'wgu')
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(crumbs).toContainText('Goals')
    await expect(crumbs).toContainText('B.S. Computer Science — WGU')
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText(C779_NAME)
    await expect(pageTitle(page)).toHaveValue('Web Development Foundations')
    await expect(page.getByRole('heading', { name: /^Units/ })).toContainText('1 of 8')
    await expect(page.getByRole('checkbox', { name: 'HTML structure, done' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'CSS layout, done' })).not.toBeChecked()
    // The scheduled tasks are the same rows as on Today, and work the same.
    await expect(page.getByText('C779 · Unit 3: CSS layout (45 min)').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Show \d+ completed tasks?/ })).toBeVisible()
    // Crumb links go up the tree.
    await crumbs.getByRole('link', { name: /B.S. Computer Science/ }).click()
    await expect(page).toHaveURL(/\/goals\/goal-wgu-bscs$/)
  })

  test('adds a unit with n, checks one off, and completes the course with shift+d', async ({
    page,
  }) => {
    await gotoApp(page, C779, 'wgu')
    await expect(page.getByRole('heading', { name: /^Units/ })).toBeVisible()
    await page.keyboard.press('n')
    await expect(page.getByRole('textbox', { name: 'Add a unit' })).toBeFocused()
    await page.keyboard.type('Practice assessment review')
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('checkbox', { name: 'Practice assessment review, done' }),
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Add a unit' })).toBeFocused()

    await page.getByRole('checkbox', { name: 'CSS box model and selectors, done' }).click()
    await expect(
      page.getByRole('checkbox', { name: 'CSS box model and selectors, done' }),
    ).toBeChecked()
    await expect(page.getByRole('heading', { name: /^Units/ })).toContainText('2 of 9')

    await page.getByRole('main').click({ position: { x: 4, y: 4 } })
    await page.keyboard.press('Shift+D')
    await expect(toasts(page).getByText(`Marked ${C779_NAME} complete`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark not complete' })).toBeVisible()
    await expect(
      page.getByText('This course is marked complete, so its remaining units are not scheduled.'),
    ).toBeVisible()
    await undo(page).click()
    await expect(page.getByRole('button', { name: 'Mark course complete' })).toBeVisible()
  })

  test('renames a unit in place and sets an estimate', async ({ page }) => {
    await gotoApp(page, C779, 'wgu')
    await page.getByRole('button', { name: /^Unit title: CSS layout/ }).click()
    await page.getByRole('textbox', { name: 'Unit title' }).fill('CSS grid and flexbox')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('checkbox', { name: 'CSS grid and flexbox, done' })).toBeVisible()
    await page.getByRole('button', { name: /^Minutes for CSS grid and flexbox/ }).click()
    await page.getByRole('textbox', { name: /^Minutes for CSS grid/ }).fill('300')
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('button', { name: /^Minutes for CSS grid and flexbox: 300/ }),
    ).toBeVisible()
  })
})

test.describe('palette', () => {
  test('finds goals and courses by title and by code', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('c172')
    await page.getByRole('option', { name: /C172 Network and Security Foundations/ }).click()
    await expect(page).toHaveURL(/\/goals\/goal-wgu-bscs\/courses\/course-c172$/)

    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('computer science')
    await page
      .getByRole('option', { name: /B.S. Computer Science — WGU/ })
      .first()
      .click()
    await expect(page).toHaveURL(/\/goals\/goal-wgu-bscs$/)
  })

  test('has course commands only on a course page', async ({ page }) => {
    await gotoApp(page, GOAL, 'wgu')
    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('add a')
    await expect(page.getByRole('option', { name: /Add a course/ })).toBeVisible()
    await expect(page.getByRole('option', { name: /Add a unit/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await gotoApp(page, C779)
    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('mark course')
    await page.getByRole('option', { name: /Mark course complete/ }).click()
    await expect(toasts(page).getByText(`Marked ${C779_NAME} complete`)).toBeVisible()
  })
})

test.describe('phone layout', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('courses become cards and nothing scrolls sideways', async ({ page }) => {
    for (const path of ['/goals', GOAL, C779, '/goals/new']) {
      await gotoApp(page, path, 'wgu')
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0)
    }
    await gotoApp(page, GOAL)
    const row = table(page).getByRole('row').filter({ hasText: 'C779' })
    await expect(row.getByRole('link', { name: 'Web Development Foundations' })).toBeVisible()
    await expect(row.getByText('Oct 15')).toBeVisible()
    const box = await row.boundingBox()
    expect(box?.width ?? 0).toBeLessThanOrEqual(375)
  })
})
