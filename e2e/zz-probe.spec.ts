import { FIXED_NOW, expect, gotoApp, test } from './fixtures'

test('probe pauseAt', async ({ page }) => {
  await gotoApp(page, '/', 'empty')
  const a = await page.evaluate(() => [performance.now(), Date.now()])
  await page.clock.pauseAt(new Date(FIXED_NOW.getTime() + 500))
  const b = await page.evaluate(() => [performance.now(), Date.now()])
  await page.waitForTimeout(300)
  const c = await page.evaluate(() => [performance.now(), Date.now()])
  await page.clock.runFor(200)
  const d = await page.evaluate(() => [performance.now(), Date.now()])
  expect(JSON.stringify({ a, b, c, d })).toBe('')
})
