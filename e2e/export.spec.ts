import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Export end to end on the WGU sample data with the clock fixed at Tue 2026-09-29 09:30 (New York).
 * Downloads are read back from disk and checked for content, not just for existing.
 */

const paletteInput = (page: Page) => page.getByRole('combobox', { name: 'Command palette' })

async function readDownload(download: { path(): Promise<string | null> }): Promise<string> {
  const path = await download.path()
  expect(path).not.toBeNull()
  return readFile(path as string, 'utf8')
}

test.describe('Export', () => {
  test('Settings: tasks as CSV', async ({ page }) => {
    await gotoApp(page, '/settings', 'wgu')
    await expect(page.getByRole('heading', { name: 'Export & calendar' })).toBeVisible()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Tasks as CSV' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('forge-tasks-2026-09-29.csv')
    const text = await readDownload(download)
    expect(text.startsWith('﻿title,status,priority,do date')).toBe(true)
    expect(text).toContain('\r\n')
    expect(text).toContain('Email mentor about term plan')
  })

  test('Settings: open-only Markdown by goal, and copy as text', async ({ page }) => {
    await gotoApp(page, '/settings', 'wgu')
    await page.getByRole('radio', { name: 'Open' }).click()
    await page.getByRole('radio', { name: 'By goal' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Tasks as Markdown' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('forge-tasks-2026-09-29.md')
    const md = await readDownload(download)
    expect(md.startsWith('# Forge tasks')).toBe(true)
    expect(md).toContain('- [ ] ')
    expect(md).not.toMatch(/^- \[x\] /m)
    expect(md).toContain('## No goal')

    await page.getByRole('button', { name: 'Copy as text' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: /Copied tasks as Markdown|clipboard/ }),
    ).toBeVisible()
  })

  test('Settings: calendar .ics has study blocks and floating times', async ({ page }) => {
    await gotoApp(page, '/settings', 'wgu')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Calendar (.ics)' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('forge-calendar-2026-09-29.ics')
    const ics = await readDownload(download)
    expect(
      ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Forge//Study Planner//EN'),
    ).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toMatch(/UID:[^\r\n]+@forge/)
    expect(ics).toMatch(/DTSTART;VALUE=DATE:\d{8}\r\nDTEND;VALUE=DATE:\d{8}/)
    expect(ics).toMatch(/DTSTAMP:20260929T133000Z/)
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
  })

  test('Settings: copy calendar data', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await gotoApp(page, '/settings', 'wgu')
    await page.getByRole('button', { name: 'Copy calendar data' }).click()
    await expect(page.getByRole('status').filter({ hasText: /Copied calendar data/ })).toBeVisible()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip.startsWith('BEGIN:VCALENDAR')).toBe(true)
  })

  test('palette and shortcut commands download', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await page.keyboard.press('ControlOrMeta+k')
    await paletteInput(page).fill('Export tasks as CSV')
    const [csv] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')])
    expect(csv.suggestedFilename()).toBe('forge-tasks-2026-09-29.csv')

    await expect(paletteInput(page)).toBeHidden()
    const [ics] = await Promise.all([
      page.waitForEvent('download'),
      page.keyboard.press('o').then(() => page.keyboard.press('i')),
    ])
    expect(ics.suggestedFilename()).toBe('forge-calendar-2026-09-29.ics')
  })

  test('empty data still exports a valid, empty calendar', async ({ page }) => {
    await gotoApp(page, '/settings', 'empty')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Calendar (.ics)' }).click(),
    ])
    const ics = await readDownload(download)
    expect(ics).not.toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VCALENDAR')
  })
})
