import type { Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'
import { putRows, putRowsWhileClosed, readTable } from './idb'

/**
 * Phase 10A: the first-launch flow. These specs turn the fixture's gate bypass off (`skipOnboarding:
 * false`), so a fresh database with no `?seed=` really is a first launch. The clock is fixed at Tue
 * 2026-09-29 09:30, so "today" is 2026-09-29 and "tomorrow" 2026-09-30.
 */
test.use({ skipOnboarding: false })

interface TaskRow {
  id: string
  title: string
  source: string
  doDate: string | null
  status: string
}
interface BlockRow {
  domain: string
  kind: string
  enabled: boolean
}
interface SettingsRow {
  onboardedAt: number | null
  dailyGoalPomodoros: number
  profile: { name: string }
}

const heading = (page: Page, name: string | RegExp) => page.getByRole('heading', { level: 1, name })
const next = (page: Page) => page.getByRole('button', { name: 'Continue', exact: true })
const chip = (page: Page, domain: string) => page.getByRole('button', { name: domain, exact: true })
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })

const settings = async (page: Page): Promise<SettingsRow> => {
  const rows = await readTable<SettingsRow>(page, 'settings')
  const row = rows[0]
  if (!row) throw new Error('no settings row')
  return row
}

/** Steps 1 to 3 with their defaults; leaves the extension step on screen. */
async function toExtensionStep(page: Page): Promise<void> {
  await next(page).click()
  await expect(heading(page, 'Which sites pull you away?')).toBeVisible()
  await next(page).click()
  await expect(heading(page, 'Got a goal in mind?')).toBeVisible()
  await next(page).click()
  await expect(heading(page, 'Block distractions for real')).toBeVisible()
}

test.describe('first launch', () => {
  test('a fresh database opens the welcome page, without the sidebar', async ({ page }) => {
    await gotoApp(page, '/')
    await expect(page).toHaveURL(/\/welcome$/)
    await expect(heading(page, 'What should we call you?')).toBeVisible()
    await expect(page.getByText('Step 1 of 4 · About you')).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute(
      'aria-valuetext',
      'Step 1 of 4: About you',
    )
    await expect(page.getByRole('button', { name: 'Skip setup' })).toBeVisible()
    // Full page: no sidebar to search from.
    await expect(page.getByRole('button', { name: 'Search and commands' })).toHaveCount(0)
    await expect(page).toHaveTitle('Welcome · Forge')
  })

  test('any other address goes to the welcome page too', async ({ page }) => {
    await gotoApp(page, '/tasks/inbox')
    await expect(page).toHaveURL(/\/welcome$/)
    await expect(heading(page, 'What should we call you?')).toBeVisible()
  })

  test('all four steps: name, sites, goal, extension, then Today with three starter tasks', async ({
    page,
  }) => {
    await gotoApp(page, '/')

    // 1. Name and daily goal.
    await expect(page.getByLabel('Your name')).toBeFocused()
    await expect(page.getByTestId('focus-hint')).toHaveText('≈ 2.5 h of focus')
    await page.getByLabel('Your name').fill('Maya')
    const goal = page.getByRole('spinbutton', { name: 'Pomodoros per day' })
    await expect(goal).toHaveText('6')
    await page.getByRole('button', { name: 'More pomodoros' }).click()
    await page.getByRole('button', { name: 'More pomodoros' }).click()
    await expect(goal).toHaveText('8')
    await expect(page.getByTestId('focus-hint')).toHaveText('≈ 3.3 h of focus')
    await next(page).click()

    // 2. Distracting sites: the 11 defaults, all picked. Drop two, add one, refuse a repeat.
    await expect(heading(page, 'Which sites pull you away?')).toBeVisible()
    await expect(page.getByText('Step 2 of 4 · Distractions')).toBeVisible()
    await expect(
      page.getByRole('group', { name: 'Sites to block' }).getByRole('button'),
    ).toHaveCount(11)
    await expect(page.getByText('11 of 11 sites will be blocked while you focus.')).toBeVisible()
    await chip(page, 'twitch.tv').click()
    await chip(page, 'pinterest.com').click()
    await expect(chip(page, 'twitch.tv')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('9 of 11 sites will be blocked while you focus.')).toBeVisible()
    const add = page.getByRole('textbox', { name: 'Site to add' })
    await add.fill('instagram.com')
    await add.press('Enter')
    await expect(page.getByText('instagram.com is already on the list.')).toBeVisible()
    // Enter in the field adds; it does not move on to the next step.
    await expect(heading(page, 'Which sites pull you away?')).toBeVisible()
    await add.fill('https://www.discord.com/channels/1')
    await add.press('Enter')
    await expect(chip(page, 'discord.com')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('10 of 12 sites will be blocked while you focus.')).toBeVisible()
    await next(page).click()

    // 3. First goal: "Not now" is the quiet default.
    await expect(heading(page, 'Got a goal in mind?')).toBeVisible()
    await expect(page.getByRole('radio', { name: /Not now/ })).toBeChecked()
    await expect(page.getByRole('radio', { name: /Plan a WGU term/ })).not.toBeChecked()
    await expect(page.getByRole('radio', { name: /Plan another goal/ })).not.toBeChecked()
    await next(page).click()

    // 4. Extension: no extension in this browser, so the install steps show.
    await expect(heading(page, 'Block distractions for real')).toBeVisible()
    await expect(page.getByTestId('extension-status')).toHaveText('Not installed yet')
    await expect(page.getByRole('link', { name: 'Download the extension' })).toHaveAttribute(
      'href',
      /forge-extension\.zip$/,
    )
    await expect(page.getByText('Switch on Developer mode (top right).')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Screen Time on iPhone' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Digital Wellbeing on Android' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'I’ll do it later' })).toBeVisible()
    await page.getByRole('button', { name: 'Finish setup' }).click()

    // Today, with a warm toast and the two starter tasks planned for today.
    await expect(page).toHaveURL(/\/$/)
    await expect(heading(page, /Maya/)).toBeVisible()
    await expect(toasts(page).getByText('You’re all set, Maya')).toBeVisible()
    await expect(toasts(page).getByText('Three starter tasks are waiting on Today.')).toBeVisible()
    await expect(page.getByText('Take a 25-minute focus session').first()).toBeVisible()
    await expect(page.getByText('Add your first real task with Q').first()).toBeVisible()

    // What was saved.
    const tasks = await readTable<TaskRow>(page, 'tasks')
    expect(tasks.map((t) => [t.title, t.source, t.doDate, t.status]).sort()).toEqual([
      ['Add your first real task with Q', 'onboarding', '2026-09-29', 'todo'],
      ['Look around My World', 'onboarding', '2026-09-30', 'todo'],
      ['Take a 25-minute focus session', 'onboarding', '2026-09-29', 'todo'],
    ])
    const rows = (await readTable<BlockRow>(page, 'blocklist')).filter((r) => r.kind === 'block')
    const domains = rows.filter((r) => r.enabled).map((r) => r.domain)
    expect(domains).toHaveLength(10)
    expect(domains).toContain('discord.com')
    expect(domains).not.toContain('twitch.tv')
    expect(domains).not.toContain('pinterest.com')
    const saved = await settings(page)
    expect(saved.profile.name).toBe('Maya')
    expect(saved.dailyGoalPomodoros).toBe(8)
    expect(saved.onboardedAt).not.toBeNull()

    // It is over: a reload stays on Today, and the list is the one that was chosen.
    await page.reload()
    await expect(page).toHaveURL(/\/$/)
    await expect(heading(page, /Maya/)).toBeVisible()
    await page.goto('/blocker')
    await expect(page.getByText('discord.com', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('twitch.tv', { exact: true })).toHaveCount(0)
  })

  test('the keyboard does it all: Enter, Alt+arrows, and the arrow keys on the stepper and goals', async ({
    page,
  }) => {
    await gotoApp(page, '/welcome')
    await page.getByLabel('Your name').fill('Sam')
    await page.getByRole('spinbutton', { name: 'Pomodoros per day' }).focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('spinbutton', { name: 'Pomodoros per day' })).toHaveText('7')
    // Enter in the name field continues.
    await page.getByLabel('Your name').press('Enter')
    await expect(heading(page, 'Which sites pull you away?')).toBeVisible()
    // Alt+Left goes back, and what was typed is still there.
    await page.keyboard.press('Alt+ArrowLeft')
    await expect(heading(page, 'What should we call you?')).toBeVisible()
    await expect(page.getByLabel('Your name')).toHaveValue('Sam')
    await page.keyboard.press('Alt+ArrowRight')
    await expect(heading(page, 'Which sites pull you away?')).toBeVisible()
    // Alt+Shift+Right skips the step without saving it.
    await chip(page, 'reddit.com').click()
    await page.keyboard.press('Alt+Shift+ArrowRight')
    await expect(heading(page, 'Got a goal in mind?')).toBeVisible()
    await page.getByRole('radio', { name: /Not now/ }).focus()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('radio', { name: /Plan another goal/ })).toBeChecked()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('radio', { name: /Not now/ })).toBeChecked()
    await page.keyboard.press('Alt+ArrowRight')
    await expect(heading(page, 'Block distractions for real')).toBeVisible()
    await page.keyboard.press('Alt+ArrowRight')
    await expect(page).toHaveURL(/\/$/)
    await expect(heading(page, /Sam/)).toBeVisible()

    // The name and goal from step 1 were saved; the skipped step 2 saved nothing (reddit.com is still blocked).
    const saved = await settings(page)
    expect(saved.profile.name).toBe('Sam')
    expect(saved.dailyGoalPomodoros).toBe(7)
    const rows = await readTable<BlockRow>(page, 'blocklist')
    expect(rows.find((r) => r.domain === 'reddit.com')?.enabled).toBe(true)
  })

  test('"Skip setup" leaves at once: Today, nothing added, defaults kept', async ({ page }) => {
    await gotoApp(page, '/')
    await expect(heading(page, 'What should we call you?')).toBeVisible()
    await page.getByRole('button', { name: 'Skip setup' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('A clear day to plan')).toBeVisible()
    await expect(toasts(page).getByText('Setup skipped')).toBeVisible()

    expect(await readTable<TaskRow>(page, 'tasks')).toHaveLength(0)
    expect((await settings(page)).onboardedAt).not.toBeNull()
    const rows = await readTable<BlockRow>(page, 'blocklist')
    expect(rows.filter((r) => r.kind === 'block' && r.enabled)).toHaveLength(11)

    // Skipped is done: a reload and another address both stay in the app.
    await page.reload()
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/tasks/inbox')
    await expect(page).toHaveURL(/\/tasks\/inbox$/)
  })

  test('Skip setup is on every step', async ({ page }) => {
    await gotoApp(page, '/welcome')
    await next(page).click()
    await next(page).click()
    await expect(heading(page, 'Got a goal in mind?')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Skip setup' })).toBeVisible()
    await page.keyboard.press('Alt+Shift+S')
    await expect(page).toHaveURL(/\/$/)
    expect(await readTable<TaskRow>(page, 'tasks')).toHaveLength(0)
  })

  test('"Skip this step" saves nothing from that step', async ({ page }) => {
    await gotoApp(page, '/welcome')
    await page.getByLabel('Your name').fill('Ignored')
    await page.getByRole('button', { name: 'Skip this step' }).click()
    await expect(heading(page, 'Which sites pull you away?')).toBeVisible()
    await chip(page, 'netflix.com').click()
    await page.getByRole('button', { name: 'Skip this step' }).click()
    await page.getByRole('button', { name: 'Skip this step' }).click()
    await page.getByRole('button', { name: 'I’ll do it later' }).click()
    await expect(page).toHaveURL(/\/$/)
    expect((await settings(page)).profile.name).toBe('')
    const rows = await readTable<BlockRow>(page, 'blocklist')
    expect(rows.find((r) => r.domain === 'netflix.com')?.enabled).toBe(true)
    // Finishing still leaves the starter tasks.
    expect(await readTable<TaskRow>(page, 'tasks')).toHaveLength(3)
  })

  test('"Plan a WGU term" finishes onboarding and opens the planner with the template chosen', async ({
    page,
  }) => {
    await gotoApp(page, '/welcome')
    await toExtensionStepWithChoice(page, /Plan a WGU term/)
    await page.getByRole('button', { name: 'Finish setup' }).click()
    await expect(page).toHaveURL(/\/goals\/new$/)
    await expect(toasts(page).getByText('Now let’s plan your WGU term.')).toBeVisible()
    await expect(page.getByRole('button', { name: /WGU term/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The planner has the template's courses, and the address no longer carries the param.
    await expect(page.getByText(/7 courses/).first()).toBeVisible()
    expect(new URL(page.url()).search).toBe('')
    expect((await settings(page)).onboardedAt).not.toBeNull()
    expect(await readTable<TaskRow>(page, 'tasks')).toHaveLength(3)
  })

  test('"Plan another goal" opens the planner blank', async ({ page }) => {
    await gotoApp(page, '/welcome')
    await toExtensionStepWithChoice(page, /Plan another goal/)
    await page.getByRole('button', { name: 'Finish setup' }).click()
    await expect(page).toHaveURL(/\/goals\/new$/)
    await expect(heading(page, 'What are you planning?')).toBeVisible()
    for (const template of await page.getByRole('button', { name: /WGU term/ }).all()) {
      await expect(template).toHaveAttribute('aria-pressed', 'false')
    }
  })

  test('the planner takes ?template= from anywhere, and ignores unknown values', async ({
    page,
  }) => {
    await gotoApp(page, '/goals/new?template=certification', 'empty')
    await expect(page.getByRole('button', { name: /Certification/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(new URL(page.url()).search).toBe('')
    await gotoApp(page, '/goals/new?template=nonsense', 'empty')
    await expect(heading(page, 'What are you planning?')).toBeVisible()
    await expect(page.getByRole('button', { name: /WGU term/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

async function toExtensionStepWithChoice(page: Page, choice: RegExp): Promise<void> {
  await next(page).click()
  await next(page).click()
  await page.getByRole('radio', { name: choice }).check()
  await next(page).click()
  await expect(heading(page, 'Block distractions for real')).toBeVisible()
}

test.describe('people who are not new', () => {
  test('seeded sample data never shows onboarding', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await expect(page).toHaveURL(/\/$/)
    await expect(heading(page, /Good morning/)).toBeVisible()
    await expect(page.getByText('C779 · Unit 3: CSS layout (45 min)').first()).toBeVisible()
    expect((await settings(page)).onboardedAt).not.toBeNull()
    await page.reload()
    await expect(page).toHaveURL(/\/$/)
  })

  test('an empty seed is a finished setup too', async ({ page }) => {
    await gotoApp(page, '/', 'empty')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('A clear day to plan')).toBeVisible()
  })

  test('someone with data who never onboarded is marked done, and never sees the flow', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    const row = await settings(page)
    // Written while the app is closed: an open app could mark it done before the check below.
    await putRowsWhileClosed(page, 'settings', [{ ...row, onboardedAt: null }])
    expect((await settings(page)).onboardedAt).toBeNull()

    await page.goto('/tasks/inbox')
    await expect(page).toHaveURL(/\/tasks\/inbox$/)
    await expect(page.getByRole('button', { name: 'Search and commands' })).toBeVisible()
    await expect.poll(async () => (await settings(page)).onboardedAt).not.toBeNull()
  })
})

test.describe('replay', () => {
  test('"Replay onboarding" in the palette runs the flow again, without adding tasks', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    const before = await readTable<TaskRow>(page, 'tasks')
    const onboardedAt = (await settings(page)).onboardedAt

    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('replay')
    await page.getByRole('option', { name: /Replay onboarding/ }).click()
    await expect(page).toHaveURL(/\/welcome$/)
    await expect(heading(page, 'What should we call you?')).toBeVisible()

    await page.getByLabel('Your name').fill('Alex')
    await next(page).click()
    // The list shows what is on it now.
    await expect(chip(page, 'youtube.com')).toHaveAttribute('aria-pressed', 'true')
    await chip(page, 'youtube.com').click()
    await next(page).click()
    await next(page).click()
    await page.getByRole('button', { name: 'Finish setup' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(toasts(page).getByText('You’re all set, Alex')).toBeVisible()
    await expect(toasts(page).getByText('Your changes are saved.')).toBeVisible()

    expect(await readTable<TaskRow>(page, 'tasks')).toHaveLength(before.length)
    const after = await settings(page)
    expect(after.profile.name).toBe('Alex')
    expect(after.onboardedAt).toBe(onboardedAt)
    const rows = await readTable<BlockRow>(page, 'blocklist')
    expect(rows.find((r) => r.domain === 'youtube.com')).toBeUndefined()

    // The command hides while you are already there.
    await gotoApp(page, '/welcome')
    await expect(heading(page, 'What should we call you?')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox', { name: 'Command palette' }).fill('replay')
    await expect(page.getByRole('option', { name: /Replay onboarding/ })).toHaveCount(0)
    await page.getByRole('combobox', { name: 'Command palette' }).fill('skip setup')
    await expect(page.getByRole('option', { name: /Skip setup/ })).toBeVisible()
  })

  test('finishing twice never duplicates the starter tasks', async ({ page }) => {
    await gotoApp(page, '/welcome')
    await toExtensionStep(page)
    await page.getByRole('button', { name: 'Finish setup' }).click()
    await expect(page).toHaveURL(/\/$/)
    expect(await readTable<TaskRow>(page, 'tasks')).toHaveLength(3)

    // Even a first run started again by hand (the stored date wiped) adds nothing new.
    const row = await settings(page)
    await putRows(page, 'settings', [{ ...row, onboardedAt: null }])
    await page.goto('/welcome')
    await toExtensionStep(page)
    await page.getByRole('button', { name: 'Finish setup' }).click()
    await expect(page).toHaveURL(/\/$/)
    expect(await readTable<TaskRow>(page, 'tasks')).toHaveLength(3)
  })
})

test.describe('small screens', () => {
  test('a phone shows the flow without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await gotoApp(page, '/welcome')
    for (const title of [
      'What should we call you?',
      'Which sites pull you away?',
      'Got a goal in mind?',
      'Block distractions for real',
    ]) {
      await expect(heading(page, title)).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${title} scrolls sideways`).toBeLessThanOrEqual(0)
      if (title !== 'Block distractions for real') await next(page).click()
    }
    await expect(page.getByRole('button', { name: 'Skip setup' })).toBeVisible()
  })
})
