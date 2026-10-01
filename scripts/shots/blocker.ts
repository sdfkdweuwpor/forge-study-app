import type { Page } from '@playwright/test'
import type { Shot, ShotList } from '../shot-types'

/**
 * Blocker (Phase 9C). The clock is fixed at Tue 2026-09-29 09:30. Every shot loads the app once (so the
 * runner's own wait passes), then does its own setup in `prepare` and navigates to the page: favicon
 * requests are answered here (the sandbox has no network), and a stand-in `chrome.runtime` plays the
 * extension where a shot needs "Connected".
 */

const at = (iso: string): number => new Date(iso).getTime()

/** Every live query has answered, and finite animations and transitions have ended. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(0, 0)
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  )
}

/** Writes rows straight into IndexedDB. Live queries do not see it: navigate afterwards. */
async function putRows(page: Page, table: string, rows: readonly object[]): Promise<void> {
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

async function clearTable(page: Page, table: string): Promise<void> {
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

/** Merges values into the settings row's `blocker` section. */
async function patchBlockerSettings(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (values) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['settings'], 'readwrite')
          const store = tx.objectStore('settings')
          const get = store.get('app')
          get.onsuccess = () => {
            const row = get.result as { blocker: object }
            store.put({ ...row, blocker: { ...row.blocker, ...values } })
          }
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

const COLORS: Record<string, string> = {
  'instagram.com': '#c13584',
  'tiktok.com': '#111111',
  'youtube.com': '#e02020',
  'x.com': '#111111',
  'twitter.com': '#1d9bf0',
  'reddit.com': '#ff4500',
  'facebook.com': '#1877f2',
  'snapchat.com': '#f5c400',
  'netflix.com': '#b20710',
  'twitch.tv': '#9146ff',
  'pinterest.com': '#e60023',
}

/** Answers favicon lookups with a small coloured tile, like the real service would with each site's icon. */
async function withFavicons(page: Page): Promise<void> {
  await page.route('https://icons.duckduckgo.com/**', (route) => {
    const domain = /ip3\/(.+)\.ico/.exec(route.request().url())?.[1] ?? 'x'
    const color = COLORS[decodeURIComponent(domain)] ?? '#6b7280'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="${color}"/><circle cx="8" cy="8" r="3.2" fill="#fff"/></svg>`
    return route.fulfill({ contentType: 'image/svg+xml', body: svg })
  })
}

/** Favicon lookups that come back unusable: the page falls back to its letter avatars. */
async function withoutFavicons(page: Page): Promise<void> {
  await page.route('https://icons.duckduckgo.com/**', (route) =>
    route.fulfill({ contentType: 'image/x-icon', body: 'not an icon' }),
  )
}

/** A `chrome.runtime` that answers like the extension (1.0.0), installed before the next page load. */
async function withExtension(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as unknown as { chrome: unknown }).chrome = {
      runtime: {
        lastError: undefined,
        sendMessage(
          _id: string,
          message: { type: string; since?: number },
          callback: (r: unknown) => void,
        ) {
          queueMicrotask(() => {
            if (message.type === 'ping') callback({ ok: true, version: '1.0.0' })
            else if (message.type === 'getEvents')
              callback({ ok: true, events: [], cursor: message.since ?? 0 })
            else callback({ ok: true })
          })
        },
      },
    }
  })
}

function event(
  id: string,
  when: string,
  domain: string,
  kind: 'attempt' | 'unlock' = 'attempt',
): Record<string, unknown> {
  const time = at(when)
  return {
    id,
    createdAt: time,
    updatedAt: time,
    at: time,
    day: when.slice(0, 10),
    kind,
    domain,
    minutes: kind === 'unlock' ? 5 : null,
  }
}

/** Seven Instagram attempts today (the brief's example), some others, a month of history and two unlocks. */
function events(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  const add = (n: number, day: string, domain: string, hour: number) => {
    for (let i = 0; i < n; i++) {
      const hh = String(hour + Math.floor(i / 4)).padStart(2, '0')
      const mm = String((i % 4) * 12 + 3).padStart(2, '0')
      rows.push(event(`${domain}-${day}-${i}`, `${day}T${hh}:${mm}:00-04:00`, domain))
    }
  }
  add(7, '2026-09-29', 'instagram.com', 7)
  add(3, '2026-09-29', 'youtube.com', 8)
  add(1, '2026-09-29', 'twitter.com', 8)
  add(1, '2026-09-29', 'reddit.com', 9)
  add(5, '2026-09-28', 'instagram.com', 10)
  add(4, '2026-09-27', 'youtube.com', 14)
  add(6, '2026-09-24', 'reddit.com', 13)
  add(3, '2026-09-21', 'tiktok.com', 20)
  add(9, '2026-09-15', 'instagram.com', 9)
  add(2, '2026-09-09', 'netflix.com', 21)
  add(4, '2026-09-03', 'youtube.com', 15)
  rows.push(event('u1', '2026-09-27T20:41:00-04:00', 'youtube.com', 'unlock'))
  rows.push(event('u2', '2026-09-22T21:05:00-04:00', 'reddit.com', 'unlock'))
  return rows
}

/** The runner loaded the app once; go to the Blocker page and let it settle. */
async function openBlocker(page: Page): Promise<void> {
  await page.goto('/blocker')
  await page.getByRole('list', { name: 'Blocked sites' }).waitFor()
  await page.waitForLoadState('networkidle')
  await settle(page)
}

const first = (path: string): Pick<Shot, 'path' | 'waitFor'> => ({ path, waitFor: 'main' })

const list: ShotList = {
  feature: 'blocker',
  shots: [
    {
      name: 'not-installed',
      ...first('/?seed=wgu'),
      fullPage: true,
      prepare: async (page) => {
        await withFavicons(page)
        await openBlocker(page)
      },
    },
    {
      name: 'not-installed-avatars',
      ...first('/?seed=wgu'),
      prepare: async (page) => {
        await withoutFavicons(page)
        await openBlocker(page)
        await page.getByRole('heading', { name: 'Blocked sites' }).scrollIntoViewIfNeeded()
      },
    },
    {
      name: 'connected',
      ...first('/?seed=wgu'),
      fullPage: true,
      prepare: async (page) => {
        await withFavicons(page)
        await withExtension(page)
        await page.goto('/blocker')
        await putRows(page, 'blockEvents', events())
        await page.goto('/blocker')
        await page.getByText('Connected · v1.0.0').waitFor()
        await page.getByRole('list', { name: 'Blocked sites' }).waitFor()
        await page.waitForLoadState('networkidle')
        await settle(page)
      },
    },
    {
      name: 'scheduled',
      ...first('/?seed=wgu'),
      fullPage: true,
      prepare: async (page) => {
        await withFavicons(page)
        await openBlocker(page)
        await patchBlockerSettings(page, {
          mode: 'schedule',
          schedule: [
            { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
            { days: [2, 4], start: '20:00', end: '22:30' },
          ],
        })
        await openBlocker(page)
      },
    },
    {
      name: 'empty-list',
      ...first('/?seed=wgu'),
      prepare: async (page) => {
        await withFavicons(page)
        await openBlocker(page)
        await clearTable(page, 'blocklist')
        await page.goto('/blocker')
        await page.getByText('No sites are blocked').waitFor()
        await settle(page)
        await page.getByRole('heading', { name: 'Blocked sites' }).scrollIntoViewIfNeeded()
      },
    },
    {
      name: 'today-card',
      ...first('/?seed=wgu'),
      prepare: async (page) => {
        await putRows(page, 'blockEvents', events())
        await page.goto('/')
        await page.getByRole('region', { name: 'Distractions blocked today' }).waitFor()
        await page.waitForLoadState('networkidle')
        await settle(page)
      },
    },
    {
      name: 'progress',
      ...first('/?seed=wgu'),
      fullPage: true,
      prepare: async (page) => {
        await withFavicons(page)
        await putRows(page, 'blockEvents', events())
        await page.goto('/progress')
        await page.getByRole('heading', { name: 'Emergency unlocks' }).waitFor()
        await page.waitForLoadState('networkidle')
        await settle(page)
      },
    },
  ],
}

export default list
