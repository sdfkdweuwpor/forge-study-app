import type { Page } from '@playwright/test'
import type { ShotList } from '../shot-types'

/** Waits for finite animations and transitions to end so the capture is the settled state. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  )
}

const ROWS = 'main ul li'
const BOARD_CARDS = '[data-column="todo"] li'
const CALENDAR_EVENTS = 'section[aria-label="Calendar"] [aria-label$="scheduled"] li'

// Tasks (Phase 3A). Sample data comes from `?seed=wgu` (dated around the fixed clock, Tue 2026-09-29).
const list: ShotList = {
  feature: 'tasks',
  shots: [
    { name: 'inbox', path: '/tasks/inbox?seed=wgu', waitFor: ROWS },
    { name: 'all-by-date', path: '/tasks/all?seed=wgu', waitFor: ROWS, fullPage: true },
    { name: 'all-by-project', path: '/tasks/all?seed=wgu&group=project', waitFor: ROWS },
    { name: 'upcoming', path: '/tasks/upcoming?seed=wgu', waitFor: ROWS },
    // The side peek on a wide screen; below 640 px it opens as the task page instead.
    {
      name: 'peek',
      path: '/tasks/inbox?seed=wgu&peek=task-email-mentor',
      waitFor: '[aria-label="Task details"], main h1',
      prepare: settle,
    },
    {
      name: 'task-page',
      path: '/task/task-c779-u3-2?seed=wgu',
      waitFor: 'main h1',
      prepare: settle,
    },
    { name: 'completed', path: '/tasks/completed?seed=wgu', waitFor: ROWS, fullPage: true },
    {
      name: 'filters',
      path: '/tasks/all?seed=wgu&priority=3,4',
      waitFor: ROWS,
    },
    {
      name: 'row-menu',
      path: '/tasks/inbox?seed=wgu',
      waitFor: ROWS,
      prepare: async (page) => {
        await page.locator(ROWS).first().hover()
        await page.getByRole('button', { name: 'More actions' }).first().click()
        await page.getByRole('menu').waitFor()
        await settle(page)
      },
    },
    {
      name: 'filter-popover',
      path: '/tasks/all?seed=wgu',
      waitFor: ROWS,
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Priority', exact: true }).click()
        await page.getByRole('group', { name: 'Priority' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'due-picker',
      path: '/tasks/inbox?seed=wgu',
      waitFor: ROWS,
      prepare: async (page) => {
        await page.locator(ROWS).first().hover()
        await page.getByRole('button', { name: 'More actions' }).first().click()
        await page.getByRole('menuitem', { name: 'Due date…' }).click()
        await page.getByRole('dialog', { name: 'Due date' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'custom-repeat',
      path: '/task/task-weekly-review-next?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Every Sunday/ }).click()
        await page.getByRole('menuitem', { name: 'Custom…' }).click()
        await page.getByRole('dialog', { name: 'Custom repeat' }).waitFor()
        await settle(page)
      },
    },
    { name: 'empty-inbox', path: '/tasks/inbox?seed=empty', waitFor: 'main h1', prepare: settle },

    // Board, calendar and saved views (Phase 3D).
    { name: 'board', path: '/tasks/all?seed=wgu&layout=board', waitFor: BOARD_CARDS, prepare: settle },
    {
      // A card picked up with the keyboard and moved into Doing: the target column lights up.
      name: 'board-picked-up',
      path: '/tasks/all?seed=wgu&layout=board',
      waitFor: BOARD_CARDS,
      prepare: async (page) => {
        await page.locator('[data-column="todo"] li').first().getByRole('button', { name: /^Move / }).focus()
        await page.keyboard.press('Space')
        // The sensor starts listening for arrow keys a tick after Space.
        await page.waitForTimeout(200)
        await page.keyboard.press('ArrowRight')
        await page.waitForTimeout(300)
        await settle(page)
      },
    },
    {
      name: 'board-filtered',
      path: '/tasks/all?seed=wgu&layout=board&priority=3,4&sort=priority',
      waitFor: BOARD_CARDS,
      prepare: settle,
    },
    {
      name: 'board-empty',
      path: '/tasks/inbox?seed=empty&layout=board',
      waitFor: 'main h1',
      prepare: settle,
    },
    {
      name: 'calendar',
      path: '/tasks/all?seed=wgu&layout=calendar',
      waitFor: CALENDAR_EVENTS,
      prepare: settle,
    },
    {
      // Scrolled to the afternoon, where the time grid has most of the day's blocks.
      name: 'calendar-afternoon',
      path: '/tasks/all?seed=wgu&layout=calendar',
      waitFor: CALENDAR_EVENTS,
      prepare: async (page) => {
        await page.evaluate(() => window.scrollTo(0, 420))
        await settle(page)
      },
    },
    {
      name: 'calendar-empty',
      path: '/tasks/inbox?seed=empty&layout=calendar',
      waitFor: 'main h1',
      prepare: settle,
    },
    {
      name: 'save-view-popover',
      path: '/tasks/all?seed=wgu&priority=3,4',
      waitFor: ROWS,
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Save view' }).click()
        await page.getByRole('dialog', { name: 'Save view' }).waitFor()
        await settle(page)
      },
    },
    {
      // A saved view in the sidebar (wide screens) and as a page, edited but not yet updated.
      name: 'saved-view',
      path: '/tasks/all?seed=wgu&priority=3,4',
      waitFor: ROWS,
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Save view' }).click()
        await page.getByLabel('Name').fill('Urgent this term')
        await page.getByRole('button', { name: 'Fire' }).click()
        await page.getByRole('button', { name: 'Save view' }).last().click()
        await page.waitForURL(/\/tasks\/views\//)
        await page.getByRole('radio', { name: 'Board' }).click()
        await page.getByRole('button', { name: 'Update view' }).waitFor()
        await settle(page)
      },
    },
  ],
}

export default list
