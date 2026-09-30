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
