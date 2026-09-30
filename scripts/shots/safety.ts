import type { Page } from '@playwright/test'
import { expect } from '../../e2e/fixtures'
import { putRows, readTable } from '../../e2e/idb'
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
  await page.mouse.move(0, 0)
}

const at = (iso: string): number => new Date(iso).getTime()

interface TrashRow {
  id: string
  title: string
  entityTable: string
  createdAt: number
  expiresAt: number
}

/**
 * Deletes what a week of use leaves in the Trash: two Inbox tasks, one chunk of C779, and the whole goal
 * (so the chunk's row says the goal comes back with it), then dates them like they were deleted on
 * different days. The clock is frozen at Tue 2026-09-29 09:30.
 */
async function fillTrash(page: Page): Promise<void> {
  await page.goto('/tasks/inbox')
  await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible()
  await page.keyboard.press('j')
  await page.keyboard.press('ControlOrMeta+Backspace')
  await expect.poll(async () => (await readTable(page, 'trash')).length).toBe(1)
  await page.keyboard.press('ControlOrMeta+Backspace')
  await expect.poll(async () => (await readTable(page, 'trash')).length).toBe(2)
  await page.goto('/task/task-c779-u3-3')
  await page.getByRole('button', { name: 'Move to trash' }).click()
  await expect.poll(async () => (await readTable(page, 'trash')).length).toBe(3)
  await page.goto('/goals/goal-wgu-bscs')
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Move to trash' }).click()
  await expect.poll(async () => (await readTable(page, 'trash')).length).toBe(4)

  // Different days: one from two weeks ago, one that goes in two days.
  const rows = await readTable<TrashRow>(page, 'trash')
  const older = rows.find((r) => r.entityTable === 'goals')
  const soon = rows.filter((r) => r.entityTable === 'tasks').at(-1)
  const edits: TrashRow[] = []
  if (older) {
    edits.push({
      ...older,
      createdAt: at('2026-09-15T18:20:00-04:00'),
      expiresAt: at('2026-10-15T18:20:00-04:00'),
    })
  }
  if (soon) {
    edits.push({
      ...soon,
      createdAt: at('2026-08-31T21:05:00-04:00'),
      expiresAt: at('2026-10-01T21:05:00-04:00'),
    })
  }
  await putRows(page, 'trash', edits)
  await page.goto('/trash')
  await page.getByRole('heading', { level: 1, name: 'Trash' }).waitFor()
  await page.getByRole('main').getByRole('listitem').first().waitFor()
}

/** Snapshots as a fortnight of use leaves them (rows only: the list never reads their data). */
async function fillSnapshots(page: Page): Promise<void> {
  const row = (
    id: string,
    iso: string,
    reason: string,
    sizeBytes: number,
    counts: Record<string, number>,
  ) => {
    const createdAt = at(iso)
    return {
      id,
      createdAt,
      updatedAt: createdAt,
      day: iso.slice(0, 10),
      reason,
      schemaVersion: 2,
      sizeBytes,
      data: '{}',
      counts,
    }
  }
  const wgu = { goals: 1, milestones: 5, tasks: 31, sessions: 12, flashcards: 0 }
  await putRows(page, 'snapshots', [
    row('s1', '2026-09-28T08:41:00-04:00', 'daily', 61_400, wgu),
    row('s2', '2026-09-27T20:12:00-04:00', 'daily', 58_900, { ...wgu, tasks: 27, sessions: 9 }),
    row('s3', '2026-09-26T07:55:00-04:00', 'daily', 55_100, { ...wgu, tasks: 24, sessions: 7 }),
    row('s4', '2026-09-24T22:03:00-04:00', 'manual', 52_800, { ...wgu, tasks: 22, sessions: 6 }),
    row('s5', '2026-09-22T09:10:00-04:00', 'pre-import', 1_310_000, {
      goals: 1,
      milestones: 22,
      tasks: 412,
      sessions: 2000,
      flashcards: 240,
    }),
  ])
  await page.goto('/settings/snapshots')
  await page.getByRole('list', { name: 'Snapshots' }).waitFor()
}

const list: ShotList = {
  feature: 'safety',
  shots: [
    {
      name: 'trash',
      path: '/task/task-c779-u3-3?seed=wgu',
      waitFor: 'main',
      prepare: async (page) => {
        await fillTrash(page)
        await settle(page)
      },
    },
    {
      name: 'trash-full',
      path: '/task/task-c779-u3-3?seed=wgu',
      waitFor: 'main',
      fullPage: true,
      prepare: async (page) => {
        await fillTrash(page)
        await settle(page)
      },
    },
    {
      name: 'trash-search',
      path: '/task/task-c779-u3-3?seed=wgu',
      waitFor: 'main',
      prepare: async (page) => {
        await fillTrash(page)
        await page.getByRole('searchbox', { name: 'Search the Trash' }).fill('c779')
        await settle(page)
      },
    },
    {
      name: 'trash-no-match',
      path: '/task/task-c779-u3-3?seed=wgu',
      waitFor: 'main',
      prepare: async (page) => {
        await fillTrash(page)
        await page.getByRole('searchbox', { name: 'Search the Trash' }).fill('d335')
        await page.getByRole('heading', { level: 2, name: /^No deleted items match/ }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'trash-empty',
      path: '/trash?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.getByRole('heading', { level: 2, name: 'Nothing in the trash' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'trash-delete-dialog',
      path: '/task/task-c779-u3-3?seed=wgu',
      waitFor: 'main',
      prepare: async (page) => {
        await fillTrash(page)
        await page.getByRole('button', { name: /^Delete “C779/ }).click()
        await page.getByRole('dialog', { name: /forever\?$/ }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'trash-empty-dialog',
      path: '/task/task-c779-u3-3?seed=wgu',
      waitFor: 'main',
      prepare: async (page) => {
        await fillTrash(page)
        await page.getByRole('button', { name: 'Empty trash' }).click()
        const dialog = page.getByRole('dialog', { name: 'Empty the Trash?' })
        await dialog.waitFor()
        await dialog.getByLabel(/Type “empty trash”/).fill('empty tr')
        await settle(page)
      },
    },
    {
      name: 'snapshots',
      path: '/settings/snapshots?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await fillSnapshots(page)
        await settle(page)
      },
    },
    {
      name: 'snapshots-restore',
      path: '/settings/snapshots?seed=wgu',
      waitFor: 'main h1',
      prepare: async (page) => {
        await fillSnapshots(page)
        await page
          .getByRole('list', { name: 'Snapshots' })
          .getByRole('listitem')
          .filter({ hasText: 'Manual' })
          .getByRole('button', { name: /^Restore/ })
          .click()
        await page.getByRole('dialog', { name: 'Restore this snapshot?' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'snapshots-empty',
      path: '/settings/snapshots?seed=empty',
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.getByText('No snapshots yet').waitFor()
        await settle(page)
      },
    },
  ],
}

export default list
