import type { ShotList } from '../shot-types'

// App shell: hello Today, a placeholder route, Settings, and the mobile "More" sheet.
const list: ShotList = {
  feature: 'shell',
  shots: [
    { name: 'today', path: '/', waitFor: 'main h1' },
    { name: 'placeholder-goals', path: '/goals', waitFor: 'main h1' },
    { name: 'tasks-inbox', path: '/tasks/inbox', waitFor: 'main h1' },
    { name: 'settings', path: '/settings', waitFor: '#theme-select' },
    { name: 'not-found', path: '/nope', waitFor: 'main h1' },
    {
      name: 'more-sheet',
      path: '/progress',
      waitFor: 'main h1',
      // Only the mobile layout has a tab bar; on desktop this is just the Progress placeholder.
      prepare: async (page) => {
        const more = page.getByRole('button', { name: 'More' })
        if (await more.isVisible()) {
          await more.click()
          await page.getByRole('dialog', { name: 'More' }).waitFor()
        }
      },
    },
  ],
}

export default list
