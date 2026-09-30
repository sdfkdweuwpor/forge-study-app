import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'
import { putRows } from './idb'

/**
 * Phase 6B: the rewards shop end to end (`/rewards`). The clock is fixed at Tue 2026-09-29 09:30. Every
 * test starts from an empty database and writes its XP straight into `xpEvents`, so the balance never
 * depends on the sample data. The first visit adds the starter rewards: 30 min gaming (300 XP), Coffee
 * out (500 XP) and Order takeout (1,500 XP).
 */

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const undo = (page: Page) => toasts(page).getByRole('button', { name: 'Undo' })
const balance = (page: Page) => page.getByTestId('rewards-balance')
const lifetime = (page: Page) => page.getByTestId('rewards-lifetime')
const rewardRows = (page: Page) => page.getByRole('list', { name: 'Rewards' }).getByRole('listitem')
const paletteInput = (page: Page) => page.getByRole('combobox', { name: 'Command palette' })

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

interface StoredRedemption {
  rewardTitle: string
  price: number
  refundedAt: number | null
}

/** Marks every level as already celebrated, so the level-up moment never covers the page under test. */
async function quietLevelUps(page: Page): Promise<void> {
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
          get.onsuccess = () => {
            store.put({ ...(get.result as object), lastCelebratedLevel: 99 })
          }
          tx.onerror = () => reject(tx.error)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
        }
      }),
  )
}
const NOW = new Date('2026-09-29T09:00:00-04:00').getTime()

/** Opens the app on an empty database and gives the user `amount` lifetime XP. Leaves the page on `/`. */
async function withXp(page: Page, amount: number): Promise<void> {
  await gotoApp(page, '/', 'empty')
  await quietLevelUps(page)
  await putRows(page, 'xpEvents', [
    {
      id: 'xp-test',
      createdAt: NOW,
      updatedAt: NOW,
      at: NOW,
      day: '2026-09-29',
      source: 'task',
      amount,
      key: 'task:test',
      refId: null,
      note: null,
    },
  ])
}

/** Opens the shop with `amount` XP to spend; waits for the starter rewards. */
async function openShop(page: Page, amount: number): Promise<void> {
  await withXp(page, amount)
  await gotoApp(page, '/rewards')
  await expect(page.getByRole('heading', { level: 1, name: 'Rewards' })).toBeVisible()
  await expect(rewardRows(page)).toHaveCount(3)
}

async function addReward(page: Page, title: string, price: string): Promise<void> {
  await page.getByRole('button', { name: 'New reward' }).click()
  await page.getByRole('textbox', { name: 'Reward title' }).fill(title)
  await page.getByRole('textbox', { name: 'Price in XP' }).fill(price)
  await page.getByRole('textbox', { name: 'Price in XP' }).press('Enter')
}

test.describe('Rewards shop', () => {
  test('the first visit adds the three starter rewards, once, with the balance and lifetime XP', async ({
    page,
  }) => {
    await openShop(page, 1260)
    await expect(rewardRows(page)).toHaveText([
      /30 min gaming.*300 XP/,
      /Coffee out.*500 XP/,
      /Order takeout.*1,500 XP/,
    ])
    await expect(balance(page)).toHaveText('1,260 XP')
    await expect(lifetime(page)).toContainText('1,260 XP earned in all')

    await page.reload()
    await expect(rewardRows(page)).toHaveCount(3)
    expect(await readTable(page, 'rewards')).toHaveLength(3)
  })

  test('create a reward, redeem it, the balance drops, and Undo gives it back', async ({
    page,
  }) => {
    await openShop(page, 1260)
    await addReward(page, 'Movie night', '900')
    await expect(rewardRows(page)).toHaveCount(4)
    await expect(rewardRows(page).nth(3)).toContainText('Movie night')
    await expect(rewardRows(page).nth(3)).toContainText('900 XP')

    await page.getByRole('button', { name: 'Redeem Movie night for 900 XP' }).click()
    const dialog = page.getByRole('dialog', { name: 'Redeem Movie night for 900 XP?' })
    await expect(dialog).toContainText('360 XP will be left')
    await dialog.getByRole('button', { name: 'Redeem', exact: true }).click()

    await expect(toasts(page)).toContainText('Enjoy it! · −900 XP')
    await expect(balance(page)).toHaveText('360 XP')
    // Spending is not earning: lifetime XP, and so the level, stay put.
    await expect(lifetime(page)).toContainText('1,260 XP earned in all')
    expect(await readTable(page, 'xpEvents')).toHaveLength(1)
    const [stored] = await readTable<StoredRedemption>(page, 'redemptions')
    expect(stored).toMatchObject({ rewardTitle: 'Movie night', price: 900, refundedAt: null })

    await undo(page).click()
    await expect(toasts(page)).toContainText('Undone')
    await expect(balance(page)).toHaveText('1,260 XP')
    const [refunded] = await readTable<StoredRedemption>(page, 'redemptions')
    expect(refunded?.refundedAt).not.toBeNull()
  })

  test('an unaffordable reward is disabled and says how far away it is', async ({ page }) => {
    await openShop(page, 1260)
    const takeout = page.getByRole('button', { name: 'Redeem Order takeout for 1,500 XP' })
    await expect(takeout).toBeDisabled()
    await expect(rewardRows(page).nth(2)).toContainText('240 XP to go')
    await expect(takeout).toHaveAccessibleDescription('240 XP to go')
    // Affordable ones are live.
    await expect(
      page.getByRole('button', { name: 'Redeem 30 min gaming for 300 XP' }),
    ).toBeEnabled()

    // Earning enough turns it on (a raw write is not seen by live queries, so reload).
    await putRows(page, 'xpEvents', [
      {
        id: 'xp-more',
        createdAt: NOW,
        updatedAt: NOW,
        at: NOW,
        day: '2026-09-29',
        source: 'task',
        amount: 240,
        key: 'task:more',
        refId: null,
        note: null,
      },
    ])
    await page.reload()
    await expect(takeout).toBeEnabled()
    await expect(rewardRows(page).nth(2)).not.toContainText('to go')
  })

  test('cancelling the confirm dialog spends nothing', async ({ page }) => {
    await openShop(page, 1260)
    await page.getByRole('button', { name: 'Redeem Coffee out for 500 XP' }).click()
    const dialog = page.getByRole('dialog', { name: 'Redeem Coffee out for 500 XP?' })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    await expect(balance(page)).toHaveText('1,260 XP')
    expect(await readTable(page, 'redemptions')).toHaveLength(0)
  })

  test('title and price are edited in place: Enter commits, Esc reverts, a bad price is refused', async ({
    page,
  }) => {
    await openShop(page, 1260)

    await page.getByRole('button', { name: 'Price of Coffee out: 500. Edit' }).click()
    const price = page.getByRole('textbox', { name: 'Price of Coffee out' })
    await price.fill('650')
    await price.press('Enter')
    await expect(rewardRows(page).nth(1)).toContainText('650 XP')

    await page.getByRole('button', { name: 'Price of Coffee out: 650. Edit' }).click()
    await page.getByRole('textbox', { name: 'Price of Coffee out' }).fill('999')
    await page.keyboard.press('Escape')
    await expect(rewardRows(page).nth(1)).toContainText('650 XP')

    await page.getByRole('button', { name: 'Price of Coffee out: 650. Edit' }).click()
    await page.getByRole('textbox', { name: 'Price of Coffee out' }).fill('lots')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Enter a whole number of XP')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(rewardRows(page).nth(1)).toContainText('650 XP')

    await page.getByRole('button', { name: 'Title of Coffee out: Coffee out. Edit' }).click()
    const title = page.getByRole('textbox', { name: 'Title of Coffee out' })
    await title.fill('Coffee with Sam')
    await title.press('Enter')
    await expect(rewardRows(page).nth(1)).toContainText('Coffee with Sam')

    await page.reload()
    await expect(rewardRows(page).nth(1)).toContainText('Coffee with Sam')
    await expect(rewardRows(page).nth(1)).toContainText('650 XP')
  })

  test('a reward keeps its icon choice', async ({ page }) => {
    await openShop(page, 1260)
    await page.getByRole('button', { name: 'Change icon for Coffee out' }).click()
    await page.getByRole('button', { name: 'Bubble tea' }).click()
    await expect(page.getByRole('button', { name: 'Change icon for Coffee out' })).toHaveText('🧋')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Change icon for Coffee out' })).toHaveText('🧋')
  })

  test('drag to reorder works from the keyboard, and the order is saved', async ({ page }) => {
    await openShop(page, 1260)
    const grip = page.getByRole('button', { name: 'Reorder Order takeout' })
    await grip.focus()
    // dnd-kit announces each step; waiting for it keeps the next key from racing its sensor.
    await page.keyboard.press('Space')
    await expect(page.getByText('Order takeout is over Order takeout.')).toBeAttached()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByText('Order takeout is over Coffee out.')).toBeAttached()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByText('Order takeout is over 30 min gaming.')).toBeAttached()
    await page.keyboard.press('Space')
    await expect(page.getByText('Dropped Order takeout over 30 min gaming.')).toBeAttached()
    await expect(rewardRows(page).nth(0)).toContainText('Order takeout')
    await expect(rewardRows(page).nth(1)).toContainText('30 min gaming')

    // The list shows the drop at once; wait for the write before reloading.
    await expect
      .poll(async () =>
        (await readTable<{ title: string; order: number }>(page, 'rewards'))
          .sort((a, b) => a.order - b.order)
          .map((r) => r.title),
      )
      .toEqual(['Order takeout', '30 min gaming', 'Coffee out'])
    await page.reload()
    await expect(rewardRows(page)).toHaveText([/Order takeout/, /30 min gaming/, /Coffee out/])
  })

  test('archiving takes a reward off the shop, Undo puts it back, and starters never return', async ({
    page,
  }) => {
    await openShop(page, 1260)
    await page.getByRole('button', { name: 'Actions for Coffee out' }).click()
    await page.getByRole('menuitem', { name: 'Archive' }).click()
    await expect(toasts(page)).toContainText('Coffee out archived')
    await expect(rewardRows(page)).toHaveCount(2)
    await undo(page).click()
    await expect(rewardRows(page)).toHaveCount(3)

    // Archive them all: the shop is empty, and a reload does not seed it again.
    for (const title of ['30 min gaming', 'Coffee out', 'Order takeout']) {
      await page.getByRole('button', { name: `Actions for ${title}` }).click()
      await page.getByRole('menuitem', { name: 'Archive' }).click()
    }
    await expect(
      page.getByRole('heading', { name: 'Add a reward worth working for' }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Add a reward worth working for' }),
    ).toBeVisible()
    await expect(rewardRows(page)).toHaveCount(0)

    // An archived reward can be restored from under the shop.
    await page.getByRole('button', { name: /Archived \(3\)/ }).click()
    await page.getByRole('button', { name: 'Restore Coffee out' }).click()
    await expect(rewardRows(page)).toHaveCount(1)
    await expect(rewardRows(page).first()).toContainText('Coffee out')
  })

  test('n opens the new reward row, Enter adds and keeps it open, Esc closes it', async ({
    page,
  }) => {
    await openShop(page, 1260)
    await page.keyboard.press('n')
    const title = page.getByRole('textbox', { name: 'Reward title' })
    await expect(title).toBeFocused()

    await title.fill('Sunday sleep-in')
    await page.getByRole('textbox', { name: 'Price in XP' }).fill('1,200 XP')
    await page.getByRole('textbox', { name: 'Price in XP' }).press('Enter')
    await expect(rewardRows(page)).toHaveCount(4)
    await expect(rewardRows(page).nth(3)).toContainText('1,200 XP')
    await expect(title).toBeFocused()
    await expect(title).toHaveValue('')

    // Nothing to add is a note, not a reward.
    await title.press('Enter')
    await expect(page.getByText('Give the reward a name.')).toBeVisible()
    await expect(rewardRows(page)).toHaveCount(4)

    await title.press('Escape')
    await expect(title).toBeHidden()
    await expect(page.getByRole('button', { name: 'New reward' })).toBeFocused()
  })

  test('the palette has New reward and Go to Rewards shop', async ({ page }) => {
    await withXp(page, 1260)
    await gotoApp(page, '/')
    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('new reward')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/rewards\/shop\?new=1$/)
    await expect(page.getByRole('textbox', { name: 'Reward title' })).toBeFocused()

    await gotoApp(page, '/tasks/all')
    await page.keyboard.press('Control+k')
    await paletteInput(page).fill('rewards shop')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/rewards\/shop$/)
    await expect(balance(page)).toHaveText('1,260 XP')
  })

  test('History lists redemptions newest first with this month and all-time totals', async ({
    page,
  }) => {
    await openShop(page, 3000)
    for (const [name, at] of [
      ['30 min gaming', 'Redeem 30 min gaming for 300 XP'],
      ['Coffee out', 'Redeem Coffee out for 500 XP'],
    ] as const) {
      await page.getByRole('button', { name: at }).click()
      await page
        .getByRole('dialog', { name: `${at}?` })
        .getByRole('button', { name: 'Redeem', exact: true })
        .click()
      await expect(toasts(page)).toContainText(`${name} is yours`)
    }
    // An older month, refunded, must not count.
    const old = new Date('2026-08-15T12:00:00-04:00').getTime()
    await putRows(page, 'redemptions', [
      {
        id: 'r-old',
        createdAt: old,
        updatedAt: old,
        rewardId: 'gone',
        rewardTitle: 'Order takeout',
        price: 1500,
        at: old,
        day: '2026-08-15',
        refundedAt: null,
      },
      {
        id: 'r-refunded',
        createdAt: old,
        updatedAt: old,
        rewardId: 'gone',
        rewardTitle: 'Movie night',
        price: 900,
        at: old + 1000,
        day: '2026-08-15',
        refundedAt: old + 2000,
      },
    ])

    // A raw write is invisible to live queries that already ran, so open History afresh.
    await gotoApp(page, '/rewards')
    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page).toHaveURL(/\/rewards\/history$/)
    await expect(page.getByTestId('history-month')).toHaveText('800 XP')
    await expect(page.getByTestId('history-all')).toHaveText('2,300 XP')

    // Both were bought at the frozen clock's one instant, so their order is not defined; each is listed.
    const september = page.getByRole('region', { name: 'September 2026' })
    await expect(september.getByRole('listitem')).toHaveCount(2)
    await expect(september.getByRole('listitem').filter({ hasText: 'Coffee out' })).toContainText(
      '−500 XP',
    )
    await expect(
      september.getByRole('listitem').filter({ hasText: '30 min gaming' }),
    ).toContainText('−300 XP')
    // Months run newest first, and inside one the newest purchase is on top.
    const august = page.getByRole('region', { name: 'August 2026' })
    await expect(august.getByRole('listitem')).toHaveText([
      /Movie night.*Refunded.*900 XP/,
      /Order takeout.*−1,500 XP/,
    ])
  })

  test('History and Badges are tabs of the same page, and an empty history says so', async ({
    page,
  }) => {
    await openShop(page, 1260)
    await page.getByRole('tab', { name: 'History' }).click()
    await expect(page.getByRole('heading', { name: 'Nothing redeemed yet' })).toBeVisible()
    await page.getByRole('button', { name: 'Browse the shop' }).click()
    await expect(page).toHaveURL(/\/rewards\/shop$/)
    await expect(rewardRows(page)).toHaveCount(3)

    await page.getByRole('tab', { name: 'Badges' }).click()
    await expect(page).toHaveURL(/\/rewards\/badges$/)
    await expect(page.getByRole('tab', { name: 'Badges' })).toHaveAttribute('aria-selected', 'true')
  })

  test('works on a phone: no sideways scroll, every button reachable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openShop(page, 1260)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(page.getByRole('button', { name: 'Redeem Coffee out for 500 XP' })).toBeVisible()
    await page.getByRole('button', { name: 'New reward' }).click()
    await expect(page.getByRole('textbox', { name: 'Price in XP' })).toBeVisible()
    const after = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(after).toBeLessThanOrEqual(0)
  })
})
