import type { Page } from '@playwright/test'
import { withHistory } from '../../e2e/progressHistory'
import type { ShotList } from '../shot-types'

/** Progress (Phase 7B): the page with a year of history, a chart tooltip, courses, and the empty state. */
const list: ShotList = {
  feature: 'progress',
  shots: [
    {
      name: 'page',
      path: '/progress?seed=wgu',
      waitFor: 'h1',
      prepare: (page) => withHistory(page),
      fullPage: true,
    },
    {
      name: 'tooltip',
      path: '/progress?seed=wgu',
      waitFor: 'h1',
      prepare: async (page) => {
        await withHistory(page)
        await page.getByRole('img', { name: 'Focus, past year' }).focus()
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowLeft')
        await page.getByTestId('chart-tooltip').waitFor()
      },
    },
    {
      name: 'courses',
      path: '/progress?seed=wgu',
      waitFor: 'h1',
      prepare: async (page) => {
        await withHistory(page, '/progress?by=course')
        await page.getByRole('heading', { name: 'Time per course' }).scrollIntoViewIfNeeded()
        await page.getByRole('img', { name: 'Time per course' }).focus()
        await page.keyboard.press('ArrowDown')
        await page.getByTestId('chart-tooltip').waitFor()
      },
    },
    { name: 'empty', path: '/progress?seed=empty', waitFor: 'h1' },
    // The chart specimens on /design, scrolled through in three screens.
    ...[0, 1, 2].map((n) => ({
      name: `design-charts-${n + 1}`,
      path: '/design#charts',
      waitFor: '#charts',
      prepare: async (page: Page) => {
        await page.locator('#charts').scrollIntoViewIfNeeded()
        await page.evaluate((offset) => {
          const el = document.getElementById('charts')
          if (el) window.scrollBy(0, el.getBoundingClientRect().top - 80 + offset * 820)
        }, n)
        await page.waitForTimeout(400)
      },
    })),
  ],
}

export default list
