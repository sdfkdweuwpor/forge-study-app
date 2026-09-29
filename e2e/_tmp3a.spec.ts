import { expect, gotoApp, test } from './fixtures'

const rows = (page: import('@playwright/test').Page) => page.locator('main ul li')
const rowOf = (page: import('@playwright/test').Page, title: string) =>
  page.locator('main ul li', { hasText: title })


test('complete: checkbox, strike, XP float, slide out, undo toast', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoApp(page, '/tasks/inbox', 'wgu')
  await rows(page).first().waitFor()
  const row = rowOf(page, 'Renew library card')
  await row.getByRole('checkbox').check()
  await expect(page.getByText('+10 XP').first()).toBeVisible({ timeout: 2000 })
  await expect(page.getByText(/Completed “Renew library card”/)).toBeVisible()
  await expect(rowOf(page, 'Renew library card')).toHaveCount(0, { timeout: 4000 })
  // Undo brings it back and nets XP to zero
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(rowOf(page, 'Renew library card')).toHaveCount(1)
  await expect(rowOf(page, 'Renew library card').getByRole('checkbox')).not.toBeChecked()
})

test('keyboard: j/k, x, priority, t/m, e edit, alt+down, mod+backspace', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoApp(page, '/tasks/inbox', 'wgu')
  await rows(page).first().waitFor()
  await page.keyboard.press('j')
  await expect(page.locator('[data-selected]')).toHaveCount(1)
  await expect(rows(page).first().locator('[data-selected]')).toHaveCount(1)
  await page.keyboard.press('j')
  await expect(rows(page).nth(1).locator('[data-selected]')).toHaveCount(1)
  await page.keyboard.press('k')
  await expect(rows(page).first().locator('[data-selected]')).toHaveCount(1)

  // priority 4 on the first row
  await page.keyboard.press('4')
  await expect(rowOf(page, 'Reply to Financial Aid').getByRole('img', { name: 'Priority: Urgent' })).toBeVisible()
  // due tomorrow: the row moves to the Tomorrow group and stays selected
  await page.keyboard.press('m')
  await expect(rowOf(page, 'Reply to Financial Aid').getByText('Tomorrow')).toBeVisible()
  await expect(rowOf(page, 'Reply to Financial Aid').locator('[data-selected]')).toHaveCount(1)
  // edit title
  await page.keyboard.press('e')
  const input = page.getByRole('textbox', { name: 'Task title' })
  await expect(input).toBeFocused()
  await page.keyboard.type(' (edited)')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /disbursement \(edited\)\. Edit/ })).toBeVisible()
  // esc reverts
  await page.keyboard.press('e')
  await page.keyboard.type(' XXX')
  await page.keyboard.press('Escape')
  await expect(page.getByText('XXX')).toHaveCount(0)

  // complete with x moves selection to next
  await page.keyboard.press('x')
  await expect(page.getByText(/Completed “/)).toBeVisible()
  // trash with mod+backspace
  await page.keyboard.press('Control+Backspace')
  await expect(page.getByText(/to the trash/)).toBeVisible()
})

test('reorder with alt+arrow and drag handle keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoApp(page, '/tasks/all', 'wgu')
  await rows(page).first().waitFor()
  const titles = async () => page.locator('main ul li [class*="_display_"]').allInnerTexts()
  const before = await titles()
  expect(before[0]).toContain('C779 · Unit 2')
  await page.keyboard.press('j')
  await page.keyboard.press('Alt+ArrowDown')
  await expect.poll(async () => (await titles())[0]).toContain('Reply to Financial Aid')
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(async () => (await titles())[0]).toContain('C779 · Unit 2')

  // dnd-kit keyboard: focus the handle of row 1, space, down, space
  await rows(page).first().hover()
  const grip = rows(page).first().getByRole('button', { name: /^Reorder / })
  await grip.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await expect.poll(async () => (await titles())[0]).toContain('Reply to Financial Aid')
})

test('peek: click opens, esc closes, edit fields, page link', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoApp(page, '/tasks/inbox', 'wgu')
  await rows(page).first().waitFor()
  await rowOf(page, 'Email mentor').getByRole('button', { name: /^Open / }).click({ position: { x: 300, y: 10 }, force: true })
  await expect(page.getByLabel('Task details')).toBeVisible()
  await expect(page).toHaveURL(/peek=task-email-mentor/)
  await expect(page.getByLabel('Task details').getByRole('heading', { level: 2 })).toHaveText('Email mentor about term plan')
  // status -> doing
  await page.getByLabel('Task details').getByRole('radio', { name: 'Doing' }).click()
  await expect(rowOf(page, 'Email mentor').getByText('Doing')).toBeVisible()
  // add subtask
  await page.getByLabel('Task details').getByLabel('Add a subtask').fill('Draft the email')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Task details').getByText('Draft the email')).toBeVisible()
  await expect(rowOf(page, 'Email mentor').getByText('0/1')).toBeVisible()
  // tag
  await page.getByLabel('Task details').getByLabel('Add a tag').fill('planning')
  await page.keyboard.press('Enter')
  await expect(rowOf(page, 'Email mentor').getByText('planning')).toBeVisible()
  // esc closes
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Task details')).toHaveCount(0)
  await expect(page).not.toHaveURL(/peek=/)
})

test('filters: priority narrows list and lives in the URL', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoApp(page, '/tasks/all', 'wgu')
  await rows(page).first().waitFor()
  await page.getByRole('button', { name: 'Priority', exact: true }).click()
  await page.getByRole('checkbox', { name: /High/ }).check()
  await expect(page).toHaveURL(/priority=3/)
  await expect(rows(page)).toHaveCount(2)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(rows(page).first()).toBeVisible()
  expect(await rows(page).count()).toBeGreaterThan(15)
})

test('recurring: completing creates the next instance', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoApp(page, '/tasks/all', 'wgu')
  await rows(page).first().waitFor()
  await rowOf(page, 'Weekly review').getByRole('checkbox').click()
  await expect(page.getByText(/Next: Oct 11/)).toBeVisible()
  // the next Sunday instance is Oct 11 (Oct 4 + 7)
  await expect(rowOf(page, 'Weekly review')).toHaveCount(1, { timeout: 5000 })
  await expect(rowOf(page, 'Weekly review').getByText(/Oct 11|Sunday/)).toBeVisible()
})

test('task page and missing task', async ({ page }) => {
  await gotoApp(page, '/task/task-email-mentor', 'wgu')
  await expect(page.locator('main h1')).toHaveText('Email mentor about term plan')
  await page.keyboard.press('3')
  await expect(page.getByRole('radio', { name: 'High' })).toBeChecked()
  await page.goto('/task/nope')
  await expect(page.locator('main h1')).toHaveText('Task not found')
})

test('mobile: tap opens the task page', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await gotoApp(page, '/tasks/inbox', 'wgu')
  await rows(page).first().waitFor()
  await rowOf(page, 'Email mentor').getByRole('button', { name: /^Open / }).click({ force: true })
  await expect(page).toHaveURL(/\/task\/task-email-mentor/)
})
