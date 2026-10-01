import type { Page } from '@playwright/test'
import { expect } from '../../e2e/fixtures'
import { openSeededReview, seedReviewWeek } from '../../e2e/reviewWeek'
import type { ShotList } from '../shot-types'

const NOTE = 'The D278 practice test ran long, and Wednesday was a travel day.'

/** The seeded week (see e2e/reviewWeek.ts), opened on its Sunday, with the note written and saved. */
async function withWrittenReview(page: Page): Promise<void> {
  await seedReviewWeek(page)
  await openSeededReview(page)
  await page.getByRole('textbox', { name: 'What got in the way?' }).fill(NOTE)
  await expect(page.getByTestId('review-note-status')).toHaveText('Saved')
  // At rest, from the top: typing scrolled the page, and a full-page capture of a scrolled page draws
  // the fixed parts (the skip link, the phone tab bar) part-way down.
  await page.getByRole('textbox', { name: 'What got in the way?' }).blur()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
}

/** The weekly review (Phase 7C): the page, the finished state, a week with nothing in it, and the Sunday card on Today. */
const list: ShotList = {
  feature: 'review',
  shots: [
    { name: 'page', path: '/?seed=wgu', waitFor: 'h1', prepare: withWrittenReview, fullPage: true },
    {
      name: 'done',
      path: '/?seed=wgu',
      waitFor: 'h1',
      prepare: async (page) => {
        await withWrittenReview(page)
        await page.getByRole('button', { name: 'Mark review done' }).click()
        await page.getByTestId('review-done').waitFor()
        await page.getByTestId('review-done').scrollIntoViewIfNeeded()
        // The gold toast rises after a beat; let it settle so the frame shows it.
        await page.getByRole('region', { name: 'Notifications' }).getByText('+10 XP').waitFor()
        await page.mouse.move(0, 0)
      },
    },
    {
      name: 'quiet',
      path: '/?seed=wgu',
      waitFor: 'h1',
      prepare: async (page) => {
        await seedReviewWeek(page)
        await openSeededReview(page, '/review/2026-08-31')
        await expect(page.getByRole('heading', { name: 'A quiet week' })).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
      },
      fullPage: true,
    },
    {
      name: 'today-prompt',
      path: '/?seed=wgu',
      waitFor: '#now-title',
      prepare: async (page) => {
        await seedReviewWeek(page)
        await page.goto('/')
        await page.getByTestId('weekly-review-prompt').waitFor()
        await page.getByTestId('weekly-review-prompt').scrollIntoViewIfNeeded()
        await page.evaluate(() => document.fonts.ready)
        await page.mouse.move(0, 0)
      },
    },
  ],
}

export default list
