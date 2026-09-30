import type { Page } from '@playwright/test'
import { putRows } from '../../e2e/idb'
import type { ShotList } from '../shot-types'

/**
 * Phase 11g: the daily rituals. Today's prompt and the pinned Top 3, the three steps of the morning plan
 * and of the evening shutdown, the routine picker and the save dialog, and the Settings and Progress
 * sections. The clock is frozen at Tue 2026-09-29 09:30; the evening shots move it to 18:30 and reload
 * (without `?seed`, so the seeded rows stay).
 */

const EVENING = new Date('2026-09-29T18:30:00-04:00')

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

/** Every live query has answered and finite animations have settled. */
async function loaded(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(0, 0)
  await settle(page)
}

/** Toasts would sit over the picture; put them away. */
async function clearToasts(page: Page): Promise<void> {
  const dismiss = page.getByRole('region', { name: 'Notifications' }).getByRole('button', {
    name: 'Dismiss',
  })
  while ((await dismiss.count()) > 0) {
    await dismiss.first().click()
    await page.waitForTimeout(350)
  }
}

async function goEvening(page: Page): Promise<void> {
  await page.clock.setFixedTime(EVENING)
  await page.goto('/')
  await page.locator('[data-testid="ritual-prompt"]').waitFor()
  await loaded(page)
}

const morning = (page: Page) => page.getByRole('dialog', { name: 'Morning plan' })
const evening = (page: Page) => page.getByRole('dialog', { name: 'Evening shutdown' })

async function openMorning(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start morning plan' }).click()
  await morning(page).waitFor()
  await loaded(page)
}

async function pickThree(page: Page): Promise<void> {
  const boxes = morning(page).getByRole('list', { name: 'Today’s tasks' }).getByRole('checkbox')
  await boxes.nth(0).check()
  await boxes.nth(1).check()
  await boxes.nth(2).check()
  await settle(page)
}

async function finishMorning(page: Page): Promise<void> {
  await openMorning(page)
  await pickThree(page)
  await morning(page).getByRole('button', { name: 'Next' }).click()
  await morning(page).getByRole('button', { name: 'Next' }).click()
  await morning(page).getByRole('button', { name: 'Done' }).click()
  await morning(page).waitFor({ state: 'hidden' })
  await clearToasts(page)
  await loaded(page)
}

async function openEvening(page: Page): Promise<void> {
  // One finished task, so "Done today" has something in it.
  await page
    .getByRole('checkbox', { name: 'Done: Email mentor about term plan' })
    .first()
    .check()
  await page.waitForTimeout(1600)
  await clearToasts(page)
  await page.getByRole('button', { name: 'Start evening shutdown' }).click()
  await evening(page).waitFor()
  await loaded(page)
}

const next = async (page: Page, dialog: ReturnType<typeof evening>): Promise<void> => {
  await dialog.getByRole('button', { name: 'Next' }).click()
  await settle(page)
}

const list: ShotList = {
  feature: 'rituals',
  shots: [
    {
      name: 'today-morning-prompt',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: loaded,
    },
    {
      name: 'morning-1-pick',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: async (page) => {
        await openMorning(page)
        await pickThree(page)
      },
    },
    {
      name: 'morning-2-goal-work',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: async (page) => {
        await openMorning(page)
        await pickThree(page)
        await next(page, morning(page))
      },
    },
    {
      name: 'morning-3-goal',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: async (page) => {
        await openMorning(page)
        await pickThree(page)
        await next(page, morning(page))
        await next(page, morning(page))
        await morning(page).getByRole('button', { name: 'More pomodoros' }).click()
        await settle(page)
      },
    },
    {
      name: 'today-top3',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: finishMorning,
    },
    {
      name: 'morning-empty',
      path: '/?seed=empty',
      prepare: async (page) => {
        await page.keyboard.press('w')
        await page.keyboard.press('m')
        await morning(page).waitFor()
        await loaded(page)
      },
    },
    {
      name: 'today-evening-prompt',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: goEvening,
    },
    {
      name: 'evening-1-done',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: async (page) => {
        await goEvening(page)
        await openEvening(page)
      },
    },
    {
      name: 'evening-2-open',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: async (page) => {
        await goEvening(page)
        await openEvening(page)
        await next(page, evening(page))
      },
    },
    {
      name: 'evening-2-moved',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: async (page) => {
        await goEvening(page)
        await openEvening(page)
        await next(page, evening(page))
        await evening(page)
          .getByRole('button', { name: 'Leave C779 · Unit 3: CSS layout (30 min) on today' })
          .click()
        await evening(page).getByRole('button', { name: 'Move 6 to tomorrow' }).click()
        await page.waitForTimeout(400)
        await clearToasts(page)
        await settle(page)
      },
    },
    {
      name: 'evening-3-reflection',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: async (page) => {
        await goEvening(page)
        await openEvening(page)
        await next(page, evening(page))
        await next(page, evening(page))
        await evening(page)
          .getByRole('textbox', { name: /One line about today/ })
          .fill('Finished the CSS layout unit. Tired, but a steady day.')
        await clearToasts(page)
        await settle(page)
      },
    },
    {
      name: 'evening-empty',
      path: '/?seed=empty',
      prepare: async (page) => {
        await page.keyboard.press('w')
        await page.keyboard.press('e')
        await evening(page).waitFor()
        await next(page, evening(page))
        await loaded(page)
      },
    },
    {
      name: 'routine-picker',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: async (page) => {
        await page.keyboard.press('ControlOrMeta+k')
        await page.getByRole('combobox', { name: 'Command palette' }).fill('add routine')
        await page.getByRole('option', { name: /Add routine/ }).click()
        await page.getByRole('dialog', { name: 'Add a routine' }).waitFor()
        await loaded(page)
      },
    },
    {
      name: 'routine-save',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      prepare: async (page) => {
        await page.keyboard.press('ControlOrMeta+k')
        await page.getByRole('combobox', { name: 'Command palette' }).fill('save today')
        await page.getByRole('option', { name: /Save today/ }).click()
        const dialog = page.getByRole('dialog', { name: 'Save as a routine' })
        await dialog.waitFor()
        await dialog.getByRole('textbox', { name: 'Name' }).fill('C779 study block')
        await loaded(page)
      },
    },
    {
      name: 'settings',
      path: '/settings/rituals?seed=wgu',
      waitFor: '[data-testid="routines-section"]',
      prepare: async (page) => {
        await page.locator('#settings-rituals').scrollIntoViewIfNeeded()
        await settle(page)
      },
    },
    {
      name: 'progress-reflections',
      path: '/?seed=wgu',
      waitFor: '[data-testid="ritual-prompt"]',
      element: '[data-testid="reflections"]',
      prepare: async (page) => {
        const evenings: [string, string][] = [
          ['2026-09-28', 'Read two units of C182. Slow start, strong finish.'],
          ['2026-09-27', 'Rest day. Planned the week for C779 and D278.'],
          ['2026-09-25', 'Took the D278 practice quiz: 78%. Review Big-O tomorrow.'],
        ]
        await putRows(
          page,
          'rituals',
          evenings.map(([day, reflection]) => ({
            id: `evening:${day}`,
            createdAt: 1,
            updatedAt: 1,
            day,
            kind: 'evening',
            top3: [],
            reflection,
            completedAt: 1,
          })),
        )
        await page.goto('/progress')
        await page.locator('[data-testid="reflections"]').waitFor()
        await page.getByRole('button', { name: /Reflections/ }).click()
        await loaded(page)
      },
    },
  ],
}

export default list
