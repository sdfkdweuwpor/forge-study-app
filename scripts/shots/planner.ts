import type { Page } from '@playwright/test'
import type { ShotList } from '../shot-types'

/** Waits for finite animations and transitions to end so the capture is the settled state. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  )
}

const NEW = '/goals/new?seed=empty'
const GOAL = '/goals/goal-wgu-bscs'

/** A WGU term as a person would paste it: three courses with a few units each, and a target that is too soon. */
export const WGU_LIST = `WGU B.S. Computer Science, Term 1
C182 Introduction to IT – 4 CUs OA
- Hardware and operating systems
- Networks and the internet
- Cloud and virtualization
C779 Web Development Foundations (3 CUs) PA
- HTML structure
- CSS layout
- JavaScript basics
D278 Scripting and Programming Foundations (3 CUs) OA
- Variables and expressions
- Loops
- Functions
Target: December 18, 2026
`

const next = (page: Page) => page.getByRole('button', { name: 'Continue' }).click()

/** Pastes the WGU list and reads it, ready to continue. */
async function pasteList(page: Page): Promise<void> {
  await page.getByRole('textbox', { name: 'Syllabus or course list' }).fill(WGU_LIST)
  await page.getByRole('button', { name: 'Read it' }).click()
  await page.getByText(/Found: 3 courses/).waitFor()
}

async function toStep(page: Page, step: 'when' | 'availability' | 'effort' | 'review' | 'preview' | 'confirm'): Promise<void> {
  await pasteList(page)
  const order = ['when', 'availability', 'effort', 'review', 'preview', 'confirm'] as const
  for (const s of order) {
    await next(page)
    if (s === step) break
  }
}

const list: ShotList = {
  feature: 'planner',
  shots: [
    { name: '1-start', path: NEW, waitFor: 'main h1', prepare: settle },
    {
      name: '1-start-read',
      path: NEW,
      waitFor: 'main h1',
      prepare: async (page) => {
        await pasteList(page)
        await settle(page)
      },
      fullPage: true,
    },
    {
      name: '1-start-photo',
      path: NEW,
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.getByRole('tab', { name: 'Upload a photo' }).click()
        await settle(page)
      },
      fullPage: true,
    },
    {
      name: '2-when',
      path: NEW,
      waitFor: 'main h1',
      prepare: async (page) => {
        await toStep(page, 'when')
        await settle(page)
      },
    },
    {
      name: '3-availability',
      path: NEW,
      waitFor: 'main h1',
      prepare: async (page) => {
        await toStep(page, 'availability')
        await settle(page)
      },
      fullPage: true,
    },
    {
      name: '3-availability-shift',
      path: NEW,
      waitFor: 'main h1',
      prepare: async (page) => {
        await toStep(page, 'availability')
        await page.getByRole('switch', { name: 'I work a rotating shift' }).click()
        await settle(page)
      },
      fullPage: true,
    },
    {
      name: '4-effort',
      path: NEW,
      waitFor: 'main h1',
      prepare: async (page) => {
        await toStep(page, 'effort')
        await settle(page)
      },
      fullPage: true,
    },
    {
      name: '5-review',
      path: NEW,
      waitFor: 'main h1',
      prepare: async (page) => {
        await toStep(page, 'review')
        await settle(page)
      },
      fullPage: true,
    },
    {
      name: '6-preview-infeasible',
      path: NEW,
      waitFor: 'main h1',
      prepare: async (page) => {
        await toStep(page, 'preview')
        await page.getByRole('heading', { name: /doesn’t fit/ }).waitFor()
        await settle(page)
      },
      fullPage: true,
    },
    {
      name: '6-preview-fits',
      path: NEW,
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.getByRole('button', { name: /WGU term/ }).click()
        await next(page)
        await next(page)
        await next(page)
        await next(page)
        await next(page)
        await page.getByRole('heading', { name: /This fits/ }).waitFor()
        await settle(page)
      },
      fullPage: true,
    },
    {
      name: '7-confirm',
      path: NEW,
      waitFor: 'main h1',
      prepare: async (page) => {
        await toStep(page, 'confirm')
        await settle(page)
      },
      fullPage: true,
    },
    {
      name: 'goal-life-happened',
      path: `${GOAL}?seed=wgu`,
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Life happened/ }).click()
        await page.getByRole('dialog', { name: 'Life happened' }).waitFor()
        await page.getByRole('button', { name: /Tue 29/ }).click()
        await page.getByRole('button', { name: 'Preview' }).click()
        await page.getByRole('button', { name: 'Confirm re-plan' }).waitFor()
        await settle(page)
      },
    },
    {
      name: 'goal-plan-settings',
      path: `${GOAL}?seed=wgu`,
      waitFor: 'main h1',
      prepare: async (page) => {
        await page.getByRole('button', { name: /Plan settings/ }).click()
        await page.getByRole('dialog', { name: 'Plan settings' }).waitFor()
        await settle(page)
      },
    },
  ],
}

export default list
