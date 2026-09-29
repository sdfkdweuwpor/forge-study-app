import { gotoApp, test } from './fixtures'

test('motion frames', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 })
  await gotoApp(page, '/tasks/inbox', 'wgu')
  await page.locator('main ul li').first().waitFor()
  const row = page.locator('main ul li', { hasText: 'Email mentor' })
  await row.getByRole('checkbox').click()
  const clip = { x: 380, y: 320, width: 920, height: 160 }
  for (const [name, ms] of [['a', 120], ['b', 380], ['c', 700], ['d', 1000], ['e', 1300]] as const) {
    await page.waitForTimeout(ms === 120 ? 120 : ms - (name === 'b' ? 120 : name === 'c' ? 380 : name === 'd' ? 700 : 1000))
    await page.screenshot({ path: `/tmp/claude-0/scratch/motion-${name}.png`, clip })
  }
})

test('reduced motion frames', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 700 })
  await gotoApp(page, '/tasks/inbox', 'wgu')
  await page.locator('main ul li').first().waitFor()
  const row = page.locator('main ul li', { hasText: 'Email mentor' })
  await row.getByRole('checkbox').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `/tmp/claude-0/scratch/rm-a.png`, clip: { x: 380, y: 320, width: 920, height: 160 } })
  await page.waitForTimeout(650)
  await page.screenshot({ path: `/tmp/claude-0/scratch/rm-b.png`, clip: { x: 380, y: 320, width: 920, height: 160 } })
})
