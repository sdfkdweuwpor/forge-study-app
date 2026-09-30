import { writeFileSync } from 'node:fs'
import { expect, gotoApp, test } from './fixtures'

const OUT = '/tmp/claude-0/-home-user-forge-study-app/37c45e23-70d5-52b0-8a01-75a3e8d32e47/scratchpad/debug.txt'

test('debug tabs focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoApp(page, '/rewards', 'wgu')
  await expect(page.locator('main h1').first()).toBeVisible()
  const lines: string[] = []
  const tabs = page.getByRole('tablist')
  await tabs.getByRole('tab').first().focus()
  for (const k of ['ArrowRight', 'ArrowRight', 'End', 'Home']) {
    await page.keyboard.press(k)
    await page.waitForTimeout(700)
    lines.push(
      `${k}: ` +
        (await page.evaluate(() => {
          const a = document.activeElement
          return `active=${a?.tagName}[${a?.getAttribute('role') ?? ''}] "${(a?.textContent ?? '').trim().slice(0, 30)}" url=${location.pathname} selected=${Array.from(document.querySelectorAll('[role=tab][aria-selected=true]')).map((t) => t.textContent).join('|')}`
        })),
    )
  }
  writeFileSync(OUT, lines.join('\n'))
})
