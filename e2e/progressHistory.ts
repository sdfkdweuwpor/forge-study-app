import { expect, type Page } from '@playwright/test'
import { buildProgressSample } from '../src/data/sample/progressSample'
import { putRows } from './idb'

/** The fixed "today" of every spec and shot (the fixture's clock). */
export const TODAY = '2026-09-29'

/**
 * Sets fields on the settings row (`id: 'app'`) straight in IndexedDB. Reload afterwards: live queries
 * do not see a raw write.
 */
async function patchSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (fields) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['settings'], 'readwrite')
          const store = tx.objectStore('settings')
          const get = store.get('app')
          get.onsuccess = () => store.put({ ...(get.result as object), ...fields })
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    patch,
  )
}

/**
 * Loads the WGU sample, writes a year of counted focus sessions and 12 weeks of finished tasks behind
 * it (`buildProgressSample`), then opens `path` on a fresh load, so the day rows are built at app start.
 * A long streak pays milestone XP and would raise the level-up moment and badge toasts over the page,
 * so the level is marked as already celebrated first.
 */
export async function withHistory(page: Page, path = '/progress'): Promise<void> {
  await page.goto('/?seed=wgu')
  await page.locator('#root > *').first().waitFor()
  const sample = buildProgressSample({ today: TODAY })
  await putRows(page, 'sessions', sample.sessions)
  await putRows(page, 'tasks', sample.tasks)
  await patchSettings(page, { lastCelebratedLevel: 999 })
  await page.goto(path)
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible()
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
  // The long streak earns badges at start-up and their toast would sit over the charts: keep it out.
  await page.addStyleTag({ content: '[aria-label="Notifications"] { display: none !important }' })
}
