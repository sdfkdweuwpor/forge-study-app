import { readFile } from 'node:fs/promises'
import type { Download, Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'
import { readTable } from './idb'
import { patchSettings } from './progressHistory'

/**
 * Phase 10B: Settings and data, on the fixed clock (Tue 2026-09-29 09:30 New York). Appearance and the
 * timer defaults must persist across a reload and reach the Focus page; the Data tools (export, import,
 * reset, the weekly reminder) are checked against what is really in IndexedDB, not against the screen.
 */

const html = (page: Page) => page.locator('html')
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications', exact: true })
const saved = (page: Page) => page.getByRole('status').filter({ hasText: 'Saved.' })

interface TaskRow {
  id: string
  title: string
}
interface SnapshotRow {
  reason: string
  data: string
}
interface SettingsRow {
  createdAt: number
  timer: { pomodoroMin: number; shortBreakMin: number; autoStartBreaks: boolean }
  dailyGoalPomodoros: number
  weekStartsOn: number
  backup: { lastExportAt: number | null; remindWeekly: boolean; lastRemindedAt: number | null }
}

/**
 * The safety copies taken by an import or a reset. The automatic daily snapshot (Phase 11c) is left out:
 * it is written by the app a moment after it starts, whenever that happens to be.
 */
async function safetyCopies(page: Page): Promise<SnapshotRow[]> {
  return (await readTable<SnapshotRow>(page, 'snapshots')).filter((s) => s.reason !== 'daily')
}

async function settingsRow(page: Page): Promise<SettingsRow> {
  const row = (await readTable<SettingsRow>(page, 'settings'))[0]
  if (!row) throw new Error('no settings row')
  return row
}

async function fileOf(download: Download): Promise<string> {
  const path = await download.path()
  expect(path).not.toBeNull()
  return readFile(path as string, 'utf8')
}

test.describe('Appearance', () => {
  test('theme, accent and reduced motion apply at once and survive a reload', async ({ page }) => {
    await gotoApp(page, '/settings/appearance', 'empty')
    await expect(page.getByRole('heading', { level: 2, name: 'Appearance' })).toBeVisible()

    await page.getByLabel('Theme').selectOption('dark')
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')

    const accents = page.getByRole('radiogroup', { name: 'Accent colour' })
    await expect(accents.getByRole('radio')).toHaveCount(6)
    await accents.getByRole('radio', { name: 'Teal' }).check({ force: true })
    await expect(html(page)).toHaveAttribute('data-accent', 'teal')
    await expect(accents.getByRole('radio', { name: 'Teal' })).toBeChecked()

    await page
      .getByRole('radiogroup', { name: 'Reduced motion' })
      .getByRole('radio', { name: 'On' })
      .click()
    await expect(html(page)).toHaveAttribute('data-reduced-motion', 'on')

    // The choices are in the database, and come back on a fresh load (theme-init.js has no flash).
    await page.reload()
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
    await expect(html(page)).toHaveAttribute('data-accent', 'teal')
    await expect(html(page)).toHaveAttribute('data-reduced-motion', 'on')
    await expect(page.getByLabel('Theme')).toHaveValue('dark')
    await expect(accents.getByRole('radio', { name: 'Teal' })).toBeChecked()
  })

  test('the preview follows the swatch you point at, and the page keeps the chosen accent', async ({
    page,
  }) => {
    await gotoApp(page, '/settings/appearance', 'empty')
    const preview = page.locator('[inert][data-accent]')
    await expect(preview).toHaveAttribute('data-accent', 'blue')
    await page.locator('label[title="Pink"]').hover()
    await expect(preview).toHaveAttribute('data-accent', 'pink')
    await expect(html(page)).toHaveAttribute('data-accent', 'blue')
    // The dot really paints the previewed accent, not only an attribute.
    const paint = await preview.evaluate((el) => getComputedStyle(el).getPropertyValue('--accent'))
    const page_ = await html(page).evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--accent'),
    )
    expect(paint.trim()).not.toBe('')
    expect(paint).not.toBe(page_)
    await page.mouse.move(0, 0)
    await expect(preview).toHaveAttribute('data-accent', 'blue')
  })
})

test.describe('Focus and Calendar', () => {
  test('timer defaults are saved and show on the Focus page', async ({ page }) => {
    await gotoApp(page, '/settings/focus', 'empty')
    const focusLength = page.getByRole('textbox', { name: 'Focus length' })
    await expect(focusLength).toHaveValue('25')

    await focusLength.fill('30')
    await focusLength.press('Enter')
    await expect(saved(page)).toBeVisible()

    const shortBreak = page.getByRole('textbox', { name: 'Short break' })
    await shortBreak.fill('7')
    await shortBreak.press('Tab')
    await expect.poll(async () => (await settingsRow(page)).timer.shortBreakMin).toBe(7)

    const goal = page.getByRole('textbox', { name: 'Daily goal' })
    await goal.fill('8')
    await goal.press('Tab')
    await page.getByRole('switch', { name: 'Start breaks automatically' }).click()
    await expect(page.getByRole('switch', { name: 'Start breaks automatically' })).toBeChecked()

    await expect.poll(async () => (await settingsRow(page)).timer.pomodoroMin).toBe(30)
    const row = await settingsRow(page)
    expect(row).toMatchObject({
      dailyGoalPomodoros: 8,
      timer: { pomodoroMin: 30, shortBreakMin: 7, autoStartBreaks: true },
    })

    await page.goto('/focus')
    await expect(page.getByText('30 min focus · 7 min break')).toBeVisible()
  })

  test('a value out of range is explained and not saved', async ({ page }) => {
    await gotoApp(page, '/settings/focus', 'empty')
    const rounds = page.getByRole('textbox', { name: 'Rounds before a long break' })
    await rounds.fill('99')
    await rounds.press('Enter')
    await expect(page.getByText('Not saved. Use a whole number from 1 to 12.')).toBeVisible()
    await rounds.fill('4x')
    await rounds.press('Tab')
    await expect(page.getByText('Not saved. Use a whole number from 1 to 12.')).toBeVisible()
    // Escape puts the saved number back.
    await rounds.press('Escape')
    await expect(rounds).toHaveValue('4')
    await expect(page.getByText('Not saved.')).toHaveCount(0)
    expect((await readTable<SettingsRow>(page, 'settings'))[0]?.timer).toMatchObject({
      pomodoroMin: 25,
    })
  })

  test('the week start is saved', async ({ page }) => {
    await gotoApp(page, '/settings/calendar', 'empty')
    const week = page.getByRole('radiogroup', { name: 'Week starts on' })
    await expect(week.getByRole('radio', { name: 'Monday' })).toBeChecked()
    await week.getByRole('radio', { name: 'Sunday' }).click()
    await expect.poll(async () => (await settingsRow(page)).weekStartsOn).toBe(0)
    await page.reload()
    await expect(week.getByRole('radio', { name: 'Sunday' })).toBeChecked()
  })
})

test.describe('the page', () => {
  test('lists every section in order, contributed ones included, and deep links scroll to them', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await gotoApp(page, '/settings', 'empty')
    const nav = page.getByRole('navigation', { name: 'Settings sections' })
    await expect(nav.getByRole('link')).toHaveText([
      'Appearance',
      'Focus',
      'Calendar',
      'Everyday task hours',
      'Sound and notifications',
      'Site blocker',
      'Export & calendar',
      'Data',
    ])

    await nav.getByRole('link', { name: 'Data' }).click()
    await expect(page).toHaveURL(/\/settings\/data$/)
    await expect(page.getByRole('heading', { level: 2, name: 'Data' })).toBeInViewport()
    await expect(nav.getByRole('link', { name: 'Data' })).toHaveAttribute(
      'aria-current',
      'location',
    )

    // A deep link on a fresh load lands on its section (Export & calendar sits below the fold).
    await page.goto('/settings/export')
    await expect(
      page.getByRole('heading', { level: 2, name: 'Export & calendar' }),
    ).toBeInViewport()
    await page.goto('/settings/sound')
    await expect(
      page.getByRole('heading', { level: 2, name: 'Sound and notifications' }),
    ).toBeInViewport()
  })

  test('on a phone the sections stack, with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoApp(page, '/settings', 'empty')
    await expect(page.getByRole('heading', { level: 2, name: 'Data' })).toBeAttached()
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }))
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner)
    await page.getByRole('link', { name: 'Site blocker' }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Site blocker' })).toBeInViewport()
    await page.getByRole('link', { name: 'Open Blocker' }).click()
    await expect(page).toHaveURL(/\/blocker$/)
  })
})

test.describe('Export', () => {
  test('downloads every table as forge-backup-<day>.json and notes the time', async ({ page }) => {
    await gotoApp(page, '/settings/data', 'wgu')
    await expect(page.getByText('Last backup: Never')).toBeVisible()
    const tasks = await readTable<TaskRow>(page, 'tasks')
    expect(tasks.length).toBeGreaterThan(20)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export JSON' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('forge-backup-2026-09-29.json')
    const file = JSON.parse(await fileOf(download)) as {
      app: string
      format: number
      schemaVersion: number
      appVersion: string
      exportedAt: string
      tables: Record<string, { id: string }[]>
    }
    expect(file).toMatchObject({ app: 'forge', format: 1, schemaVersion: 2 })
    expect(file.appVersion).toMatch(/^\d+\.\d+\.\d+/)
    expect(file.exportedAt).toBe('2026-09-29T13:30:00.000Z')
    expect(file.tables.tasks?.map((t) => t.id).sort()).toEqual(tasks.map((t) => t.id).sort())
    expect(Object.keys(file.tables)).toContain('goals')
    expect(file.tables.snapshots).toBeUndefined()

    await expect(toasts(page).getByText('Backup saved')).toBeVisible()
    await expect(page.getByText('Last backup: Sep 29, 2026 (today)')).toBeVisible()
    expect((await settingsRow(page)).backup.lastExportAt).not.toBeNull()
  })

  test('o b exports from anywhere, and the palette has the data commands', async ({ page }) => {
    test.slow()
    await gotoApp(page, '/', 'wgu')
    // Keys are only heard once the shell is up.
    await expect(page.locator('main h1').first()).toBeVisible()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.keyboard.press('o')
        await page.keyboard.press('b')
      })(),
    ])
    expect(download.suggestedFilename()).toBe('forge-backup-2026-09-29.json')
    await expect(toasts(page).getByText('Backup saved')).toBeVisible()

    await page.keyboard.press('ControlOrMeta+k')
    const input = page.getByRole('combobox', { name: 'Command palette' })
    await input.fill('backup')
    await expect(page.getByRole('option', { name: /Export all data/ })).toBeVisible()
    await expect(page.getByRole('option', { name: /Import data from a backup/ })).toBeVisible()
    await input.fill('reset forge')
    await page.getByRole('option', { name: /Reset Forge/ }).click()
    await expect(page).toHaveURL(/\/settings\/data\?do=reset$/)
    await expect(page.getByRole('dialog', { name: 'Reset Forge?' })).toBeVisible()
  })
})

test.describe('Reset and Import', () => {
  test('the typed reset clears everything, and importing the export restores it', async ({
    page,
  }, testInfo) => {
    // Export, reset, two hard navigations, an import and a reload: a lot of page loads for one test.
    test.slow()
    await gotoApp(page, '/settings/data', 'wgu')
    const before = await readTable<TaskRow>(page, 'tasks')
    expect(before.length).toBeGreaterThan(20)
    const goalsBefore = await readTable<{ id: string }>(page, 'goals')
    expect(goalsBefore).toHaveLength(1)

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export JSON' }).click(),
    ])
    const backupPath = testInfo.outputPath('forge-backup.json')
    await download.saveAs(backupPath)

    // Reset needs the words.
    await page.getByRole('button', { name: 'Reset…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Reset Forge?' })
    const confirm = dialog.getByRole('button', { name: 'Reset everything' })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel(/Type “reset forge”/).fill('reset forg')
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel(/Type “reset forge”/).fill('reset forge')
    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect(page).toHaveURL(/\/welcome$/)
    expect(await readTable(page, 'tasks')).toEqual([])
    expect(await readTable(page, 'goals')).toEqual([])
    expect(await readTable(page, 'xpEvents')).toEqual([])
    expect((await readTable<SettingsRow>(page, 'settings')).length).toBe(1)
    // The pre-reset copy is kept inside the app.
    expect((await safetyCopies(page)).map((s) => s.reason)).toEqual(['pre-reset'])

    // Now bring it all back from the file.
    await page.goto('/settings/data')
    await page.locator('input[type="file"]').setInputFiles(backupPath)
    const preview = page.getByRole('dialog', { name: 'Import this backup?' })
    await expect(preview).toBeVisible()
    await expect(preview.getByText('forge-backup.json · exported Sep 29, 2026')).toBeVisible()
    const counts = preview.getByRole('list', { name: 'What the backup contains' })
    await expect(counts.getByText('Tasks', { exact: true })).toBeVisible()
    await expect(counts.getByText(String(before.length), { exact: true })).toBeVisible()
    await expect(counts.getByText('Courses', { exact: true })).toBeVisible()
    // Nothing has changed yet.
    expect(await readTable(page, 'tasks')).toEqual([])

    const [safety] = await Promise.all([
      page.waitForEvent('download'),
      preview.getByRole('button', { name: 'Replace my data' }).click(),
    ])
    expect(safety.suggestedFilename()).toBe('forge-before-import-2026-09-29.json')

    await expect(toasts(page).getByText(/^Imported · [\d,]+ items$/)).toBeVisible({
      timeout: 15_000,
    })
    const after = await readTable<TaskRow>(page, 'tasks')
    expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort())
    expect(await readTable(page, 'goals')).toEqual(goalsBefore)
    // The copies taken on the way are still there.
    const reasons = (await safetyCopies(page)).map((s) => s.reason).sort()
    expect(reasons).toEqual(['pre-import', 'pre-reset'])
    // Back in the app, today's task from the sample is on screen.
    await page.goto('/')
    await expect(page.getByText('Email mentor about term plan').first()).toBeVisible()
  })

  test('a file that is not a Forge backup is refused with a reason, and nothing changes', async ({
    page,
  }) => {
    await gotoApp(page, '/settings/data', 'wgu')
    const before = await readTable<TaskRow>(page, 'tasks')
    const input = page.locator('input[type="file"]')

    await input.setInputFiles({
      name: 'notes.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"hello": "world"}'),
    })
    const alert = page.getByRole('alert').filter({ hasText: 'Can’t import' })
    await expect(alert).toContainText('Can’t import “notes.json”')
    await expect(alert).toContainText('wasn’t made by Forge')
    await expect(alert).toContainText('Nothing was changed.')

    await input.setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"app": "forge", "tables"'),
    })
    await expect(alert).toContainText('isn’t a readable JSON file')

    const newer = {
      app: 'forge',
      format: 1,
      schemaVersion: 99,
      appVersion: '9.0.0',
      exportedAt: '2027-01-01T00:00:00.000Z',
      notes: [],
      tables: { tasks: [{ id: 'x' }] },
    }
    await input.setInputFiles({
      name: 'future.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(newer)),
    })
    await expect(alert).toContainText('newer version of Forge')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await readTable<TaskRow>(page, 'tasks')).toEqual(before)
  })

  test('cancelling the preview changes nothing', async ({ page }) => {
    await gotoApp(page, '/settings/data', 'wgu')
    const before = await readTable<TaskRow>(page, 'tasks')
    const backup = {
      app: 'forge',
      format: 1,
      schemaVersion: 2,
      appVersion: '0.1.0',
      exportedAt: '2026-09-01T12:00:00.000Z',
      notes: [],
      tables: { tasks: [{ id: 'only-task', title: 'The only task' }] },
    }
    await page.locator('input[type="file"]').setInputFiles({
      name: 'small.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    })
    const preview = page.getByRole('dialog', { name: 'Import this backup?' })
    await expect(preview.getByText('1 items')).toBeVisible()
    await preview.getByRole('button', { name: 'Cancel' }).click()
    await expect(preview).toHaveCount(0)
    expect(await readTable<TaskRow>(page, 'tasks')).toEqual(before)
    expect(await safetyCopies(page)).toEqual([])
  })
})

test.describe('Weekly backup reminder', () => {
  const SEPTEMBER_FIRST = new Date('2026-09-01T12:00:00-04:00').getTime()
  const note = (page: Page) => toasts(page).getByText('It’s been a week since your last backup.')

  /**
   * Writes settings fields with the app closed (a static page of the same origin), then opens Data. A page
   * still starting up would otherwise read the new date and show, or spend, the note before the check.
   */
  async function reopenWith(page: Page, patch: Record<string, unknown>): Promise<void> {
    await page.goto('/404.html')
    await patchSettings(page, patch)
    await page.goto('/settings/data')
    await expect(page.getByRole('heading', { level: 2, name: 'Data' })).toBeVisible()
  }

  /** Someone who started using Forge on Sep 1: 28 days before the fixed clock, and has never backed up. */
  async function dueAfterReload(page: Page): Promise<void> {
    await gotoApp(page, '/settings/data', 'wgu')
    await reopenWith(page, { createdAt: SEPTEMBER_FIRST })
  }

  test('shows once when a week has passed, offers Export now, and stays quiet afterwards', async ({
    page,
  }) => {
    await dueAfterReload(page)
    await expect(note(page)).toBeVisible()
    await expect(toasts(page).getByText(/Export now\?/)).toBeVisible()
    await expect.poll(async () => (await settingsRow(page)).backup.lastRemindedAt).not.toBeNull()

    // Ignoring it is fine, and it does not come back on the next start.
    await page.reload()
    await expect(page.getByRole('heading', { level: 2, name: 'Data' })).toBeVisible()
    await page.waitForTimeout(800)
    await expect(note(page)).toHaveCount(0)
  })

  test('the toast can be closed, and Export now downloads the backup and starts a quiet week', async ({
    page,
  }) => {
    await dueAfterReload(page)
    await expect(note(page)).toBeVisible()
    await toasts(page).getByRole('button', { name: 'Dismiss' }).click()
    await expect(note(page)).toHaveCount(0)

    await reopenWith(page, {
      backup: { lastExportAt: null, remindWeekly: true, lastRemindedAt: null },
    })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      toasts(page).getByRole('button', { name: 'Export now' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('forge-backup-2026-09-29.json')
    await expect(toasts(page).getByText('Backup saved')).toBeVisible()
    await expect.poll(async () => (await settingsRow(page)).backup.lastExportAt).not.toBeNull()
  })

  test('the switch turns it off, and it never shows without data or within a week of a backup', async ({
    page,
  }) => {
    await gotoApp(page, '/settings/data', 'wgu')
    await page.getByRole('switch', { name: 'Weekly backup reminder' }).click()
    await expect.poll(async () => (await settingsRow(page)).backup.remindWeekly).toBe(false)
    await reopenWith(page, { createdAt: SEPTEMBER_FIRST })
    await page.waitForTimeout(800)
    await expect(note(page)).toHaveCount(0)

    // No data: nothing to back up, however old the settings are.
    await gotoApp(page, '/settings/data', 'empty')
    await reopenWith(page, { createdAt: SEPTEMBER_FIRST })
    await page.waitForTimeout(800)
    await expect(note(page)).toHaveCount(0)

    // A backup three days ago silences it.
    await gotoApp(page, '/settings/data', 'wgu')
    await reopenWith(page, {
      createdAt: SEPTEMBER_FIRST,
      backup: {
        lastExportAt: new Date('2026-09-26T12:00:00-04:00').getTime(),
        remindWeekly: true,
        lastRemindedAt: null,
      },
    })
    await page.waitForTimeout(800)
    await expect(note(page)).toHaveCount(0)
  })
})
