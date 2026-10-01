import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'
import { putRows, readTable } from './idb'
import { contextCount, layerCount, musicCount, recordAudio, removeAudio } from './support/fakeAudio'

/** The Sound panel on the Focus page and the mini player, on a recording Web Audio. */
const panel = (page: Page) => page.getByRole('region', { name: 'Sound' })
/** The panel's play toggle: says Pause while sound plays. */
const playButton = (page: Page) => panel(page).getByRole('button', { name: /^(Play|Pause)$/ })
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
    await expect(header(page, 'Mixes')).toContainText('None saved')

    await setTo(page, 'Rain', 40)
    await setTo(page, 'Campfire', 25)
    await playButton(page).click()
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
    await playButton(page).click()
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
    await expect(playButton(page)).toHaveAccessibleName('Pause')
    await expect.poll(() => musicCount(page)).toBe(1)
    const mini = player(page).getByRole('button', { name: 'Play sound' })
    await expect(mini).toHaveAttribute('aria-pressed', 'true')
    await playButton(page).click()
    await expect(playButton(page)).toHaveAccessibleName('Play')
    await expect(playButton(page)).not.toHaveAttribute('aria-pressed')
    await expect(mini).toHaveAttribute('aria-pressed', 'false')
  })

  test('saves a mix, restores it from its chip, deletes with Undo', async ({ page }) => {
    await gotoApp(page, '/focus', 'empty')
    await header(page, 'Lofi').click()
    await panel(page)
      .getByRole('radio', { name: /Tokyo night/ })
      .click()
    await setTo(page, 'Rain', 40)
    await header(page, 'Mixes').click()
    await panel(page).getByRole('button', { name: 'Save current mix…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save current mix' })
    await dialog.getByRole('textbox', { name: 'Name' }).fill('Rainy Tokyo')
    await dialog.getByRole('button', { name: 'Save' }).click()
    const chip = panel(page).getByRole('button', { name: 'Rainy Tokyo', exact: true })
    await expect(chip).toBeVisible()
    await expect(header(page, 'Mixes')).toContainText('1 saved')

    await panel(page)
      .getByRole('radio', { name: /Jazz hop/ })
      .click()
    await setTo(page, 'Rain', 0)
    await setTo(page, 'Wind', 70)
    await setTo(page, 'Master volume', 50)
    await chip.click()
    await expect(header(page, 'Lofi')).toContainText('Tokyo night · 60%')
    await expect(header(page, 'Sounds')).toContainText('Rain 40%')
    await expect(slider(page, 'Wind')).toHaveValue('0')
    await expect(slider(page, 'Master volume')).toHaveValue('100')

    await panel(page).getByRole('button', { name: 'Rainy Tokyo options' }).click()
    await page.getByRole('menuitem', { name: 'Rename…' }).click()
    const rename = page.getByRole('dialog', { name: 'Rename mix' })
    await rename.getByRole('textbox', { name: 'Name' }).fill('Tokyo rain')
    await rename.getByRole('button', { name: 'Save' }).click()
    await expect(panel(page).getByRole('button', { name: 'Tokyo rain', exact: true })).toBeVisible()

    await panel(page).getByRole('button', { name: 'Tokyo rain options' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(header(page, 'Mixes')).toContainText('None saved')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(panel(page).getByRole('button', { name: 'Tokyo rain', exact: true })).toBeVisible()
  })

  test('start with focus: a running focus session plays the mix, pausing it stops it', async ({
    page,
  }) => {
    await gotoApp(page, '/focus', 'empty')
    await setTo(page, 'Rain', 40)
    await expect(playButton(page)).toHaveAccessibleName('Play')
    const toggle = panel(page).getByRole('switch', { name: 'Start sound with focus' })
    await expect(toggle).toBeChecked()
    await expect.poll(() => layerCount(page)).toBe(0)

    await page.getByTestId('timer-start').click()
    await expect(page.getByTestId('timer-toggle')).toHaveText('Pause')
    await expect.poll(() => layerCount(page)).toBe(1)
    await page.getByTestId('timer-toggle').click()
    await expect(page.getByTestId('timer-toggle')).toHaveText('Resume')
    await expect.poll(() => layerCount(page)).toBe(0)

    await toggle.click() // off: a running session no longer starts sound
    await expect(toggle).not.toBeChecked()
    await page.getByTestId('timer-toggle').click()
    await expect(page.getByTestId('timer-toggle')).toHaveText('Pause')
    expect(await layerCount(page)).toBe(0)
  })

  test('Pause silences a with-focus session; panel and mini player say so; Play brings it back', async ({
    page,
  }) => {
    await gotoApp(page, '/focus', 'empty')
    await setTo(page, 'Rain', 40)
    await page.getByTestId('timer-start').click()
    await expect.poll(() => layerCount(page)).toBe(1)
    const mini = player(page).getByRole('button', { name: 'Play sound' })
    await expect(playButton(page)).toHaveAccessibleName('Pause')
    await expect(mini).toHaveAttribute('aria-pressed', 'true')

    await playButton(page).click()
    await expect.poll(() => layerCount(page)).toBe(0)
    await expect(playButton(page)).toHaveAccessibleName('Play')
    await expect(mini).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('timer-toggle')).toHaveText('Pause') // the session still runs

    await mini.click()
    await expect.poll(() => layerCount(page)).toBe(1)
    await expect(playButton(page)).toHaveAccessibleName('Pause')
  })

  test('Play with nothing in the mix plays brown noise at 40%', async ({ page }) => {
    await gotoApp(page, '/focus', 'empty')
    await playButton(page).click()
    await expect(header(page, 'Sounds')).toContainText('Noise 40%')
    await expect.poll(() => layerCount(page)).toBe(1)
    await expect(playButton(page)).toHaveAccessibleName('Pause')
  })

  test('a second tab of the same browser does not make sound', async ({ page, context }) => {
    await gotoApp(page, '/focus', 'empty')
    await setTo(page, 'Rain', 40)
    await playButton(page).click()
    await expect.poll(() => layerCount(page)).toBe(1)

    const second = await context.newPage()
    await recordAudio(second)
    await gotoApp(second, '/focus')
    await expect(header(second, 'Sounds')).toContainText('Rain 40%')
    await expect(playButton(second)).toHaveAccessibleName('Pause')
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
