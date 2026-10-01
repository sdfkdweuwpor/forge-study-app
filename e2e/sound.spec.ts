import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'
import { putRows, readTable } from './idb'
import { contextCount, layerCount, musicCount, recordAudio, removeAudio } from './support/fakeAudio'

/** The Sound panel on the Focus page and the mini player, on a recording Web Audio. */
const panel = (page: Page) => page.getByRole('region', { name: 'Sound' })
const player = (page: Page) => page.getByRole('group', { name: 'Sound player' })
const header = (page: Page, title: string) => panel(page).locator('summary', { hasText: title })
const slider = (page: Page, name: string) => panel(page).getByRole('slider', { name, exact: true })

/** Moves a slider to `percent` with the keyboard (steps of 5). */
async function setTo(page: Page, name: string, percent: number): Promise<void> {
  const s = slider(page, name)
  await s.focus()
  await s.press('Home')
  for (let i = 0; i < percent / 5; i++) await s.press('ArrowRight')
  await expect(s).toHaveValue(String(percent))
}

test.describe('sound panel and mini player', () => {
  test.beforeEach(async ({ page }) => {
    await recordAudio(page)
  })

  test('mixes layers, collapses, pauses and resumes from the mini player on another page', async ({
    page,
  }) => {
    await gotoApp(page, '/focus', 'empty')
    await expect(header(page, 'Sounds')).toHaveAttribute('aria-expanded', 'true')
    await expect(panel(page).getByRole('slider')).toHaveCount(10) // master + 9 layers
    for (const name of [
      'Rain',
      'Heavy rain & thunder',
      'Wind',
      'Campfire',
      'Café chatter',
      'Ocean waves',
      'Forest birds',
      'Creek',
      'Noise',
    ])
      await expect(slider(page, name)).toBeVisible()
    await expect(panel(page).locator('[aria-disabled="true"]', { hasText: 'Mixes' })).toBeVisible()

    await panel(page).getByRole('button', { name: 'Play' }).click()
    await setTo(page, 'Rain', 40)
    await setTo(page, 'Campfire', 25)
    await expect(header(page, 'Sounds')).toContainText('Rain 40% · Campfire 25%')
    await expect.poll(() => layerCount(page)).toBe(2)

    await header(page, 'Sounds').click()
    await expect(header(page, 'Sounds')).toHaveAttribute('aria-expanded', 'false')
    await expect(header(page, 'Sounds')).toContainText('Rain 40% · Campfire 25%')

    await player(page).getByRole('button', { name: 'Play sound' }).click()
    await expect(player(page).getByRole('button', { name: 'Play sound' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect.poll(() => layerCount(page)).toBe(0)

    await page.goto('/tasks')
    await expect(player(page)).toContainText('Sounds')
    await player(page).getByRole('button', { name: 'Play sound' }).click()
    await expect.poll(() => layerCount(page)).toBe(2)
  })

  test('Lofi expands to ten styles; one tap plays, arrows move, Off stops music but not Rain', async ({
    page,
  }) => {
    await gotoApp(page, '/focus', 'empty')
    await expect(header(page, 'Lofi')).toHaveAttribute('aria-expanded', 'false')
    await expect(header(page, 'Lofi')).toContainText('Off')
    await header(page, 'Lofi').click()
    await expect(header(page, 'Lofi')).toHaveAttribute('aria-expanded', 'true')
    const styles = panel(page).getByRole('radiogroup', { name: 'Lofi style' })
    await expect(styles.getByRole('radio')).toHaveCount(10)
    await expect(styles.getByRole('radio', { name: /Tokyo night/ })).toContainText('neon')

    await setTo(page, 'Rain', 30)
    await panel(page).getByRole('button', { name: 'Play' }).click()
    await expect.poll(() => layerCount(page)).toBe(1)
    expect(await musicCount(page)).toBe(0)

    await styles.getByRole('radio', { name: /Tokyo night/ }).click()
    await expect(header(page, 'Lofi')).toContainText('Tokyo night · 60%')
    await expect.poll(() => musicCount(page)).toBe(1)
    await expect(player(page)).toContainText('Tokyo night')

    await styles.getByRole('radio', { name: /Tokyo night/ }).press('ArrowRight')
    await expect(styles.getByRole('radio', { name: /Synthwave/ })).toBeChecked()
    await expect(header(page, 'Lofi')).toContainText('Synthwave · 60%')

    await setTo(page, 'Music volume', 35)
    await expect(header(page, 'Lofi')).toContainText('Synthwave · 35%')

    await panel(page).getByRole('button', { name: 'Off', exact: true }).click()
    await expect(header(page, 'Lofi')).toContainText('Off')
    await expect.poll(() => musicCount(page)).toBe(0)
    expect(await layerCount(page)).toBe(1)
  })

  test('choosing a style while sound is off starts playing', async ({ page }) => {
    await gotoApp(page, '/focus', 'empty')
    await header(page, 'Lofi').click()
    await panel(page)
      .getByRole('radio', { name: /Jazz hop/ })
      .click()
    await expect(panel(page).getByRole('button', { name: 'Play' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect.poll(() => musicCount(page)).toBe(1)
  })

  test('a second tab of the same browser does not make sound', async ({ page, context }) => {
    await gotoApp(page, '/focus', 'empty')
    await panel(page).getByRole('button', { name: 'Play' }).click()
    await setTo(page, 'Rain', 40)
    await expect.poll(() => layerCount(page)).toBe(1)

    const second = await context.newPage()
    await recordAudio(second)
    await gotoApp(second, '/focus')
    await expect(header(second, 'Sounds')).toContainText('Rain 40%')
    await expect(panel(second).getByRole('button', { name: 'Play' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(await layerCount(second)).toBe(0)
    expect(await contextCount(second)).toBe(0)
  })

  test('an old single-ambient row shows as one layer', async ({ page }) => {
    await gotoApp(page, '/focus', 'empty')
    const [row] = await readTable<{ sound: Record<string, unknown> }>(page, 'settings')
    if (!row) throw new Error('no settings row')
    await putRows(page, 'settings', [
      { ...row, sound: { ...row.sound, ambient: 'rain', ambientVolume: 0.3, mixer: undefined } },
    ])
    await page.reload()
    await expect(slider(page, 'Rain')).toHaveValue('30')
    await expect(header(page, 'Sounds')).toContainText('Rain 30%')
    await expect(panel(page)).not.toContainText('Campfire 25%')
  })
})

test('without Web Audio the panel says so and the mini player is hidden', async ({ page }) => {
  await removeAudio(page)
  await gotoApp(page, '/focus', 'empty')
  await expect(panel(page)).toContainText(/Sound isn.t available in this browser/)
  await expect(player(page)).toHaveCount(0)
})

test.describe('phone pill', () => {
  test.use({ viewport: { width: 375, height: 700 } })

  async function startPlaying(page: Page): Promise<void> {
    await gotoApp(page, '/focus', 'wgu')
    const [row] = await readTable<{ sound: Record<string, unknown> }>(page, 'settings')
    if (!row) throw new Error('no settings row')
    await putRows(page, 'settings', [
      {
        ...row,
        sound: {
          ...row.sound,
          mixer: {
            layers: { rain: 0.4 },
            master: 1,
            noiseColor: 'brown',
            withFocus: true,
            presets: [],
          },
          device: { playing: true, open: { lofi: false, sounds: true, mixes: false } },
        },
      },
    ])
  }

  test('shows only while sound plays, and Tab never lands under it', async ({ page }) => {
    await recordAudio(page)
    await gotoApp(page, '/tasks', 'wgu')
    await expect(player(page)).toHaveCount(0)

    await startPlaying(page)
    await page.goto('/tasks')
    await expect(player(page)).toBeVisible()

    const box = await player(page).boundingBox()
    // Focus the last control on the long page the way Tab would (the browser scrolls it into view).
    const bottom = await page.evaluate(() => {
      const els = [
        ...Array.from(
          document.querySelectorAll<HTMLElement>(
            'main a[href], main button:not([disabled]), main input:not([disabled]), main [tabindex="0"]',
          ),
        ),
      ]
      const last = els[els.length - 1]
      last?.focus()
      return last ? last.getBoundingClientRect().bottom : -1
    })
    expect(box).not.toBeNull()
    expect(bottom).toBeGreaterThan(0)
    // Re-measure after the scroll the focus caused.
    const after = await page.evaluate(
      () => document.activeElement?.getBoundingClientRect().bottom ?? -1,
    )
    const pillTop = (await player(page).boundingBox())?.y ?? 0
    expect(after).toBeLessThanOrEqual(pillTop)
  })
})
