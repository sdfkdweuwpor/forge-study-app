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

const GOAL = '/goals/goal-wgu-bscs'
const COURSE = `${GOAL}/courses/course-c779`

// The dialog's own title. (`[role="dialog"]` would also match the phone "More" sheet, which is always in the DOM.)
const WIZARD = 'h2:text-is("New goal")'

/** The wizard on an empty app: loads the WGU template, which lands on the courses step. */
async function loadTemplate(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'New goal' }).waitFor()
  await page.getByRole('button', { name: 'Load the B.S. Computer Science template' }).click()
  await page.getByLabel('Name of course 1').waitFor()
}

// Goals (Phase 5B). The sample goal comes from `?seed=wgu` (dated around the fixed clock, Tue 2026-09-29).
const list: ShotList = {
  feature: 'goals',
  shots: [
    { name: 'list', path: '/goals?seed=wgu', waitFor: 'main h1', prepare: settle },
    { name: 'list-empty', path: '/goals?seed=empty', waitFor: 'main h1', prepare: settle },
    { name: 'wizard-1-basics', path: '/goals/new?seed=empty', waitFor: WIZARD, prepare: settle },
    {
      name: 'wizard-2-courses',
      path: '/goals/new?seed=empty',
      waitFor: WIZARD,
      prepare: async (page) => {
        await loadTemplate(page)
        await settle(page)
      },
    },
    {
      name: 'wizard-3-availability',
      path: '/goals/new?seed=empty',
      waitFor: WIZARD,
      prepare: async (page) => {
        await loadTemplate(page)
        await page.getByRole('button', { name: 'Next' }).click()
        await page.getByRole('heading', { name: 'Study days' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'wizard-4-preview',
      path: '/goals/new?seed=empty',
      waitFor: WIZARD,
      prepare: async (page) => {
        await loadTemplate(page)
        await page.getByRole('button', { name: 'Next' }).click()
        await page.getByRole('button', { name: 'Next' }).click()
        await page.getByText('At this pace you’d finish').waitFor()
        await settle(page)
      },
    },
    { name: 'goal', path: `${GOAL}?seed=wgu`, waitFor: 'main h1', fullPage: true, prepare: settle },
    {
      name: 'goal-row-menu',
      path: `${GOAL}?seed=wgu`,
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.getByRole('table', { name: 'Courses' }).waitFor()
        await page.getByRole('button', { name: /^Actions for C779/ }).click()
        await page.getByRole('menu').waitFor()
        await settle(page)
      },
    },
    {
      name: 'course',
      path: `${COURSE}?seed=wgu`,
      waitFor: 'main h1',
      fullPage: true,
      prepare: settle,
    },
    {
      name: 'schedule-settings',
      path: `${GOAL}?seed=wgu`,
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Schedule' }).click()
        await page.getByRole('dialog', { name: 'Schedule settings' }).waitFor()
        await settle(page)
      },
    },
    { name: 'missing', path: '/goals/nope?seed=wgu', waitFor: 'main h1', prepare: settle },
  ],
}

export default list
