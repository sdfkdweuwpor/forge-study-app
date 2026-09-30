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

/** A small backup file the import preview can show (the WGU courses, a few tasks). */
const BACKUP = JSON.stringify({
  app: 'forge',
  format: 1,
  schemaVersion: 2,
  appVersion: '0.1.0',
  exportedAt: '2026-09-22T13:30:00.000Z',
  notes: [],
  tables: {
    settings: [{ id: 'app' }],
    goals: [{ id: 'g1', title: 'B.S. Computer Science' }],
    milestones: [
      { id: 'c182', code: 'C182', title: 'Introduction to IT' },
      { id: 'c779', code: 'C779', title: 'Web Development Foundations' },
      { id: 'd278', code: 'D278', title: 'Scripting and Programming Foundations' },
    ],
    tasks: Array.from({ length: 24 }, (_, i) => ({ id: `t${i}`, title: `C182 unit ${i + 1}` })),
    sessions: Array.from({ length: 41 }, (_, i) => ({ id: `s${i}` })),
    flashcards: Array.from({ length: 58 }, (_, i) => ({ id: `f${i}` })),
  },
})

// Settings (Phase 10B). The sample data comes from `?seed=wgu`, dated around the fixed clock (Tue 2026-09-29).
const list: ShotList = {
  feature: 'settings',
  shots: [
    { name: 'top', path: '/settings?seed=wgu', waitFor: 'main h1', prepare: settle },
    {
      name: 'all',
      path: '/settings?seed=wgu',
      waitFor: 'main h1',
      fullPage: true,
      prepare: settle,
    },
    {
      name: 'appearance-preview',
      path: '/settings/appearance?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.locator('label[title="Orange"]').hover()
        await settle(page)
      },
    },
    { name: 'data', path: '/settings/data?seed=wgu', waitFor: 'main h1', prepare: settle },
    {
      name: 'data-refused',
      path: '/settings/data?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.locator('input[type="file"]').setInputFiles({
          name: 'notes.json',
          mimeType: 'application/json',
          buffer: Buffer.from('{"hello": "world"}'),
        })
        await page.getByRole('alert').filter({ hasText: 'Can’t import' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'import-preview',
      path: '/settings/data?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.locator('input[type="file"]').setInputFiles({
          name: 'forge-backup-2026-09-22.json',
          mimeType: 'application/json',
          buffer: Buffer.from(BACKUP),
        })
        await page.getByRole('dialog', { name: 'Import this backup?' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'reset-dialog',
      path: '/settings/data?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.getByRole('button', { name: 'Reset…' }).click()
        await page.getByRole('dialog', { name: 'Reset Forge?' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'reminder',
      path: '/settings?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        // Someone who has used Forge for four weeks without a backup: the note shows at the next start.
        await page.evaluate(
          () =>
            new Promise<void>((resolve, reject) => {
              const open = indexedDB.open('forge')
              open.onerror = () => reject(open.error)
              open.onsuccess = () => {
                const db = open.result
                const tx = db.transaction(['settings'], 'readwrite')
                const store = tx.objectStore('settings')
                const get = store.get('app')
                get.onsuccess = () =>
                  store.put({
                    ...(get.result as object),
                    createdAt: new Date('2026-09-01T12:00:00-04:00').getTime(),
                  })
                tx.oncomplete = () => {
                  db.close()
                  resolve()
                }
                tx.onerror = () => reject(tx.error)
              }
            }),
        )
        await page.goto('/settings')
        await page.getByText('It’s been a week since your last backup.').waitFor()
        await settle(page)
      },
    },
    {
      name: 'blocker-link',
      path: '/settings/blocker?seed=wgu',
      waitFor: 'main h1',
      prepare: settle,
    },
  ],
}

export default list
