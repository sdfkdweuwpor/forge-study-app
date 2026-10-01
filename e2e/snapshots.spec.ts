import { readFile } from 'node:fs/promises'
import type { CDPSession, Page } from '@playwright/test'
import { FIXED_NOW, expect, gotoApp, test } from './fixtures'
import { putRows, readTable } from './idb'

/**
 * Phase 11c: snapshots, on the WGU sample with the clock fixed at Tue 2026-09-29 09:30 New York. A snapshot
 * is taken, the data is changed, the snapshot is restored, and the tables are compared with what they were.
 * The automatic daily snapshot, its main-thread cost and the way out of a crash are checked too.
 */

const UNIT3_ID = 'task-c779-u3-3'
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications', exact: true })
const section = (page: Page) => page.getByRole('region', { name: 'Snapshots', exact: true })
const snapshotList = (page: Page) => section(page).getByRole('list', { name: 'Snapshots' })

interface SnapshotRow {
  id: string
  day: string
  reason: string
  createdAt: number
  sizeBytes: number
  counts?: Record<string, number>
}

const snapshots = (page: Page) => readTable<SnapshotRow>(page, 'snapshots')

/** The tables a restore replaces and that nothing rewrites at start-up, as data. */
const COMPARED = [
  'tasks',
  'goals',
  'milestones',
  'units',
  'plannedAssessments',
  'xpEvents',
  'sessions',
  'trash',
] as const

async function tablesOf(page: Page): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of COMPARED) out[name] = await readTable(page, name)
  return out
}

async function takeSnapshotNow(page: Page): Promise<void> {
  await section(page).getByRole('button', { name: 'Take snapshot now' }).click()
  await expect(toasts(page)).toContainText('Snapshot saved')
}

/**
 * Waits until the start-up chores have begun for the start at `at` (they note it as the first thing they do),
 * so a check that something was NOT done afterwards begins at the right moment instead of at a guess.
 */
async function choresStartedAt(page: Page, at: Date): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem('forge:trash:last-seen')), {
      timeout: 20_000,
    })
    .toBe(String(at.getTime()))
}

async function cpuClock(page: Page): Promise<() => Promise<number>> {
  const client: CDPSession = await page.context().newCDPSession(page)
  await client.send('Performance.enable', { timeDomain: 'threadTicks' })
  return async () => {
    const { metrics } = await client.send('Performance.getMetrics')
    return (metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000
  }
}

test.describe('taking and restoring a snapshot', () => {
  test('take a snapshot, change the data, restore it, and the data matches; Undo goes back', async ({
    page,
  }) => {
    await gotoApp(page, '/settings/snapshots', 'wgu')
    await expect(section(page)).toBeVisible()
    await expect(section(page).getByRole('heading', { level: 2, name: 'Snapshots' })).toBeVisible()
    await takeSnapshotNow(page)
    const manual = snapshotList(page).getByRole('listitem').filter({ hasText: 'Manual' })
    await expect(manual).toHaveCount(1)
    await expect(manual).toContainText('Today, 9:30 AM')
    await expect(manual).toContainText(/\d+ tasks?/)

    const original = await tablesOf(page)
    expect(original.tasks?.length).toBeGreaterThan(20)

    // Change the data the way a person does (delete a task and a goal), and behind the app's back (edit rows).
    await page.goto(`/task/${UNIT3_ID}`)
    await page.getByRole('button', { name: 'Move to trash' }).click()
    await expect(toasts(page)).toContainText('to the trash')
    await page.goto('/goals/goal-wgu-bscs')
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Move to trash' }).click()
    await expect(page).toHaveURL(/\/goals$/)
    const remaining = (await readTable<{ id: string; title: string }>(page, 'tasks')).slice(0, 3)
    await page.goto('/settings/snapshots')
    await putRows(
      page,
      'tasks',
      remaining.map((t) => ({ ...t, title: `${t.title} (edited)` })),
    )
    const modified = await tablesOf(page)
    expect(modified).not.toEqual(original)

    // Restore: the dialog says what it replaces, Cancel leaves everything as it is.
    await page.goto('/settings/snapshots')
    const restoreButton = manual.getByRole('button', { name: /^Restore the snapshot from/ })
    await restoreButton.click()
    const dialog = page.getByRole('dialog', { name: 'Restore this snapshot?' })
    await expect(dialog).toContainText('Everything on this device is replaced')
    await expect(dialog).toContainText('Before restore')
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(await tablesOf(page)).toEqual(modified)

    await restoreButton.click()
    await dialog.getByRole('button', { name: 'Restore snapshot' }).click()

    // The app reloads and says so.
    await expect(toasts(page)).toContainText('Snapshot restored', { timeout: 20_000 })
    expect(await tablesOf(page)).toEqual(original)
    const kinds = (await snapshots(page)).map((s) => s.reason)
    expect(kinds).toContain('pre-restore')
    await expect(
      snapshotList(page).getByRole('listitem').filter({ hasText: 'Before restore' }),
    ).toHaveCount(1)

    // Undo restores the copy taken just before: the changed data is back.
    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(toasts(page)).toContainText('Restore undone', { timeout: 20_000 })
    expect(await tablesOf(page)).toEqual(modified)
  })

  test('a snapshot can be downloaded as a JSON backup file, without attached PDFs', async ({
    page,
  }) => {
    await gotoApp(page, '/settings/snapshots', 'wgu')
    await takeSnapshotNow(page)
    const item = snapshotList(page).getByRole('listitem').filter({ hasText: 'Manual' })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      item.getByRole('button', { name: /^Download the snapshot from/ }).click(),
    ])
    expect(download.suggestedFilename()).toBe('forge-snapshot-2026-09-29-0930-manual.json')
    const file = JSON.parse(await readFile((await download.path()) as string, 'utf8')) as {
      app: string
      format: number
      tables: Record<string, unknown[]>
    }
    expect(file).toMatchObject({ app: 'forge', format: 1 })
    expect(file.tables.tasks?.length).toBeGreaterThan(20)
    expect(file.tables.snapshots).toBeUndefined()
  })

  test('a snapshot that cannot be read says so and changes nothing', async ({ page }) => {
    await gotoApp(page, '/settings/snapshots', 'wgu')
    await putRows(page, 'snapshots', [
      {
        id: 'broken-1',
        createdAt: new Date('2026-09-20T08:00:00-04:00').getTime(),
        updatedAt: 1,
        day: '2026-09-20',
        reason: 'manual',
        schemaVersion: 2,
        sizeBytes: 18,
        data: '{"hello":"world"}',
      },
    ])
    await page.goto('/settings/snapshots')
    const before = await tablesOf(page)
    const item = snapshotList(page).getByRole('listitem').filter({ hasText: 'Sep 20, 8:00 AM' })
    await item.getByRole('button', { name: /^Restore/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Restore this snapshot?' })
    await dialog.getByRole('button', { name: 'Restore snapshot' }).click()
    await expect(dialog.getByRole('alert')).toContainText('wasn’t made by Forge')
    await expect(dialog).toBeVisible()
    expect(await tablesOf(page)).toEqual(before)
    // Nothing was written for a restore that never started.
    expect((await snapshots(page)).some((s) => s.reason === 'pre-restore')).toBe(false)
  })

  test('taking one costs the main thread under 300 ms on the WGU sample', async ({ page }) => {
    await gotoApp(page, '/settings/snapshots', 'wgu')
    await expect(section(page).getByRole('button', { name: 'Take snapshot now' })).toBeVisible()
    // Let the start-up work (the daily snapshot included) finish, so only this snapshot is measured: it is
    // done once the list shows it.
    await expect(
      snapshotList(page).getByRole('listitem').filter({ hasText: 'Automatic' }),
    ).toHaveCount(1, { timeout: 20_000 })
    const cpu = await cpuClock(page)
    const work: number[] = []
    const manual = snapshotList(page).getByRole('listitem').filter({ hasText: 'Manual' })
    for (let run = 0; run < 3; run += 1) {
      const c0 = await cpu()
      await takeSnapshotNow(page)
      // The list has drawn the new row: the whole click, toast and list included, is what is measured.
      await expect(manual).toHaveCount(run + 1)
      work.push((await cpu()) - c0)
    }
    // The whole click: reading the tables, writing the JSON, the write, and drawing the toast and the list.
    expect(Math.min(...work)).toBeLessThan(300)
  })
})

test.describe('the automatic daily snapshot', () => {
  test('is written once a day when Forge starts, and the next day again', async ({ page }) => {
    test.setTimeout(90_000)
    await gotoApp(page, '/', 'wgu')
    await expect
      .poll(async () => (await snapshots(page)).filter((s) => s.reason === 'daily').length, {
        timeout: 20_000,
      })
      .toBe(1)
    const [first] = await snapshots(page)
    expect(first).toMatchObject({ reason: 'daily', day: '2026-09-29' })
    expect(first?.counts?.tasks).toBeGreaterThan(20)

    // Another start the same day: no second one. The chores begin once the start is noted; a snapshot
    // would take a moment more, so the check waits that long from there.
    const later = new Date(FIXED_NOW.getTime() + 60_000)
    await page.clock.setFixedTime(later)
    await page.goto('/')
    await choresStartedAt(page, later)
    await page.waitForTimeout(2000)
    expect((await snapshots(page)).filter((s) => s.reason === 'daily')).toHaveLength(1)

    // The next morning: a new one, and both are listed.
    await page.clock.setFixedTime(new Date('2026-09-30T08:15:00-04:00'))
    await page.goto('/settings/snapshots')
    await expect
      .poll(async () => (await snapshots(page)).filter((s) => s.reason === 'daily').length, {
        timeout: 20_000,
      })
      .toBe(2)
    const items = snapshotList(page).getByRole('listitem').filter({ hasText: 'Automatic' })
    await expect(items).toHaveCount(2)
    await expect(items.first()).toContainText('Today, 8:15 AM')
    await expect(items.nth(1)).toContainText('Yesterday, 9:30 AM')
  })

  test('is not written for an app with nothing in it, and the section says so', async ({
    page,
  }) => {
    await gotoApp(page, '/settings/snapshots', 'empty')
    await expect(section(page)).toContainText('No snapshots yet')
    await choresStartedAt(page, FIXED_NOW)
    await page.waitForTimeout(2000)
    expect(await snapshots(page)).toEqual([])
  })
})

test.describe('the crash screen', () => {
  test.use({
    ignoreConsoleErrors: ['Cannot read properties of null', 'The above error occurred'],
  })

  test('offers to export the data, copy the details and reload, and points to the snapshots', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await gotoApp(page, '/', 'wgu')
    // A settings row that has lost a section: what a bad write or an old build can leave behind.
    const [settings] = await readTable<Record<string, unknown>>(page, 'settings')
    await putRows(page, 'settings', [{ ...settings, appearance: null }])
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
    await expect(
      page.getByText('Your data is stored on this device and has not been touched'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Settings, Snapshots' })).toHaveAttribute(
      'href',
      '/settings/snapshots',
    )

    await page.getByRole('button', { name: 'Copy error details' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Copied' })).toBeVisible()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain('Forge error report')
    expect(copied).toContain('Cannot read properties of null')
    expect(copied).not.toContain('Renew library card')

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export my data' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('forge-export-2026-09-29.json')
    const file = JSON.parse(await readFile((await download.path()) as string, 'utf8')) as {
      app: string
      format: number
      tables: Record<string, unknown[]>
    }
    expect(file).toMatchObject({ app: 'forge', format: 1 })
    expect(file.tables.tasks?.length).toBeGreaterThan(20)
    expect(file.tables.snapshots).toBeUndefined()
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved forge-export-2026-09-29.json' }),
    ).toBeVisible()
  })
})
