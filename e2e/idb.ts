import type { Page } from '@playwright/test'

/**
 * Writes rows straight into an IndexedDB table (the app's database is named `forge`). Dexie's live
 * queries do not see a raw write, so reload the page afterwards (`page.goto` without `?seed=`).
 */
export async function putRows(page: Page, table: string, rows: readonly object[]): Promise<void> {
  await page.evaluate(
    ([name, data]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction([name as string], 'readwrite')
          for (const row of data as object[]) tx.objectStore(name as string).put(row)
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    [table, rows] as const,
  )
}

/** Reads a whole table straight from IndexedDB, so an assertion never depends on the UI under test. */
export async function readTable<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db.transaction(name).objectStore(name).getAll()
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            db.close()
            resolve(req.result as T[])
          }
        }
      }),
    table,
  )
}

/** Removes every row of a table straight in IndexedDB (a seed's rows a spec wants to replace with its own). */
export async function clearTable(page: Page, table: string): Promise<void> {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction([name], 'readwrite')
          tx.objectStore(name).clear()
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
    table,
  )
}

/**
 * `putRows` with the app really closed. The page the last `gotoApp` opened may still be finishing its own
 * start-up (the reconcile that pays a reached daily goal, the badge and streak sync), and a start-up that
 * reads rows written behind its back pays and announces them in that page, which the next load then
 * replaces: the XP is paid, and the toast that should have shown at the "next start" never does. So leave
 * the app for a static page of the same origin (`public/404.html`, no scripts) before writing; the next
 * `gotoApp` is then the only start that sees the rows.
 */
export async function putRowsWhileClosed(
  page: Page,
  table: string,
  rows: readonly object[],
): Promise<void> {
  await page.goto('/404.html')
  await putRows(page, table, rows)
}

/** A finished focus session of `minutes` on `day`, for `goalId` (`null` = no goal). */
export function focusSession(
  id: string,
  day: string,
  goalId: string | null,
  minutes: number,
): Record<string, unknown> {
  const startedAt = new Date(`${day}T08:00:00-04:00`).getTime()
  return {
    id,
    createdAt: startedAt,
    updatedAt: startedAt,
    kind: 'focus',
    mode: 'pomodoro',
    status: 'completed',
    taskId: null,
    goalId,
    milestoneId: null,
    day,
    startedAt,
    endedAt: startedAt + minutes * 60_000,
    plannedMinutes: minutes,
    pausedMs: 0,
    pausedAt: null,
    actualMinutes: minutes,
    round: 1,
    interrupted: false,
    counted: true,
    note: null,
  }
}
