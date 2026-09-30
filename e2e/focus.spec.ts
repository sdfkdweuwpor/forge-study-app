import type { Page } from '@playwright/test'
import { FIXED_NOW, expect, gotoApp, test } from './fixtures'

/**
 * Phase 4C: the focus timer end to end, on the WGU sample data.
 *
 * The fixture's frozen clock would never let a running timer move, so these tests run on
 * `page.clock` instead: it starts at Tue 2026-09-29 09:30 (FIXED_NOW), flows in real time, and
 * `fastForward` jumps the page's `Date.now()` (the timer's worker only posts ticks; the page reads
 * the faked clock and recomputes everything from the session row). `openApp` pins the clock to
 * exactly 09:30:00 once the page has loaded, so a session started next begins at 9:30 however slow
 * the machine is. Readings of a running countdown allow a couple of seconds for real time passing;
 * a paused or frozen one is compared exactly.
 *
 * The console-error check (item 11) is the fixture's: every test here fails on any `console.error`
 * or uncaught page error, through the whole start, pause, finish and reload cycle.
 */

test.use({ fixedClock: false })

const MENTOR = 'Email mentor about term plan'
const NOW_TITLE = 'C779 · Unit 3: CSS layout (45 min)'
const FOCUS_SECONDS = 25 * 60

const timerDisplay = (page: Page) => page.getByTestId('timer-display')
const timerLabel = (page: Page) => page.getByTestId('timer-label')
const toggle = (page: Page) => page.getByTestId('timer-toggle')
const endDialog = (page: Page) => page.getByRole('dialog', { name: 'Done with this task?' })
const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const sessionRows = (page: Page) => page.getByTestId('session-row')
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' })
const dailyGoal = (page: Page) => page.getByRole('progressbar', { name: 'Daily goal' })
const xpToday = (page: Page) => page.getByText('earned today').locator('..')

interface StoredSession {
  id: string
  kind: 'focus' | 'break'
  mode: 'pomodoro' | 'custom' | 'stopwatch'
  status: 'running' | 'paused' | 'completed' | 'abandoned'
  taskId: string | null
  startedAt: number
  endedAt: number | null
  plannedMinutes: number | null
  pausedMs: number
  actualMinutes: number | null
  interrupted: boolean
  counted: boolean
}

interface StoredXp {
  amount: number
  source: string
  key: string
}

/** Reads a whole table straight from IndexedDB, so an assertion never depends on the UI under test. */
async function readTable<T>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('forge')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction(name).objectStore(name).getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            db.close()
            resolve(all.result as T[])
          }
        }
      }),
    table,
  )
}

const storedSessions = (page: Page) => readTable<StoredSession>(page, 'sessions')

/** Opens the app on the sample data with the page clock running from 09:30:00 exactly. */
async function openApp(page: Page, path = '/focus'): Promise<void> {
  await page.clock.install({ time: FIXED_NOW })
  await gotoApp(page, path, 'wgu')
  // The Focus page shows a skeleton until settings and the running session are read; its keys and
  // buttons only work after that.
  if (path === '/focus') await expect(timerDisplay(page)).toBeVisible()
  await page.clock.setSystemTime(FIXED_NOW)
}

/** The whole seconds on the dial: "24:59" is 1499, "1:05:00" is 3900. */
async function shown(page: Page): Promise<number> {
  const text = (await timerDisplay(page).innerText()).trim()
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0)
}

/** The dial reads `expected` seconds, give or take `tolerance` (real time keeps passing under `page.clock`). */
async function expectShown(page: Page, expected: number, tolerance = 3): Promise<void> {
  await expect
    .poll(async () => Math.abs((await shown(page)) - expected), {
      message: `the dial shows about ${expected} seconds`,
    })
    .toBeLessThanOrEqual(tolerance)
}

/** Picks a task in the Focus page's task picker, for the next session or the running one. */
async function linkTask(page: Page, title: string): Promise<void> {
  await page.getByTestId('task-picker').click()
  await page.getByRole('combobox', { name: 'Search open tasks' }).fill(title)
  await page.getByRole('option', { name: title }).first().click()
  await expect(page.getByTestId('task-picker')).toContainText(title)
}

/** Presses Start and waits until the session is running. */
async function start(page: Page): Promise<void> {
  await page.getByTestId('timer-start').click()
  await expect(toggle(page)).toHaveText('Pause')
}

/** Starts a pomodoro on `title`, then jumps to the end of it: the "Done with this task?" dialog is up. */
async function runRoundToEnd(page: Page, title = MENTOR): Promise<void> {
  await linkTask(page, title)
  await start(page)
  await page.clock.fastForward('25:00')
  await expect(endDialog(page)).toBeVisible()
}

/** Leaves the end dialog unanswered (Esc), so the page behind it can be read. */
async function dismissEndDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(endDialog(page)).toBeHidden()
}

async function goToToday(page: Page): Promise<void> {
  await mainNav(page).getByRole('link', { name: 'Today', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
}

const pendingEnd = (page: Page) =>
  page.evaluate(() => localStorage.getItem('forge:focus:pending-end'))

test.describe('Focus timer', () => {
  test('a pomodoro fast-forwarded to its end asks "Done with this task?", grants 25 XP, logs 9:30–9:55 and offers the break', async ({
    page,
  }) => {
    await openApp(page)
    await linkTask(page, MENTOR)
    await expect(timerDisplay(page)).toHaveText('25:00')
    await expect(timerLabel(page)).toHaveText('Ready')

    await start(page)
    await expect(timerLabel(page)).toHaveText('Focus')
    await expect(page.getByTestId('round-counter')).toHaveText('Round 1 of 4')
    await expectShown(page, FOCUS_SECONDS)

    await page.clock.fastForward('25:00')

    // The question, the minutes and the XP the session earned (1 per minute).
    const dialog = endDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(MENTOR)
    await expect(dialog.getByTestId('end-summary')).toContainText('25 of 25 min')
    await expect(dialog.getByTestId('end-summary')).toContainText('+25 XP')
    for (const name of ['Yes', 'Keep going', 'Add note']) {
      await expect(dialog.getByRole('button', { name })).toBeVisible()
    }
    await expect.poll(() => pendingEnd(page)).not.toBeNull()

    const rows = await storedSessions(page)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'focus',
      mode: 'pomodoro',
      status: 'completed',
      plannedMinutes: 25,
      actualMinutes: 25,
      counted: true,
      interrupted: false,
    })
    // It began at 9:30 (the clock was pinned there) and ended exactly 25 minutes later.
    const startedAt = rows[0]?.startedAt ?? 0
    expect(startedAt - FIXED_NOW.getTime()).toBeGreaterThanOrEqual(0)
    expect(startedAt - FIXED_NOW.getTime()).toBeLessThan(60_000)
    expect((rows[0]?.endedAt ?? 0) - startedAt).toBe(25 * 60_000)
    const xp = (await readTable<StoredXp>(page, 'xpEvents')).filter((e) => e.source === 'session')
    expect(xp).toHaveLength(1)
    expect(xp[0]?.amount).toBe(25)

    // Behind the dialog: the log row spans 9:30 to 9:55, and the timer offers the break.
    await dismissEndDialog(page)
    await expect(sessionRows(page)).toHaveCount(1)
    await expect(sessionRows(page)).toContainText('9:30–9:55 AM')
    await expect(sessionRows(page)).toContainText(MENTOR)
    await expect(sessionRows(page)).toContainText('25 of 25 min')
    await expect(sessionRows(page)).toContainText('+25 XP')
    await expect(sessionRows(page)).not.toContainText('Interrupted')
    await expect(page.getByTestId('session-log')).toContainText('1 session · 25 min focused')

    await expect(timerLabel(page)).toHaveText('Short break next')
    await expect(timerDisplay(page)).toHaveText('05:00')
    await expect(page.getByTestId('round-counter')).toHaveText('After round 1 of 4')
    await expect(page.getByTestId('timer-start')).toHaveText('Start break')
    await expect(page.getByTestId('timer-skip-break')).toBeVisible()

    // Today counts it: one pomodoro toward the goal, and the XP.
    await goToToday(page)
    await expect(dailyGoal(page)).toHaveAttribute('aria-valuetext', '1 of 6 pomodoros')
    await expect(xpToday(page)).toContainText('+25 XP')
  })

  test('Yes completes the linked task', async ({ page }) => {
    await openApp(page)
    await runRoundToEnd(page)

    await endDialog(page).getByRole('button', { name: 'Yes' }).click()
    await expect(endDialog(page)).toBeHidden()
    await expect(toasts(page)).toContainText(`Completed “${MENTOR}”`)
    await expect(toasts(page)).toContainText('+20 XP')
    await expect.poll(() => pendingEnd(page)).toBeNull()

    // On Today the task has left "Your tasks" and sits in "Completed today"; the XP is the session's plus the task's.
    await goToToday(page)
    await expect(
      page.getByRole('region', { name: /^Your tasks/ }).getByRole('listitem'),
    ).toHaveCount(1)
    const completed = page.getByRole('region', { name: /^Completed today/ })
    await completed.getByRole('button', { name: /Completed today/ }).click()
    await expect(completed.getByRole('listitem')).toContainText(MENTOR)
    await expect(xpToday(page)).toContainText('+45 XP')
    await expect(dailyGoal(page)).toHaveAttribute('aria-valuetext', '1 of 6 pomodoros')
  })

  test('reloading mid-session keeps the remaining time, and it goes on counting down', async ({
    page,
  }) => {
    await openApp(page)
    await linkTask(page, MENTOR)
    await start(page)
    await page.clock.fastForward('07:30')
    await expectShown(page, FOCUS_SECONDS - 7.5 * 60)

    // Freeze the page's clock at this instant, so what is on screen after the reload can be worked
    // out exactly from the stored session, whatever time the reload itself took.
    const instant = await page.evaluate(() => Date.now())
    await page.clock.setFixedTime(instant)
    const [running] = (await storedSessions(page)).filter((s) => s.status === 'running')
    expect(running).toBeDefined()
    const remaining =
      ((running?.startedAt ?? 0) +
        (running?.plannedMinutes ?? 0) * 60_000 +
        (running?.pausedMs ?? 0) -
        instant) /
      1000
    expect(remaining).toBeGreaterThan(FOCUS_SECONDS - 7.5 * 60 - 3)
    expect(remaining).toBeLessThanOrEqual(FOCUS_SECONDS - 7.5 * 60)

    await page.reload()
    await page.locator('#root > *').first().waitFor()
    await expect(toggle(page)).toHaveText('Pause')
    await expect(timerLabel(page)).toHaveText('Focus')
    await expect(page.getByTestId('task-picker')).toContainText(MENTOR)
    await expectShown(page, remaining, 1)

    // Time moves on again: five more minutes and the dial follows.
    await page.clock.setSystemTime(instant + 5 * 60_000)
    await expectShown(page, remaining - 5 * 60, 3)
    await expect(endDialog(page)).toBeHidden()
  })

  test('a paused session stays paused, and unchanged, across a reload', async ({ page }) => {
    await openApp(page)
    await start(page)
    await page.clock.fastForward('10:00')
    await toggle(page).click()
    await expect(toggle(page)).toHaveText('Resume')
    await expect(timerLabel(page)).toHaveText('Focus · paused')
    const frozen = await shown(page)
    expect(frozen).toBeGreaterThan(FOCUS_SECONDS - 10 * 60 - 3)
    expect(frozen).toBeLessThanOrEqual(FOCUS_SECONDS - 10 * 60)

    await page.reload()
    await page.locator('#root > *').first().waitFor()
    await expect(toggle(page)).toHaveText('Resume')
    await expect(timerLabel(page)).toHaveText('Focus · paused')
    expect(await shown(page)).toBe(frozen)
  })

  test('stopping at 50% logs an interrupted session that earns no XP and leaves the Today goal alone', async ({
    page,
  }) => {
    await openApp(page)
    await linkTask(page, MENTOR)
    await start(page)
    await page.clock.fastForward('12:30')
    await expectShown(page, FOCUS_SECONDS - 12.5 * 60)

    await page.getByTestId('timer-stop').click()
    const dialog = endDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('end-summary')).toContainText('12 of 25 min')
    await expect(dialog.getByTestId('end-summary')).not.toContainText('XP')
    await expect(dialog).toContainText('Sessions under 80% of the plan do not count')
    await dismissEndDialog(page)

    // In the log it is there, marked interrupted and not counted, with no XP badge.
    await expect(sessionRows(page)).toHaveCount(1)
    await expect(sessionRows(page)).toContainText('12 of 25 min')
    await expect(sessionRows(page)).toContainText('Interrupted')
    await expect(sessionRows(page)).toContainText('Not counted')
    await expect(sessionRows(page)).not.toContainText('XP')
    await expect(page.getByTestId('session-log')).toContainText('1 session · 12 min focused')

    const [row] = await storedSessions(page)
    expect(row).toMatchObject({
      status: 'completed',
      kind: 'focus',
      interrupted: true,
      counted: false,
      actualMinutes: 12,
    })
    expect(
      (await readTable<StoredXp>(page, 'xpEvents')).filter((e) => e.source === 'session'),
    ).toHaveLength(0)

    // No break is offered after a round that did not count.
    await expect(timerLabel(page)).toHaveText('Ready')
    await expect(page.getByTestId('timer-start')).toHaveText('Start')

    // Today is as it was: no pomodoro toward the goal, no XP.
    await goToToday(page)
    await expect(dailyGoal(page)).toHaveAttribute('aria-valuetext', '0 of 6 pomodoros')
    await expect(xpToday(page)).toContainText('0 XP')
    await expect(xpToday(page)).not.toContainText('+')
  })

  test('paused time is not counted: the end moves later and the session still earns its 25 minutes', async ({
    page,
  }) => {
    await openApp(page)
    await linkTask(page, MENTOR)
    await start(page)
    await page.clock.fastForward('05:00')
    await expectShown(page, FOCUS_SECONDS - 5 * 60)

    // Paused: the dial holds still, however long the wait, and nothing ends.
    await toggle(page).click()
    await expect(toggle(page)).toHaveText('Resume')
    await expect(timerLabel(page)).toHaveText('Focus · paused')
    await expect(page.getByText('Paused. The end moves later while you wait.')).toBeVisible()
    const held = await shown(page)
    await page.clock.fastForward('30:00')
    expect(await shown(page)).toBe(held)
    await expect(endDialog(page)).toBeHidden()

    // Resumed: it picks up where it stopped, not 30 minutes later.
    await toggle(page).click()
    await expect(toggle(page)).toHaveText('Pause')
    await expect(timerLabel(page)).toHaveText('Focus')
    await expectShown(page, held)
    await page.clock.fastForward('19:00')
    await expectShown(page, held - 19 * 60)
    await expect(endDialog(page)).toBeHidden()

    await page.clock.fastForward('02:00')
    await expect(endDialog(page)).toBeVisible()
    await expect(endDialog(page).getByTestId('end-summary')).toContainText('25 of 25 min')
    await expect(endDialog(page).getByTestId('end-summary')).toContainText('+25 XP')

    // The half hour on hold shows in the clock times, not in the minutes.
    await dismissEndDialog(page)
    await expect(sessionRows(page)).toContainText('9:30–10:25 AM')
    await expect(sessionRows(page)).toContainText('25 of 25 min')
    const [row] = await storedSessions(page)
    expect(row?.pausedMs).toBeGreaterThanOrEqual(30 * 60_000)
    expect(row?.pausedMs).toBeLessThan(30 * 60_000 + 60_000)
    expect(row?.actualMinutes).toBe(25)
  })

  test('f enters full-screen focus with only the timer, the task name and the ring; Esc leaves', async ({
    page,
  }) => {
    await openApp(page)
    await linkTask(page, MENTOR)
    await start(page)

    await page.keyboard.press('f')
    const fs = page.getByTestId('fullscreen-focus')
    await expect(fs).toBeVisible()
    await expect(fs).toHaveAttribute('aria-label', 'Focus mode')
    await expect(fs.getByTestId('timer-display')).toHaveText(/^2[45]:\d\d$/)
    await expect(fs.getByTestId('fullscreen-task')).toHaveText(MENTOR)
    await expect(fs.getByTestId('timer-label')).toHaveText('Focus')
    await expect(fs.locator('[role="progressbar"]')).toHaveCount(1)

    // Nothing else from the page: no picker, log or mode switch inside it, and it covers the window.
    for (const id of [
      'task-picker',
      'session-log',
      'timer-toggle',
      'timer-stop',
      'round-counter',
    ]) {
      await expect(fs.getByTestId(id)).toHaveCount(0)
    }
    await expect(fs.getByRole('radiogroup')).toHaveCount(0)
    const covers = await page.evaluate(() => {
      const overlay = document.querySelector('[data-testid="fullscreen-focus"]')
      const w = window.innerWidth
      const h = window.innerHeight
      return [
        [8, 8],
        [w - 8, 8],
        [8, h - 8],
        [w - 8, h - 8],
        [w / 2, h / 2],
      ].every(([x, y]) => overlay?.contains(document.elementFromPoint(x ?? 0, y ?? 0)) === true)
    })
    expect(covers).toBe(true)

    // Space still works in here, and the timer keeps running behind it.
    await page.keyboard.press('Space')
    await expect(fs.getByTestId('timer-label')).toHaveText('Paused')
    await page.keyboard.press('Space')
    await expect(fs.getByTestId('timer-label')).toHaveText('Focus')

    await page.keyboard.press('Escape')
    await expect(fs).toBeHidden()
    expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true)
    await expect(toggle(page)).toHaveText('Pause')

    // The button opens it too, and its exit button closes it; focus goes back to the button that opened it.
    await page.getByTestId('fullscreen-open').click()
    await expect(fs).toBeVisible()
    await page.getByTestId('fullscreen-exit').click()
    await expect(fs).toBeHidden()
    await expect(page.getByTestId('fullscreen-open')).toBeFocused()
    await expect(toggle(page)).toHaveText('Pause')
  })

  test('keyboard focus stays inside full-screen focus, and returns to the page when it closes', async ({
    page,
  }) => {
    await openApp(page)
    await start(page)
    const opener = page.getByTestId('fullscreen-open')
    await opener.focus()
    await page.keyboard.press('f')
    const fs = page.getByTestId('fullscreen-focus')
    await expect(fs).toBeVisible()

    // Tab and Shift+Tab go round its two buttons and never reach the page behind.
    const insideFs = () =>
      page.evaluate(() => {
        const overlay = document.querySelector('[data-testid="fullscreen-focus"]')
        return overlay !== null && overlay.contains(document.activeElement)
      })
    for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key)
      expect(await insideFs()).toBe(true)
    }
    // Even focus pushed out from elsewhere is pulled back in.
    await page.evaluate(() =>
      document.querySelector<HTMLElement>('[data-testid="timer-stop"]')?.focus(),
    )
    expect(await insideFs()).toBe(true)

    await page.keyboard.press('Escape')
    await expect(fs).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('full screen with nothing running shows what Space starts: the break after a counted round', async ({
    page,
  }) => {
    await openApp(page)
    await runRoundToEnd(page)
    await dismissEndDialog(page)

    await page.keyboard.press('f')
    const fs = page.getByTestId('fullscreen-focus')
    await expect(fs).toBeVisible()
    await expect(fs.getByTestId('timer-label')).toHaveText('Short break next')
    await expect(fs.getByTestId('timer-display')).toHaveText('05:00')

    // Space starts exactly what it announced.
    await page.keyboard.press('Space')
    await expect(fs.getByTestId('timer-label')).toHaveText('Short break')
    await expect(fs.getByTestId('timer-display')).toHaveText(/^0[45]:\d\d$/)
    const sessions = await storedSessions(page)
    expect(sessions.filter((row) => row.status === 'running')).toMatchObject([
      { kind: 'break', plannedMinutes: 5 },
    ])
  })

  test('with nothing running and no round behind it, full screen reads Ready with the full length', async ({
    page,
  }) => {
    await openApp(page)
    await page.keyboard.press('f')
    const fs = page.getByTestId('fullscreen-focus')
    await expect(fs.getByTestId('timer-label')).toHaveText('Ready')
    await expect(fs.getByTestId('timer-display')).toHaveText('25:00')
  })

  test('stopwatch mode counts up, and a session of 10 minutes or more counts', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press('3')
    await expect(page.getByRole('radio', { name: 'Stopwatch' })).toBeChecked()
    await linkTask(page, MENTOR)
    await expect(timerDisplay(page)).toHaveText('00:00')
    expect(await page.evaluate(() => localStorage.getItem('forge:focus:mode'))).toBe('stopwatch')

    await start(page)
    await expect(timerLabel(page)).toHaveText('Focus')
    await expect(page.getByTestId('timer-stop')).toHaveText('Finish')
    await expect.poll(() => shown(page)).toBeLessThanOrEqual(3)

    await page.clock.fastForward('03:00')
    await expectShown(page, 3 * 60)
    await page.clock.fastForward('09:00')
    await expectShown(page, 12 * 60)

    await page.getByTestId('timer-stop').click()
    await expect(endDialog(page)).toBeVisible()
    await expect(endDialog(page).getByTestId('end-summary')).toContainText('12 min')
    await expect(endDialog(page).getByTestId('end-summary')).toContainText('+12 XP')
    await dismissEndDialog(page)
    await expect(sessionRows(page)).toContainText('12 min')
    await expect(sessionRows(page)).toContainText('+12 XP')
    await expect(sessionRows(page)).not.toContainText('Interrupted')

    // The mode is remembered on this device.
    await page.reload()
    await page.locator('#root > *').first().waitFor()
    await expect(page.getByRole('radio', { name: 'Stopwatch' })).toBeChecked()
  })

  test('shift+s on Today starts focus on the Now task and opens the timer', async ({ page }) => {
    await openApp(page, '/')
    await expect(page.locator('#now-title')).toHaveText(NOW_TITLE)

    await page.keyboard.press('Shift+S')
    await expect(page).toHaveURL(/\/focus$/)
    await expect(page.getByTestId('task-picker')).toContainText(NOW_TITLE)
    await expect(toggle(page)).toHaveText('Pause')
    await expect(timerLabel(page)).toHaveText('Focus')
    await expectShown(page, FOCUS_SECONDS)

    const [session] = await storedSessions(page)
    expect(session).toMatchObject({ status: 'running', kind: 'focus', mode: 'pomodoro' })
    expect(session?.taskId).not.toBeNull()
  })

  test('the mini timer shows in the sidebar while a session runs, and links back to Focus', async ({
    page,
  }) => {
    await openApp(page)
    const mini = page.getByTestId('mini-timer')
    await expect(mini).toHaveCount(0)

    await linkTask(page, MENTOR)
    await start(page)
    // The Focus page shows the timer itself, so the mini one stays away.
    await expect(mini).toHaveCount(0)

    await goToToday(page)
    await expect(mini).toBeVisible()
    await expect(mini).toContainText('Focus')
    await expect(mini).toHaveText(/2[45]:\d\dFocus/)
    await expect(mini).toHaveAccessibleName(/Focus, about .* left\. Open Focus/)

    await page.clock.fastForward('10:00')
    await expect(mini).toHaveText(/1[45]:\d\dFocus/)

    await mini.click()
    await expect(page).toHaveURL(/\/focus$/)
    await expect(mini).toHaveCount(0)
    await expect(toggle(page)).toHaveText('Pause')

    // Once it ends the mini timer is gone from every page.
    await page.clock.fastForward('15:00')
    await expect(endDialog(page)).toBeVisible()
    await dismissEndDialog(page)
    await goToToday(page)
    await expect(mini).toHaveCount(0)
  })

  test('on a phone the running timer is a pill above the tab bar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await openApp(page)
    const pill = page.getByTestId('mini-timer-pill')
    await expect(pill).toBeHidden()

    await start(page)
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Today', exact: true })
      .click()
    await expect(page).toHaveURL(/\/$/)
    await expect(pill).toBeVisible()
    await expect(pill).toHaveText(/2[45]:\d\dFocus/)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    await pill.click()
    await expect(page).toHaveURL(/\/focus$/)
    await expect(pill).toBeHidden()
  })

  test('an unanswered end dialog comes back after a refresh, and a dismissed one does not', async ({
    page,
  }) => {
    await openApp(page)
    await runRoundToEnd(page)
    await expect.poll(() => pendingEnd(page)).not.toBeNull()

    await page.reload()
    await page.locator('#root > *').first().waitFor()
    await expect(endDialog(page)).toBeVisible()
    await expect(endDialog(page)).toContainText(MENTOR)
    await expect(endDialog(page).getByTestId('end-summary')).toContainText('+25 XP')

    // Answering it (here: dismissing) clears the reminder; another refresh leaves the page alone.
    await dismissEndDialog(page)
    await expect.poll(() => pendingEnd(page)).toBeNull()
    await page.reload()
    await page.locator('#root > *').first().waitFor()
    await expect(sessionRows(page)).toHaveCount(1)
    await expect(endDialog(page)).toBeHidden()
  })

  test('stopping early (Shift+N) offers Undo: it resumes the session and takes the question back', async ({
    page,
  }) => {
    await openApp(page)
    await linkTask(page, MENTOR)
    await start(page)
    await page.clock.fastForward('10:00')
    await expectShown(page, FOCUS_SECONDS - 10 * 60)

    await page.keyboard.press('Shift+N')
    await expect(endDialog(page)).toBeVisible()
    await expect(toasts(page)).toContainText('Session ended early')
    await expect(toggle(page)).toHaveCount(0)

    await toasts(page).getByRole('button', { name: 'Undo' }).click()
    await expect(endDialog(page)).toBeHidden()
    await expect.poll(() => pendingEnd(page)).toBeNull()
    await expect(toggle(page)).toHaveText('Pause')
    await expect(sessionRows(page)).toHaveCount(0)
    // The same session goes on where it stopped: ten minutes done, about fifteen to go.
    await expectShown(page, FOCUS_SECONDS - 10 * 60)
    const sessions = await storedSessions(page)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ status: 'running', endedAt: null, interrupted: false })

    // And it can still run to its end.
    await page.clock.fastForward('15:00')
    await expect(endDialog(page)).toBeVisible()
    await expect(endDialog(page).getByTestId('end-summary')).toContainText('+25 XP')
  })

  test('a finish that counts (90% of the plan) does not offer Undo', async ({ page }) => {
    await openApp(page)
    await linkTask(page, MENTOR)
    await start(page)
    await page.clock.fastForward('22:30')
    await page.getByTestId('timer-stop').click()
    await expect(endDialog(page)).toBeVisible()
    await expect(endDialog(page).getByTestId('end-summary')).toContainText('+22 XP')
    await expect(toasts(page)).not.toContainText('Session ended early')
  })

  test('the end dialog opens with Yes focused', async ({ page }) => {
    await openApp(page)
    await runRoundToEnd(page)
    await expect(endDialog(page).getByRole('button', { name: 'Yes' })).toBeFocused()
  })

  test('with no task linked there is nothing to finish: the dialog says so and focuses Keep going', async ({
    page,
  }) => {
    await openApp(page)
    await start(page)
    await page.clock.fastForward('25:00')
    const plain = page.getByRole('dialog', { name: 'Session complete' })
    await expect(plain).toBeVisible()
    await expect(plain.getByRole('button', { name: 'Yes' })).toHaveCount(0)
    await expect(plain.getByRole('button', { name: 'Keep going' })).toBeFocused()
  })

  test('the end dialog shows in every open tab, and answering it in one closes it in the other', async ({
    page,
    context,
  }) => {
    await openApp(page)
    const other = await context.newPage()
    const otherProblems: string[] = []
    other.on('console', (msg) => {
      if (msg.type() === 'error') otherProblems.push(`console.error: ${msg.text()}`)
    })
    other.on('pageerror', (err) => otherProblems.push(`pageerror: ${err.message}`))
    await gotoApp(other, '/focus')
    await expect(timerDisplay(other)).toBeVisible()

    await linkTask(page, MENTOR)
    await start(page)
    await expect(toggle(other)).toHaveText('Pause')
    await page.clock.fastForward('25:00')

    // Only one tab settles the session, but both ask the question.
    await expect(endDialog(page)).toBeVisible()
    await expect(endDialog(other)).toBeVisible()
    expect(
      await other.evaluate(() => localStorage.getItem('forge:focus:pending-end')),
    ).not.toBeNull()

    // Answering "Yes" in the second tab completes the task once and closes the question in the first.
    await endDialog(other).getByRole('button', { name: 'Yes' }).click()
    await expect(endDialog(other)).toBeHidden()
    await expect(endDialog(page)).toBeHidden()
    await expect.poll(() => pendingEnd(page)).toBeNull()
    const tasks = await readTable<{ id: string; title: string; status: string }>(page, 'tasks')
    const mentor = tasks.find((task) => task.title === MENTOR)
    expect(mentor?.status).toBe('done')
    const paid = (await readTable<StoredXp>(page, 'xpEvents')).filter(
      (e) => e.key === `task:${mentor?.id}`,
    )
    expect(paid.map((e) => e.amount)).toEqual([20])
    expect(otherProblems, 'the second tab logged errors').toEqual([])
  })

  test('the custom length: an emptied or zero field puts the stored length back, not 1 minute', async ({
    page,
  }) => {
    await openApp(page)
    await page.keyboard.press('2')
    const length = page.getByRole('spinbutton', { name: 'Length in minutes' })
    await expect(length).toHaveValue('50')
    await expect(timerDisplay(page)).toHaveText('50:00')

    for (const bad of ['', '0', '-5']) {
      await length.fill(bad)
      await length.blur()
      await expect(length).toHaveValue('50')
      await expect(timerDisplay(page)).toHaveText('50:00')
    }
    await length.fill('45')
    await length.blur()
    await expect(length).toHaveValue('45')
    await expect(timerDisplay(page)).toHaveText('45:00')
  })

  test('Keep going starts another round on the same task', async ({ page }) => {
    await openApp(page)
    await runRoundToEnd(page)

    await endDialog(page).getByRole('button', { name: 'Keep going' }).click()
    await expect(endDialog(page)).toBeHidden()
    await expect(toggle(page)).toHaveText('Pause')
    await expect(page.getByTestId('task-picker')).toContainText(MENTOR)
    await expectShown(page, FOCUS_SECONDS)
    const sessions = await storedSessions(page)
    expect(sessions.filter((s) => s.status === 'running')).toHaveLength(1)
    expect(sessions.filter((s) => s.status === 'completed')).toHaveLength(1)
  })

  test('the break can be started and ends by itself, or be skipped for the next round', async ({
    page,
  }) => {
    await openApp(page)
    await runRoundToEnd(page)
    await dismissEndDialog(page)

    // Start the break: a five-minute countdown that ends on its own.
    await page.getByTestId('timer-start').click()
    await expect(timerLabel(page)).toHaveText('Short break')
    await expect(page.getByTestId('timer-stop')).toHaveText('Skip break')
    await expect(page.getByTestId('round-counter')).toHaveText('After round 1 of 4')
    await expectShown(page, 5 * 60)
    await page.clock.fastForward('05:00')
    await expect(toasts(page)).toContainText('Break over')
    await expect(toasts(page)).toContainText('Ready for round 2 of 4?')
    await expect(timerLabel(page)).toHaveText('Ready')
    await expect(page.getByTestId('round-counter')).toHaveText('Round 2 of 4')
    await expect(timerDisplay(page)).toHaveText('25:00')
    await expect(page.getByTestId('timer-start')).toHaveText('Start')
    // Breaks are not part of the log.
    await expect(sessionRows(page)).toHaveCount(1)
  })

  test('Skip break moves straight on to the next round', async ({ page }) => {
    await openApp(page)
    await runRoundToEnd(page)
    await dismissEndDialog(page)
    await expect(timerLabel(page)).toHaveText('Short break next')

    await page.getByTestId('timer-skip-break').click()
    await expect(timerLabel(page)).toHaveText('Ready')
    await expect(page.getByTestId('round-counter')).toHaveText('Round 2 of 4')
    await expect(timerDisplay(page)).toHaveText('25:00')
    await expect(page.getByTestId('timer-skip-break')).toHaveCount(0)
    await expect(sessionRows(page)).toHaveCount(1)
  })
})
