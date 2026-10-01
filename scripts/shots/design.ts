import type { Page } from '@playwright/test'
import type { ShotList } from '../shot-types'

/** Waits for every finite CSS animation and transition to end (spinners and skeletons loop for ever), so the capture is the settled state. */
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

// The /design page: every component in light and dark columns. The shooter already runs each shot
// under both system colour schemes (which changes the page chrome) at 1440 and 375.
const list: ShotList = {
  feature: 'design',
  shots: [
    // The whole page, top to bottom.
    { name: 'full', path: '/design', waitFor: '#button', fullPage: true },
    // The first screen: title, toolbar, table of contents and the Button section.
    { name: 'top', path: '/design', waitFor: '#button' },
    // Scrolled to the Overlays group with the small confirm modal open in the light column.
    {
      name: 'modal',
      path: '/design#modal',
      waitFor: '#modal',
      prepare: async (page) => {
        await page.locator('#modal').scrollIntoViewIfNeeded()
        await page.locator('#modal').getByRole('button', { name: 'Small: confirm' }).first().click()
        await page.getByRole('dialog').waitFor()
        await settle(page)
      },
    },
  ],
}

export default list
