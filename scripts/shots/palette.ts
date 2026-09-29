import type { Page } from '@playwright/test'
import type { ShotList } from '../shot-types'

// Command palette with a query, quick add with the brief's example typed, and the shortcut sheet.
// Keyboard shortcuts open them, exactly as a person would; the same steps work at 375 and 1440.

const BRIEF_EXAMPLE = 'Read chapter 4 tomorrow 2p #C182 !high ~2'

const list: ShotList = {
  feature: 'palette',
  shots: [
    {
      name: 'palette-empty',
      path: '/?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page: Page) => {
        await page.keyboard.press('Control+k')
        await page.getByRole('combobox', { name: 'Command palette' }).waitFor()
      },
    },
    {
      name: 'palette-query',
      path: '/?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page: Page) => {
        await page.keyboard.press('Control+k')
        const search = page.getByRole('combobox', { name: 'Command palette' })
        await search.fill('c182')
        await page.getByRole('option').first().waitFor()
      },
    },
    {
      name: 'quickadd',
      path: '/?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page: Page) => {
        await page.keyboard.press('q')
        const field = page.getByRole('textbox', { name: 'New task' })
        await field.waitFor()
        await field.pressSequentially(BRIEF_EXAMPLE)
        await page.getByRole('list', { name: 'Parsed details' }).waitFor()
      },
    },
    {
      name: 'quickadd-empty',
      path: '/?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page: Page) => {
        await page.keyboard.press('q')
        await page.getByRole('textbox', { name: 'New task' }).waitFor()
      },
    },
    {
      name: 'shortcut-sheet',
      path: '/?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page: Page) => {
        await page.keyboard.press('?')
        await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor()
      },
    },
  ],
}

export default list
