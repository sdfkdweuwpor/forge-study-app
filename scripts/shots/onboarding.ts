import type { Page } from '@playwright/test'
import type { ShotList } from '../shot-types'

/**
 * Onboarding (Phase 10A): the four steps of `/welcome` on a fresh database, with the extension step both
 * ways. The runner loads the app once; each shot then does its own setup. Favicon requests are answered
 * with small coloured tiles (the sandbox has no network), and a stand-in `chrome.runtime` plays the
 * extension for "Connected".
 */

/** Finite animations and transitions have ended, and nothing is loading. */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(0, 0)
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  )
}

const COLORS: Record<string, string> = {
  'instagram.com': '#c13584',
  'tiktok.com': '#111111',
  'youtube.com': '#e02020',
  'x.com': '#111111',
  'twitter.com': '#1d9bf0',
  'reddit.com': '#ff4500',
  'facebook.com': '#1877f2',
  'snapchat.com': '#f5c400',
  'netflix.com': '#b20710',
  'twitch.tv': '#9146ff',
  'pinterest.com': '#e60023',
}

/** Answers favicon lookups with a small coloured tile, like the real service would with each site's icon. */
async function withFavicons(page: Page): Promise<void> {
  await page.route('https://icons.duckduckgo.com/**', (route) => {
    const domain = /ip3\/(.+)\.ico/.exec(route.request().url())?.[1] ?? 'x'
    const color = COLORS[decodeURIComponent(domain)] ?? '#6b7280'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="${color}"/><circle cx="8" cy="8" r="3.2" fill="#fff"/></svg>`
    return route.fulfill({ contentType: 'image/svg+xml', body: svg })
  })
}

/** A `chrome.runtime` that answers like the extension (1.0.0), installed before the next page load. */
async function withExtension(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as unknown as { chrome: unknown }).chrome = {
      runtime: {
        lastError: undefined,
        sendMessage(
          _id: string,
          message: { type: string; since?: number },
          callback: (r: unknown) => void,
        ) {
          queueMicrotask(() => {
            if (message.type === 'ping') callback({ ok: true, version: '1.0.0' })
            else if (message.type === 'getEvents')
              callback({ ok: true, events: [], cursor: message.since ?? 0 })
            else callback({ ok: true })
          })
        },
      },
    }
  })
}

const next = (page: Page) => page.getByRole('button', { name: 'Continue', exact: true })

/** Goes on from step 1 (with a name) to `target` (2, 3 or 4) with the defaults. */
async function toStep(page: Page, target: 1 | 2 | 3 | 4): Promise<void> {
  await page.getByLabel('Your name').fill('Maya')
  for (let step = 1; step < target; step++) {
    await next(page).click()
    await page.getByText(`Step ${step + 1} of 4`).waitFor()
  }
}

const list: ShotList = {
  feature: 'onboarding',
  shots: [
    {
      name: 'step-1-name',
      path: '/welcome',
      waitFor: 'h1',
      prepare: async (page) => {
        await page.getByLabel('Your name').fill('Maya')
        await settle(page)
      },
    },
    {
      name: 'step-2-sites',
      path: '/welcome',
      waitFor: 'h1',
      fullPage: true,
      prepare: async (page) => {
        await withFavicons(page)
        await toStep(page, 2)
        await page.getByRole('button', { name: 'twitch.tv', exact: true }).waitFor()
        await page.getByRole('button', { name: 'twitch.tv', exact: true }).click()
        await page.getByRole('button', { name: 'pinterest.com', exact: true }).click()
        const add = page.getByRole('textbox', { name: 'Site to add' })
        await add.fill('discord.com')
        await add.press('Enter')
        await page.waitForLoadState('networkidle')
        await settle(page)
      },
    },
    {
      name: 'step-3-goal',
      path: '/welcome',
      waitFor: 'h1',
      fullPage: true,
      prepare: async (page) => {
        await toStep(page, 3)
        await page.getByRole('radio', { name: /Plan a WGU term/ }).check()
        await settle(page)
      },
    },
    {
      name: 'step-4-not-installed',
      path: '/welcome',
      waitFor: 'h1',
      fullPage: true,
      prepare: async (page) => {
        await toStep(page, 4)
        await page.getByText('Not installed yet').waitFor()
        await settle(page)
      },
    },
    {
      name: 'step-4-connected',
      path: '/welcome',
      waitFor: 'h1',
      fullPage: true,
      prepare: async (page) => {
        await withExtension(page)
        await page.goto('/welcome')
        await toStep(page, 4)
        await page.getByText('Connected · v1.0.0').waitFor()
        await settle(page)
      },
    },
  ],
}

export default list
