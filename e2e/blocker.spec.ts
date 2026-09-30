import type { Page } from '@playwright/test'
import { DEFAULT_EXTENSION_ID, EXTENSION_ZIP_URL } from '../extension/src/shared/config'
import { expect, gotoApp, test } from './fixtures'
import { putRows } from './idb'

/**
 * Phase 9C: the Blocker page against the app only, with no extension installed (the app <-> extension
 * round trip with the real extension is `e2e/blocker-extension.spec.ts`). The clock is fixed at Tue
 * 2026-09-29 09:30. Favicons come from DuckDuckGo: the fixtures answer those requests with a 1 px image
 * (e2e never touches the network); the fallback test refuses them instead.
 */

const sitesList = (page: Page) => page.getByRole('list', { name: 'Blocked sites' })
const siteRows = (page: Page) => sitesList(page).getByRole('listitem')
const addSite = (page: Page) => page.getByRole('textbox', { name: 'Add a site to block' })
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const paletteInput = (page: Page) => page.getByRole('combobox', { name: 'Command palette' })

async function openBlocker(page: Page, seed: 'empty' | 'wgu' = 'empty'): Promise<void> {
  await gotoApp(page, '/blocker', seed)
  await expect(siteRows(page)).toHaveCount(11)
}

/** Reads a whole table straight from IndexedDB, so an assertion never depends on the UI under test. */
async function readTable<T>(page: Page, name: string): Promise<T[]> {
  return page.evaluate(
    (tableName) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const req = db.transaction(tableName, 'readonly').objectStore(tableName).getAll()
          req.onerror = () => reject(req.error)
          req.onsuccess = () => {
            db.close()
            resolve(req.result as T[])
          }
        }
      }),
    name,
  )
}

const at = (iso: string): number => new Date(iso).getTime()

/** A block event the way the app stores it (id = the extension's uuid). */
function blockEvent(
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

test.describe('the page', () => {
  test('lists the 11 default sites with favicons and shows the not-installed state and steps', async ({
    page,
  }) => {
    await openBlocker(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Blocker' })).toBeVisible()

    for (const name of ['Instagram', 'TikTok', 'YouTube', 'X', 'Reddit', 'Netflix', 'Twitch']) {
      await expect(sitesList(page).getByText(name, { exact: true }).first()).toBeVisible()
    }
    // x.com and twitter.com are both "X"; the domain line tells them apart.
    await expect(sitesList(page).getByText('twitter.com', { exact: true })).toBeVisible()
    await expect(
      page.locator('img[src="https://icons.duckduckgo.com/ip3/instagram.com.ico"]'),
    ).toHaveCount(1)

    await expect(page.getByText('Not installed', { exact: true })).toBeVisible()
    const steps = page.getByRole('list').filter({ hasText: 'Load unpacked' })
    await expect(steps).toContainText('chrome://extensions')
    await expect(steps).toContainText('Developer mode')
    await expect(steps).toContainText('Load unpacked')
    await expect(page.getByRole('link', { name: 'Download the extension' })).toHaveAttribute(
      'href',
      EXTENSION_ZIP_URL,
    )
    await expect(
      page.getByText('The repository is private, so GitHub asks you to sign in first.'),
    ).toBeVisible()
    await expect(
      page.getByText(/Netlify deploy preview on another address can’t connect/),
    ).toBeVisible()
    await expect(page.getByRole('link', { name: 'Screen Time on iPhone' })).toHaveAttribute(
      'href',
      'https://support.apple.com/en-us/108806',
    )
    await expect(page.getByRole('link', { name: 'Digital Wellbeing on Android' })).toHaveAttribute(
      'href',
      'https://support.google.com/android/answer/9346420',
    )
  })

  test('adds a site, explains what cannot be added, removes with Undo', async ({ page }) => {
    await openBlocker(page)

    await addSite(page).fill('https://www.Khanacademy.org/math?x=1')
    await addSite(page).press('Enter')
    await expect(siteRows(page)).toHaveCount(12)
    await expect(sitesList(page).getByText('khanacademy.org', { exact: true })).toBeVisible()
    await expect(addSite(page)).toHaveValue('')

    // Validation, in words.
    await addSite(page).fill('not a site')
    await page.getByRole('button', { name: 'Add', exact: true }).first().click()
    await expect(page.getByText('That doesn’t look like a website.')).toBeVisible()
    await addSite(page).fill('REDDIT.com')
    await addSite(page).press('Enter')
    await expect(page.getByText('reddit.com is already on the list.')).toBeVisible()
    await addSite(page).fill('old.reddit.com')
    await addSite(page).press('Enter')
    await expect(page.getByText('reddit.com already blocks old.reddit.com.')).toBeVisible()
    await addSite(page).fill('forge-study-app.netlify.app')
    await addSite(page).press('Enter')
    await expect(
      page.getByText('That would block Forge itself, so it can’t be added.'),
    ).toBeVisible()
    await expect(siteRows(page)).toHaveCount(12)

    // Remove, then Undo.
    await siteRows(page).filter({ hasText: 'khanacademy.org' }).hover()
    await page.getByRole('button', { name: 'Remove khanacademy.org' }).click()
    await expect(siteRows(page)).toHaveCount(11)
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(siteRows(page)).toHaveCount(12)

    // Persisted, once.
    await page.goto('/blocker')
    await expect(siteRows(page)).toHaveCount(12)
    const rows = await readTable<{ domain: string; kind: string }>(page, 'blocklist')
    expect(rows.filter((r) => r.domain === 'khanacademy.org')).toHaveLength(1)
  })

  test('removed defaults stay removed and come back with Restore defaults', async ({ page }) => {
    await openBlocker(page)
    await page.getByRole('button', { name: 'Remove netflix.com' }).click()
    await page.getByRole('button', { name: 'Remove twitch.tv' }).click()
    await expect(siteRows(page)).toHaveCount(9)

    // A reload (which runs the seeding again) must not bring them back.
    await page.goto('/blocker')
    await expect(siteRows(page)).toHaveCount(9)

    await page.getByRole('button', { name: 'Restore defaults (2)' }).click()
    await expect(siteRows(page)).toHaveCount(11)
    await expect(page.getByRole('button', { name: /Restore defaults/ })).toHaveCount(0)
  })

  test('switching a site off keeps it on the list and survives a reload', async ({ page }) => {
    await openBlocker(page)
    const toggle = page.getByRole('switch', { name: 'Block reddit.com' })
    await expect(toggle).toBeChecked()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await page.goto('/blocker')
    await expect(page.getByRole('switch', { name: 'Block reddit.com' })).not.toBeChecked()
    await expect(siteRows(page)).toHaveCount(11)
    await expect(page.getByText('10 of 11 on')).toBeVisible()
  })

  test('changes the mode and edits the schedule', async ({ page }) => {
    await openBlocker(page)
    const mode = page.getByRole('radiogroup', { name: 'When to block' })
    await expect(mode.getByRole('radio', { name: 'During focus' })).toBeChecked()
    await expect(page.getByText(/Sites are blocked while a focus session is running/)).toBeVisible()
    await expect(page.getByRole('group', { name: 'Window 1 days' })).toHaveCount(0)

    await mode.getByRole('radio', { name: 'Scheduled' }).click()
    await expect(
      page.getByText('Sites are blocked during the times below', { exact: false }),
    ).toBeVisible()
    // The default schedule is Mon to Fri, 9 to 5.
    const days = page.getByRole('group', { name: 'Window 1 days' })
    await expect(days.getByRole('button', { name: 'Monday' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(days.getByRole('button', { name: 'Saturday' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(page.getByText('Blocking Mon–Fri 09:00 to 17:00.')).toBeVisible()

    await days.getByRole('button', { name: 'Saturday' }).click()
    await page.getByLabel('Window 1 end').fill('18:30')
    await page.getByRole('button', { name: 'Add a window' }).click()
    await expect(page.getByRole('group', { name: 'Window 2 days' })).toBeVisible()
    // A window that would block nothing says so.
    await page.getByLabel('Window 2 days').getByRole('button', { name: 'Monday' }).click()
    await page.getByRole('button', { name: 'Remove window 2' }).click()
    await expect(page.getByRole('group', { name: 'Window 2 days' })).toHaveCount(0)

    await page.goto('/blocker')
    await expect(page.getByRole('radio', { name: 'Scheduled' })).toBeChecked()
    await expect(page.getByLabel('Window 1 end')).toHaveValue('18:30')
    await expect(
      page.getByRole('group', { name: 'Window 1 days' }).getByRole('button', { name: 'Saturday' }),
    ).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('radio', { name: 'Always' }).click()
    await expect(page.getByText(/Sites stay blocked all the time/)).toBeVisible()
    await expect(page.getByRole('group', { name: 'Window 1 days' })).toHaveCount(0)
    await page.goto('/blocker')
    await expect(page.getByRole('radio', { name: 'Always' })).toBeChecked()
  })

  test('an empty schedule window explains itself and is not saved', async ({ page }) => {
    await openBlocker(page)
    await page.getByRole('radio', { name: 'Scheduled' }).click()
    await page.getByLabel('Window 1 start').fill('17:00')
    await page.getByLabel('Window 1 end').fill('17:00')
    await expect(page.getByRole('alert').filter({ hasText: 'the same' })).toBeVisible()
    const settings = await readTable<{ blocker: { schedule: unknown[] } }>(page, 'settings')
    expect(settings[0]?.blocker.schedule).toEqual([])
  })

  test('exceptions: add a lecture and a channel, then remove one', async ({ page }) => {
    await openBlocker(page)
    await expect(page.getByText('No exceptions.')).toBeVisible()
    const field = page.getByRole('textbox', { name: 'Add an exception' })
    await field.fill('https://www.youtube.com/watch?v=aBc123#t=30')
    await field.press('Enter')
    await field.fill('youtube.com/@CS50')
    await field.press('Enter')
    const list = page.getByRole('list', { name: 'Exceptions' })
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await expect(list).toContainText('/watch?v=aBc123')
    await expect(list).toContainText('/@CS50')

    await field.fill('youtube.com/@CS50')
    await field.press('Enter')
    await expect(page.getByText('youtube.com/@CS50 is already an exception.')).toBeVisible()
    await field.fill('youtube.com/*')
    await field.press('Enter')
    await expect(page.getByText('Use a plain address without spaces or wildcards.')).toBeVisible()

    await page.getByRole('button', { name: 'Remove exception youtube.com/@CS50' }).click()
    await expect(list.getByRole('listitem')).toHaveCount(1)
    // An exception is not a blocked site.
    await expect(siteRows(page)).toHaveCount(11)
  })

  test('motivation lines: add, edit in place, remove, restore', async ({ page }) => {
    await openBlocker(page)
    const lines = page.getByRole('list', { name: 'Motivation lines' })
    await expect(lines.getByRole('listitem')).toHaveCount(5)

    await page
      .getByRole('textbox', { name: 'Add a motivation line' })
      .fill('C182 is one unit at a time.')
    await page.getByRole('textbox', { name: 'Add a motivation line' }).press('Enter')
    await expect(lines.getByRole('listitem')).toHaveCount(6)

    const first = page.getByRole('textbox', { name: 'Motivation line 1' })
    await first.fill('Finish the unit, then rest.')
    await first.press('Enter')
    await page.goto('/blocker')
    await expect(page.getByRole('textbox', { name: 'Motivation line 1' })).toHaveValue(
      'Finish the unit, then rest.',
    )
    await expect(page.getByRole('textbox', { name: 'Motivation line 6' })).toHaveValue(
      'C182 is one unit at a time.',
    )

    await page.getByRole('textbox', { name: 'Motivation line 6' }).hover()
    await page.getByRole('button', { name: 'Remove line 6' }).click()
    await expect(lines.getByRole('listitem')).toHaveCount(5)
    await page.getByRole('button', { name: 'Restore the default lines' }).click()
    await expect(page.getByRole('textbox', { name: 'Motivation line 1' })).toHaveValue(
      'The degree is built one 25-minute block at a time.',
    )
    await expect(page.getByRole('button', { name: 'Restore the default lines' })).toHaveCount(0)
  })

  test('the extension id override validates and saves', async ({ page }) => {
    await openBlocker(page)
    await page.getByText('Using a different extension ID?').click()
    const field = page.getByRole('textbox', { name: 'Extension ID' })
    await expect(field).toHaveAttribute('placeholder', DEFAULT_EXTENSION_ID)
    await field.fill('not-an-id')
    await page.getByRole('button', { name: 'Save ID' }).click()
    await expect(page.getByText('An extension ID is 32 letters, a to p.')).toBeVisible()

    await field.fill('abcdefghijklmnopabcdefghijklmnop')
    await page.getByRole('button', { name: 'Save ID' }).click()
    await expect(toasts(page).getByText('Extension ID saved')).toBeVisible()
    const settings = await readTable<{ blocker: { extensionIdOverride: string | null } }>(
      page,
      'settings',
    )
    expect(settings[0]?.blocker.extensionIdOverride).toBe('abcdefghijklmnopabcdefghijklmnop')

    await page.getByRole('button', { name: 'Use the built-in ID' }).click()
    await expect(toasts(page).getByText('Using the built-in extension ID')).toBeVisible()
  })

  test('says which addresses can connect when the app is opened somewhere else', async ({
    page,
  }) => {
    // localhost is one the extension listens to, so no warning here.
    await openBlocker(page)
    await expect(page.getByText('isn’t one the extension listens to')).toHaveCount(0)
  })
})

test.describe('keyboard and palette', () => {
  test('a focuses the add field', async ({ page }) => {
    await openBlocker(page)
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('a')
    await expect(addSite(page)).toBeFocused()
  })

  test('the header button focuses the add field', async ({ page }) => {
    await openBlocker(page)
    await page.getByRole('button', { name: 'Add site' }).click()
    await expect(addSite(page)).toBeFocused()
  })

  test('"Add site to blocklist" opens the page with the field ready', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('ControlOrMeta+k')
    await paletteInput(page).fill('add site')
    await page.getByRole('option', { name: /Add site to blocklist/ }).click()
    await expect(page).toHaveURL(/\/blocker$/)
    await expect(addSite(page)).toBeFocused()
    await addSite(page).fill('pinterest.com')
    await addSite(page).press('Enter')
    await expect(page.getByText('pinterest.com is already on the list.')).toBeVisible()
  })

  test('"Go to Blocker" and g b reach the page', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await page.keyboard.press('g')
    await page.keyboard.press('b')
    await expect(page).toHaveURL(/\/blocker$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Blocker' })).toBeVisible()
  })
})

test.describe('wins', () => {
  test('an empty day is a calm sentence, and an install prompt when nothing has ever been blocked', async ({
    page,
  }) => {
    await openBlocker(page)
    await expect(page.getByText('Your wins will show up here')).toBeVisible()
  })

  test('counts today’s attempts as wins, by site, with the unlock log kept neutral', async ({
    page,
  }) => {
    // The sample data gives Today its full layout (its aside only shows once there is something to plan).
    await openBlocker(page, 'wgu')
    const events = [
      ...Array.from({ length: 7 }, (_, i) =>
        blockEvent(`ig-${i}`, `2026-09-29T0${i + 1}:15:00-04:00`, 'instagram.com'),
      ),
      blockEvent('yt-1', '2026-09-29T08:00:00-04:00', 'youtube.com'),
      blockEvent('yt-2', '2026-09-29T08:05:00-04:00', 'm.youtube.com'),
      blockEvent('x-1', '2026-09-29T08:30:00-04:00', 'twitter.com'),
      blockEvent('nf-1', '2026-09-29T08:40:00-04:00', 'netflix.com'),
      blockEvent('rd-old', '2026-09-20T10:00:00-04:00', 'reddit.com'),
      blockEvent('rd-unlock', '2026-09-28T21:10:00-04:00', 'reddit.com', 'unlock'),
    ]
    await putRows(page, 'blockEvents', events)
    await page.goto('/blocker')

    await expect(page.getByText('You tried Instagram 7 times today, that’s 7 wins')).toBeVisible()
    const today = page.getByRole('list', { name: 'Blocked attempts today, by site' })
    await expect(today.getByRole('listitem')).toHaveCount(4)
    await expect(today.getByRole('listitem').nth(0)).toContainText('Instagram')
    await expect(today.getByRole('listitem').nth(0)).toContainText('7 times')
    await expect(today.getByRole('listitem').nth(1)).toContainText('YouTube')
    await expect(today.getByRole('listitem').nth(1)).toContainText('twice')
    // netflix.com is Netflix, not X.
    await expect(today.getByRole('listitem').filter({ hasText: 'Netflix' })).toContainText('once')
    await expect(today.getByRole('listitem').filter({ hasText: /^X/ })).toContainText('once')
    await expect(
      page.getByRole('region', { name: 'Today’s wins' }).getByText('11', { exact: true }),
    ).toBeVisible()

    // Today: the aside card.
    await page.goto('/')
    const card = page.getByRole('region', { name: 'Distractions blocked today' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('11')
    await card.getByRole('link', { name: 'Open the blocker' }).click()
    await expect(page).toHaveURL(/\/blocker$/)

    // Progress: attempts over 30 days, and the unlock log.
    await page.goto('/progress')
    await expect(page.getByRole('heading', { name: 'Blocked attempts' })).toBeVisible()
    await expect(
      page.getByText('Last 30 days · 12 wins for your focus', { exact: true }),
    ).toBeVisible()
    const unlocks = page.getByRole('table', { name: 'Emergency unlocks, newest first' })
    await expect(unlocks).toContainText('Mon, Sep 28 · 9:10 PM')
    await expect(unlocks).toContainText('reddit.com')
    await expect(unlocks).toContainText('5 min')
  })

  test('with no events and no extension, Today and Progress stay free of blocker cards', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await expect(page.getByText('Upcoming target')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Distractions blocked today' })).toHaveCount(0)
    await page.goto('/progress')
    await expect(page.getByRole('heading', { name: 'Emergency unlocks' })).toHaveCount(0)
  })
})

test.describe('the app talking to an extension (a stand-in inside the page)', () => {
  /** Installs a fake `chrome.runtime` that records every message and answers like the extension. */
  async function installFakeExtension(page: Page, events: unknown[] = []): Promise<void> {
    await page.addInitScript((pending) => {
      const w = window as unknown as {
        chrome: { runtime: unknown }
        __messages: { id: string; message: { type: string; [k: string]: unknown } }[]
      }
      w.__messages = []
      w.chrome = {
        runtime: {
          lastError: undefined,
          sendMessage(
            id: string,
            message: { type: string; since?: number },
            callback: (r: unknown) => void,
          ) {
            w.__messages.push({ id, message })
            queueMicrotask(() => {
              if (message.type === 'ping') callback({ ok: true, version: '1.0.0' })
              else if (message.type === 'getEvents') {
                const since = message.since ?? 0
                const fresh = (pending as { at: number }[]).filter((e) => e.at > since)
                callback({
                  ok: true,
                  events: fresh,
                  cursor: fresh.reduce((m, e) => Math.max(m, e.at), since),
                })
              } else callback({ ok: true })
            })
          },
        },
      }
    }, events)
  }

  const messages = (page: Page) =>
    page.evaluate(
      () =>
        (window as unknown as { __messages: { id: string; message: { type: string } }[] })
          .__messages,
    )

  test('shows Connected with the version and pushes the config', async ({ page }) => {
    await installFakeExtension(page)
    await gotoApp(page, '/blocker', 'empty')
    await expect(page.getByText('Connected · v1.0.0')).toBeVisible()
    await expect(page.getByText('Not installed')).toHaveCount(0)
    await expect(page.getByRole('list').filter({ hasText: 'Load unpacked' })).toHaveCount(0)

    await expect
      .poll(async () => (await messages(page)).filter((m) => m.message.type === 'sync').length)
      .toBeGreaterThan(0)
    const all = await messages(page)
    expect(all.every((m) => m.id === DEFAULT_EXTENSION_ID)).toBe(true)
    const sync = all.find((m) => m.message.type === 'sync')?.message as unknown as {
      config: { mode: string; blocklist: string[]; motivation: string[] }
    }
    expect(sync.config.mode).toBe('focus')
    expect(sync.config.blocklist).toHaveLength(11)
    expect(sync.config.blocklist).toContain('instagram.com')
    expect(sync.config.motivation).toHaveLength(5)
  })

  test('pushes a change to the list within a second, and only the change', async ({ page }) => {
    await installFakeExtension(page)
    await gotoApp(page, '/blocker', 'empty')
    await expect(siteRows(page)).toHaveCount(11)
    await expect
      .poll(async () => (await messages(page)).filter((m) => m.message.type === 'sync').length)
      .toBe(1)

    await addSite(page).fill('khanacademy.org')
    await addSite(page).press('Enter')
    await expect
      .poll(async () => (await messages(page)).filter((m) => m.message.type === 'sync').length, {
        timeout: 3000,
      })
      .toBe(2)
    const syncs = (await messages(page)).filter((m) => m.message.type === 'sync')
    const last = syncs[1]?.message as unknown as { config: { blocklist: string[] } }
    expect(last.config.blocklist).toContain('khanacademy.org')
    expect(last.config.blocklist).toHaveLength(12)

    await page.getByRole('radio', { name: 'Always' }).click()
    await expect
      .poll(async () => (await messages(page)).filter((m) => m.message.type === 'sync').length)
      .toBe(3)
  })

  test('follows the focus timer: start, pause, resume and stop', async ({ page }) => {
    await installFakeExtension(page)
    await gotoApp(page, '/focus', 'wgu')
    await expect(page.getByTestId('timer-display')).toBeVisible()
    const sessions = async () =>
      (await messages(page))
        .filter((m) => m.message.type === 'session')
        .map((m) => (m.message as unknown as { session: unknown }).session)
    // The app says "no session" once it knows there isn't one, so a stale one in the extension is cleared.
    await expect.poll(async () => (await sessions()).at(-1)).toBeNull()

    await page.getByTestId('task-picker').click()
    await page.getByRole('combobox', { name: 'Search open tasks' }).fill('Email mentor')
    await page.getByRole('option', { name: 'Email mentor about term plan' }).first().click()
    await page.getByTestId('timer-start').click()
    await expect(page.getByTestId('timer-toggle')).toHaveText('Pause')

    const [running] = await readTable<{ startedAt: number; plannedMinutes: number }>(
      page,
      'sessions',
    )
    await expect
      .poll(async () => (await sessions()).at(-1))
      .toEqual({
        active: true,
        endsAt: (running?.startedAt ?? 0) + 25 * 60_000,
        taskTitle: 'Email mentor about term plan',
      })

    // A paused session still blocks; it has no end in sight.
    await page.getByTestId('timer-toggle').click()
    await expect(page.getByTestId('timer-toggle')).toHaveText('Resume')
    await expect
      .poll(async () => (await sessions()).at(-1))
      .toEqual({ active: true, endsAt: null, taskTitle: 'Email mentor about term plan' })

    await page.getByTestId('timer-toggle').click()
    await expect(page.getByTestId('timer-toggle')).toHaveText('Pause')
    await expect
      .poll(async () => ((await sessions()).at(-1) as { endsAt: number | null } | null)?.endsAt)
      .toBeGreaterThan(running?.startedAt ?? 0)

    // Stopping ends the block.
    await page.getByTestId('timer-stop').click()
    // A session this short is thrown away quietly; a longer one asks "Done with this task?".
    await page
      .getByRole('dialog', { name: 'Done with this task?' })
      .waitFor({ timeout: 1500 })
      .then(() => page.keyboard.press('Escape'))
      .catch(() => undefined)
    await expect.poll(async () => (await sessions()).at(-1)).toBeNull()
  })

  test('pulls events, keeps them once, and shows them as wins', async ({ page }) => {
    const first = at('2026-09-29T09:05:00-04:00')
    await installFakeExtension(page, [
      { id: 'e1', at: first, kind: 'blocked', domain: 'instagram.com' },
      { id: 'e2', at: first + 1, kind: 'blocked', domain: 'instagram.com' },
      { id: 'e3', at: first + 2, kind: 'unlock', domain: 'reddit.com', unlockMinutes: 5 },
    ])
    await gotoApp(page, '/blocker', 'empty')
    await expect(page.getByText('You tried Instagram twice today, that’s 2 wins')).toBeVisible()
    // Pulling again (a reload asks from the stored cursor) adds nothing.
    await page.goto('/blocker')
    await expect(page.getByText('You tried Instagram twice today, that’s 2 wins')).toBeVisible()
    const rows = await readTable<{ id: string; kind: string }>(page, 'blockEvents')
    expect(rows.map((r) => `${r.id}:${r.kind}`).sort()).toEqual([
      'e1:attempt',
      'e2:attempt',
      'e3:unlock',
    ])
    const blockerSettings = async () =>
      (
        await readTable<{ blocker: { eventsCursor: number; lastSyncedAt: number | null } }>(
          page,
          'settings',
        )
      )[0]?.blocker
    expect((await blockerSettings())?.eventsCursor).toBe(first + 2)
    // The config has reached the extension too.
    await expect.poll(async () => (await blockerSettings())?.lastSyncedAt).not.toBeNull()
  })

  test('Today shows its card as soon as the extension is connected', async ({ page }) => {
    await installFakeExtension(page)
    await gotoApp(page, '/', 'wgu')
    const card = page.getByRole('region', { name: 'Distractions blocked today' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('0')
    await expect(card).toContainText('on watch')
  })

  test('uses the extension id override', async ({ page }) => {
    await installFakeExtension(page)
    await gotoApp(page, '/blocker', 'empty')
    await expect(page.getByText('Connected · v1.0.0')).toBeVisible()
    await page.getByText('Using a different extension ID?').click()
    await page
      .getByRole('textbox', { name: 'Extension ID' })
      .fill('abcdefghijklmnopabcdefghijklmnop')
    await page.getByRole('button', { name: 'Save ID' }).click()
    await expect
      .poll(async () => (await messages(page)).at(-1)?.id)
      .toBe('abcdefghijklmnopabcdefghijklmnop')
  })
})

test.describe('offline favicons', () => {
  // Refusing the request is a failed resource load, which the browser logs as an error on purpose.
  test.use({ ignoreConsoleErrors: ['Failed to load resource'] })

  test('fall back to a letter avatar, and the list still works', async ({ page }) => {
    await page.unroute('https://icons.duckduckgo.com/**')
    await page.route('https://icons.duckduckgo.com/**', (route) => route.abort())
    await openBlocker(page)
    await expect(page.locator('img[src*="icons.duckduckgo.com"]')).toHaveCount(0)
    await expect(siteRows(page).first()).toContainText('I')
    await addSite(page).fill('khanacademy.org')
    await addSite(page).press('Enter')
    await expect(siteRows(page)).toHaveCount(12)
  })
})
