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

// Goals (Phase 5B). The sample goal comes from `?seed=wgu` (dated around the fixed clock, Tue 2026-09-29).
const list: ShotList = {
  feature: 'goals',
  shots: [
    { name: 'list', path: '/goals?seed=wgu', waitFor: 'main h1', prepare: settle },
    { name: 'list-empty', path: '/goals?seed=empty', waitFor: 'main h1', prepare: settle },
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
