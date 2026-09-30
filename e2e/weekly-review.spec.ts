import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'
import { readTable } from './idb'
import { PREVIOUS_WEEK, REVIEW_WEEK, openSeededReview, seedReviewWeek } from './reviewWeek'

/**
 * Phase 7C: the weekly review, on the seeded week of `reviewWeek.ts` (Mon Sep 21 – Sun Sep 27, 2026,
 * reviewed on the Sunday evening). Wins, numbers, hours per goal and next week come from that week's
 * rows; the note autosaves; "Mark review done" pays 10 XP once.
 */

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const note = (page: Page) => page.getByRole('textbox', { name: 'What got in the way?' })
const noteStatus = (page: Page) => page.getByTestId('review-note-status')
const range = (page: Page) => page.getByTestId('review-range')
const prompt = (page: Page) => page.getByTestId('weekly-review-prompt')

interface ReviewRow {
  id: string
  weekStart: string
  wins: string
  blockers: string
  completedAt: number | null
}
interface XpRow {
  key: string
  amount: number
  source: string
}

const reviewRows = (page: Page) => readTable<ReviewRow>(page, 'weeklyReviews')
const reviewXp = async (page: Page, week = REVIEW_WEEK): Promise<XpRow[]> =>
  (await readTable<XpRow>(page, 'xpEvents')).filter((e) => e.key === `review:${week}`)

test.describe('Weekly review: the page', () => {
  test('shows the week’s wins, numbers, hours per goal and next week', async ({ page }) => {
    await seedReviewWeek(page)
    await openSeededReview(page)

    await expect(range(page)).toHaveText('Sep 21 – 27, 2026')
    await expect(page.getByText('This week ends today')).toBeVisible()

    const wins = page.locator('[data-section="wins"] li')
    await expect(wins).toHaveText([
      '4 tasks done',
      '4 h 35 min of focus',
      'On a 5-day streak',
      'You showed up on 5 days',
      'Longest session: 1 h 40 min',
      'Best day: Saturday, 1 h 40 min',
    ])

    const numbers = page.locator('[data-section="numbers"]')
    await expect(numbers).toContainText('Focus time')
    await expect(numbers).toContainText('4 h 35 min')
    await expect(numbers).toContainText('Tasks done')
    await expect(numbers).toContainText('Showed up')
    // The freeze is a neutral count, with its snowflake.
    await expect(numbers).toContainText('Freezes used')
    await expect(numbers).toContainText('❄️ 1')
    await expect(numbers).toContainText('5 days')

    const goals = page.locator('[data-section="goals"]')
    await expect(goals).toContainText('Hours per goal')
    await expect(goals).toContainText('B.S. Computer Science')
    await expect(goals).toContainText('3 h 45 min')
    await expect(goals).toContainText('Other')
    await expect(goals).toContainText('50 min')

    // Next week: minutes and items per day, "Free" for a clear day, "Flexible" for an item with no length.
    await expect(page.getByTestId('review-next-2026-09-28')).toContainText('1 h 15 min')
    await expect(page.getByTestId('review-next-2026-09-28')).toContainText('2 items')
    await expect(page.getByTestId('review-next-2026-09-29')).toContainText('Free')
    await expect(page.getByTestId('review-next-2026-09-30')).toContainText('1 h 30 min')
    await expect(page.getByTestId('review-next-2026-09-30')).toContainText('1 item')
    await expect(page.getByTestId('review-next-2026-10-02')).toContainText('Flexible')
    await expect(page.locator('[data-section="next-week"]')).toContainText(
      'Sep 28 – Oct 4, 2026 · 4 items, 2 h 45 min',
    )

    // Nothing in it scolds.
    await expect(page.locator('main')).not.toContainText(
      /less than|fewer|behind|missed|lost|broke|failed/i,
    )

    // The Week view link opens the calendar on next week.
    const link = page.getByTestId('review-week-view-link')
    await expect(link).toHaveAttribute('href', /^\/tasks\/all\?layout=calendar&date=2026-09-28$/)
    await link.click()
    await expect(page).toHaveURL(/\/tasks\/all\?layout=calendar&date=2026-09-28$/)
  })

  test('the week picker steps back and forward, and the address holds the week', async ({
    page,
  }) => {
    await seedReviewWeek(page)
    await openSeededReview(page)
    await expect(page.getByRole('button', { name: 'Next week' })).toBeDisabled()

    await page.getByRole('button', { name: 'Previous week' }).click()
    await expect(page).toHaveURL(new RegExp(`/review/${PREVIOUS_WEEK}$`))
    await expect(range(page)).toHaveText('Sep 14 – 20, 2026')
    // Last week held one session and one task.
    await expect(page.locator('[data-section="wins"] li')).toContainText([
      '1 task done',
      '25 min of focus',
    ])
    await expect(page.getByRole('button', { name: 'Next week' })).toBeEnabled()

    // Keys: ] forward (to this week, whose address is /review), [ back.
    await page.keyboard.press(']')
    await expect(page).toHaveURL(/\/review$/)
    await expect(range(page)).toHaveText('Sep 21 – 27, 2026')
    await page.keyboard.press('[')
    await expect(page).toHaveURL(new RegExp(`/review/${PREVIOUS_WEEK}$`))

    // Any day of a week opens that week, and "This week" comes back.
    await openSeededReview(page, '/review/2026-09-16')
    await expect(range(page)).toHaveText('Sep 14 – 20, 2026')
    await page.getByRole('button', { name: 'This week' }).click()
    await expect(range(page)).toHaveText('Sep 21 – 27, 2026')
    // A week that has not started is this week; so is nonsense.
    await openSeededReview(page, '/review/2026-12-01')
    await expect(range(page)).toHaveText('Sep 21 – 27, 2026')
    await openSeededReview(page, '/review/soon')
    await expect(range(page)).toHaveText('Sep 21 – 27, 2026')
  })

  test('a week with nothing logged is a quiet state, and the note is still there', async ({
    page,
  }) => {
    await seedReviewWeek(page)
    await openSeededReview(page, '/review/2026-08-31')
    await expect(page.getByRole('heading', { name: 'A quiet week' })).toBeVisible()
    await expect(page.locator('[data-section="wins"]')).toHaveCount(0)
    await expect(page.getByText(/no focus sessions or finished tasks/i)).toBeVisible()
    await expect(note(page)).toBeVisible()
    await expect(page.locator('[data-section="next-week"]')).toBeVisible()
    await expect(page.locator('main')).not.toContainText(/lost|broke|failed|missed/i)
  })
})

test.describe('Weekly review: the note and finishing', () => {
  test('“What got in the way?” autosaves and is kept after a reload', async ({ page }) => {
    await seedReviewWeek(page)
    await openSeededReview(page)
    await expect(note(page)).toHaveValue('')

    const words = 'The D278 practice test ran long, and Wednesday was a travel day.'
    await note(page).fill(words)
    await expect(noteStatus(page)).toHaveText('Saved')
    expect((await reviewRows(page)).find((r) => r.id === REVIEW_WEEK)?.blockers).toBe(words)

    await page.reload()
    await expect(note(page)).toHaveValue(words)
    // It belongs to its week: last week's box is empty.
    await page.getByRole('button', { name: 'Previous week' }).click()
    await expect(range(page)).toHaveText('Sep 14 – 20, 2026')
    await expect(note(page)).toHaveValue('')

    // Writing does not finish the review or pay anything.
    expect((await reviewRows(page)).find((r) => r.id === REVIEW_WEEK)?.completedAt).toBeNull()
    expect(await reviewXp(page)).toHaveLength(0)
  })

  test('“Mark review done” pays 10 XP once and stays done', async ({ page }) => {
    await seedReviewWeek(page)
    await openSeededReview(page)
    await note(page).fill('Slow Tuesday.')
    await expect(noteStatus(page)).toHaveText('Saved')

    await page.getByRole('button', { name: 'Mark review done' }).click()
    await expect(toasts(page)).toContainText('Weekly review done · +10 XP')
    await expect(page.getByTestId('review-done')).toContainText('Review done · Sun, Sep 27')
    await expect(page.getByRole('button', { name: 'Mark review done' })).toHaveCount(0)

    const xp = await reviewXp(page)
    expect(xp).toHaveLength(1)
    expect(xp[0]).toMatchObject({ amount: 10, source: 'ritual' })
    const row = (await reviewRows(page)).find((r) => r.id === REVIEW_WEEK)
    expect(row?.completedAt).not.toBeNull()
    expect(row?.blockers).toBe('Slow Tuesday.')
    expect(row?.wins).toContain('4 tasks done')

    // A reload, and writing more afterwards, change nothing about it.
    await page.reload()
    await expect(page.getByTestId('review-done')).toBeVisible()
    await note(page).fill('Slow Tuesday, and a long Thursday.')
    await expect(noteStatus(page)).toHaveText('Saved')
    expect(await reviewXp(page)).toHaveLength(1)
    expect((await reviewRows(page)).find((r) => r.id === REVIEW_WEEK)?.completedAt).toBe(
      row?.completedAt,
    )
  })

  test('shift+D marks it done from the keyboard, and the palette has the command', async ({
    page,
  }) => {
    await seedReviewWeek(page)
    await openSeededReview(page)
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('mark weekly')
    await expect(page.getByRole('option', { name: /Mark weekly review done/ })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.locator('main').click({ position: { x: 4, y: 4 } })
    await page.keyboard.press('Shift+D')
    await expect(page.getByTestId('review-done')).toBeVisible()
    expect(await reviewXp(page)).toHaveLength(1)
  })
})

test.describe('Weekly review: the Sunday prompt and the ways in', () => {
  test('on the review day Today offers it, until it is done', async ({ page }) => {
    await seedReviewWeek(page)
    await page.goto('/')
    const card = prompt(page)
    await expect(card).toBeVisible()
    await expect(card).toContainText('Weekly review')
    await card.getByRole('link', { name: 'Your week in review is ready' }).click()
    await expect(page).toHaveURL(/\/review$/)
    await expect(page.getByRole('heading', { name: 'Weekly review', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Mark review done' }).click()
    await expect(page.getByTestId('review-done')).toBeVisible()
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible()
    await expect(prompt(page)).toHaveCount(0)
  })

  test('on any other day there is no prompt', async ({ page }) => {
    await gotoApp(page, '/', 'wgu') // Tuesday, by the fixture's clock
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible()
    await expect(page.getByText('Upcoming target')).toBeVisible()
    await expect(prompt(page)).toHaveCount(0)
  })

  test('the palette has "Weekly review", and g v goes there', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('weekly review')
    await page.getByRole('option', { name: /^Weekly review/ }).first().click()
    await expect(page).toHaveURL(/\/review$/)
    await expect(page.getByRole('heading', { name: 'Weekly review', level: 1 })).toBeVisible()

    await page.goto('/focus')
    await page.locator('#root > *').first().waitFor()
    await page.keyboard.press('g')
    await page.keyboard.press('v')
    await expect(page).toHaveURL(/\/review$/)
    // The other g-sequences are untouched: g w is still My World.
    await page.keyboard.press('g')
    await page.keyboard.press('w')
    await expect(page).toHaveURL(/\/world$/)
  })
})

test.describe('Weekly review: a phone (375 px)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('reads as one column with no sideways scroll, and next week as a list', async ({ page }) => {
    await seedReviewWeek(page)
    await openSeededReview(page)
    await expect(page.getByTestId('review-next-2026-09-28')).toContainText('2 items')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(page.getByRole('button', { name: 'Mark review done' })).toBeVisible()
  })
})
