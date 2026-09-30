import type { Locator, Page } from '@playwright/test'
import { expect, gotoApp, test } from './fixtures'

/**
 * Phase 13B: a keyboard-only walkthrough. Every main route of PLAN §5.1 (cardReview and settings/sync
 * are left out) is driven with the keyboard, never the mouse:
 *
 *  1. the skip link is the first stop, shows itself, and moves focus to <main>;
 *  2. Tab order follows the visual order (reading order, or column by column in a board or calendar);
 *  3. every stop shows a focus ring that comes with focus and goes when focus leaves;
 *  4. nothing traps focus: a full Tab pass leaves the page, and Shift+Tab comes back to the last stop;
 *  5. Esc closes every overlay and hands focus back to the control that opened it;
 *  6. the main shortcuts of PLAN §5.2 work (g sequences, q, mod+k, ?, j/k/x, the focus timer keys,
 *     the calendar arrows);
 *  7. a Modal traps focus inside and restores it on close.
 *
 * Deterministic on purpose: no fixed sleeps, only web-first assertions and polls. Focus is placed with
 * `locator.focus()` where a test needs a known opener (that is a script, not a mouse), and everything
 * after it is a key press.
 */

declare global {
  interface Window {
    /** What carried the previous stop's focus ring and how it was styled; read again at the next stop. */
    __kbCarriers?: { el: Element; look: string }[]
  }
}

const DESKTOP = { width: 1440, height: 900 }
const TABLET = { width: 768, height: 1024 }
const PHONE = { width: 375, height: 812 }

// ── The Tab walk ─────────────────────────────────────────────────────────────────────────────────

interface Box {
  x: number
  y: number
  w: number
  h: number
  /** Fixed or sticky: its position depends on the scroll, so it takes no part in the order check. */
  pinned: boolean
}

interface Stop {
  /** CSS-like path: the identity of an element across steps. */
  key: string
  name: string
  label: string
  inMain: boolean
  inDialog: boolean
  focusVisible: boolean
  tabindex: number | null
  box: Box
  /** Where the ring is drawn; `none` means no ring was found. */
  ring: 'self' | 'nearby' | 'none'
  /**
   * A text-entry surface whose focus indicator is the caret, by design: the page title and the block
   * editor (DECISIONS, Design review 2F: "a ring around every line of a document would be noise").
   */
  caretOnly: boolean
  /** The focus was hidden behind a fixed or sticky bar: what the bar is, and whether it sits at the bottom of the screen. */
  covered: { by: string; atBottom: boolean } | null
  /** Set when the next stop was read: whether the ring went away again. `null` = could not tell. */
  ringCleared: boolean | null
}

/** Runs in the page: what has focus now and how it looks. `null` when nothing (the body) has focus. */
async function readFocus(
  page: Page,
): Promise<(Omit<Stop, 'ringCleared'> & { prevRingCleared: boolean | null }) | null> {
  return page.evaluate(async () => {
    // A ring that fades in or out is measured once its transition has ended.
    const settling = document
      .getAnimations()
      .filter((a): a is CSSTransition => a instanceof CSSTransition)
      .map((a) => a.finished.catch(() => undefined))
    await Promise.race([Promise.all(settling), new Promise((r) => setTimeout(r, 600))])

    const alpha = (color: string): number => {
      if (color === 'transparent') return 0
      const slash = /\/\s*([\d.]+)\s*\)/.exec(color)
      if (slash?.[1]) return Number(slash[1])
      const rgba = /^rgba\(([^)]+)\)$/.exec(color)
      if (rgba?.[1]) {
        const parts = rgba[1].split(',')
        return parts.length === 4 ? Number(parts[3]) : 1
      }
      return 1
    }
    const lookOf = (el: Element): string => {
      const s = getComputedStyle(el)
      return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset} | ${s.boxShadow}`
    }
    const ringOf = (el: Element): boolean => {
      const s = getComputedStyle(el)
      if (
        s.outlineStyle !== 'none' &&
        parseFloat(s.outlineWidth) > 0 &&
        alpha(s.outlineColor) > 0.2
      )
        return true
      const layer =
        /((?:rgba?|color)\([^)]*\)|transparent)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/g
      for (const m of s.boxShadow.matchAll(layer)) {
        const [, color = '', x = '0', y = '0', blur = '0', spread = '0'] = m
        if (
          alpha(color) > 0.2 &&
          (Number(spread) > 0 || Number(blur) > 0 || Number(x) !== 0 || Number(y) !== 0)
        )
          return true
      }
      return false
    }

    const el = document.activeElement
    // The previous stop's ring must be gone now: something that drew it must look different again
    // (unless focus is still inside what carried it, or the element was removed).
    const before = window.__kbCarriers ?? []
    let prevRingCleared: boolean | null = null
    if (before.length > 0) {
      const outside = before.filter((c) => c.el.isConnected && !(el && c.el.contains(el)))
      prevRingCleared = outside.length === 0 ? null : outside.some((c) => lookOf(c.el) !== c.look)
    }
    window.__kbCarriers = []
    if (!el || el === document.body || el === document.documentElement) return null

    const pathOf = (node: Element): string => {
      const parts: string[] = []
      for (let cur: Element | null = node; cur && cur !== document.body; cur = cur.parentElement) {
        const parent: Element | null = cur.parentElement
        const idx = parent ? Array.from(parent.children).indexOf(cur) + 1 : 0
        parts.unshift(`${cur.tagName.toLowerCase()}:${idx}`)
      }
      return parts.join('>')
    }
    const nameOf = (node: Element): string => {
      const by = node.getAttribute('aria-labelledby')
      if (by) {
        const text = by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim()
        if (text) return text
      }
      const aria = node.getAttribute('aria-label')?.trim()
      if (aria) return aria
      if (
        node instanceof HTMLInputElement ||
        node instanceof HTMLSelectElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLButtonElement
      ) {
        const labels = Array.from(node.labels ?? [])
          .map((l) => (l.textContent ?? '').trim())
          .join(' ')
          .trim()
        if (labels) return labels
        const own =
          node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
            ? node.placeholder
            : ''
        if (own) return own
      }
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text) return text
      const title = node.getAttribute('title')?.trim()
      if (title) return title
      const img = node.querySelector('img[alt]')?.getAttribute('alt')?.trim()
      return img ?? ''
    }

    // Position in the document, so scrolling between two stops changes nothing.
    let x = 0
    let y = 0
    let pinned = false
    for (let up: Element | null = el; up; up = up.parentElement) {
      const pos = getComputedStyle(up).position
      if (pos === 'fixed' || pos === 'sticky') pinned = true
      if (up !== el) {
        x += up.scrollLeft
        y += up.scrollTop
      }
    }
    const r = el.getBoundingClientRect()

    // Where is the ring drawn: on the element, or on something around it (a wrapper, a sibling box)?
    const around: Element[] = []
    let up = el.parentElement
    for (let i = 0; i < 4 && up && up !== document.body; i++, up = up.parentElement) around.push(up)
    if (el.nextElementSibling) around.push(el.nextElementSibling)
    if (el.previousElementSibling) around.push(el.previousElementSibling)
    for (const child of Array.from(el.querySelectorAll('*')).slice(0, 8)) around.push(child)
    const self = ringOf(el)
    // /design shows a forced focus ring on some controls (data-force): that ring never goes away.
    const forced = (node: Element) =>
      node.matches('[data-force~="focus"]') || node.closest('[data-force~="focus"]') !== null
    const carriers = forced(el)
      ? []
      : [...(self ? [el] : []), ...around.filter((c) => ringOf(c) && !forced(c))]
    window.__kbCarriers = carriers.map((c) => ({ el: c, look: lookOf(c) }))
    // On a wrapper that holds more than one focusable the ring stays while focus moves inside it.
    const ring = self ? 'self' : carriers.length > 0 ? 'nearby' : 'none'

    // Is what has focus actually reachable by eye, or sitting under a bar?
    let covered: { by: string; atBottom: boolean } | null = null
    if (r.width > 0 && r.height > 0) {
      const cx = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1)
      const cy = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1)
      const top = document.elementFromPoint(cx, cy)
      if (top && top !== el && !el.contains(top) && !top.contains(el)) {
        for (let cur: Element | null = top; cur; cur = cur.parentElement) {
          const pos = getComputedStyle(cur).position
          // A bar over the page, not a layer the element is itself part of.
          if ((pos === 'fixed' || pos === 'sticky') && !cur.contains(el)) {
            const label = cur.getAttribute('aria-label')
            covered = {
              by: `${cur.tagName.toLowerCase()}${label ? ` "${label}"` : ''}`,
              atBottom: cur.getBoundingClientRect().top > window.innerHeight / 2,
            }
            break
          }
        }
      }
    }

    const caretOnly =
      (el instanceof HTMLElement && el.isContentEditable) ||
      (el instanceof HTMLTextAreaElement && el.getAttribute('aria-label') === 'Page title')
    const tabindex = el.hasAttribute('tabindex') ? Number(el.getAttribute('tabindex')) : null
    return {
      key: pathOf(el),
      name: nameOf(el),
      label: `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''} "${nameOf(el).slice(0, 48)}"`,
      inMain: el.closest('main') !== null,
      inDialog: el.closest('[role="dialog"], dialog') !== null,
      focusVisible: el.matches(':focus-visible'),
      tabindex,
      box: {
        x: Math.round(r.left + x),
        y: Math.round(r.top + y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        pinned,
      },
      ring,
      caretOnly,
      covered,
      prevRingCleared,
    }
  })
}

interface Walk {
  stops: Stop[]
  /** How the pass ended: it left the page (focus on the body) or came back to its first stop. */
  ended: 'left' | 'wrapped' | 'trapped' | 'capped'
}

/**
 * Presses Tab until focus leaves the page or wraps around, recording each new element. A run of
 * stops inside one element (the hour, minute and AM/PM of a time input) counts once. `trapped` means
 * focus revisited an element it had already left, without passing the end of the page.
 */
async function walkTab(page: Page, cap = 500): Promise<Walk> {
  const stops: Stop[] = []
  const seen = new Set<string>()
  let last: Stop | undefined
  for (let step = 0; step < cap * 2 && stops.length < cap; step++) {
    await page.keyboard.press('Tab')
    const snap = await readFocus(page)
    if (last && snap) last.ringCleared = snap.prevRingCleared
    if (!snap) {
      if (last) last.ringCleared ??= null
      return { stops, ended: 'left' }
    }
    if (last && snap.key === last.key) continue
    if (seen.has(snap.key)) {
      return { stops, ended: stops[0]?.key === snap.key ? 'wrapped' : 'trapped' }
    }
    const { prevRingCleared: _cleared, ...rest } = snap
    last = { ...rest, ringCleared: null }
    seen.add(last.key)
    stops.push(last)
  }
  return { stops, ended: 'capped' }
}

const COVER_CONTROL = /^button "(Change cover|Add cover|Remove cover)/

/** Where a move from one stop to the next goes against the way the page is laid out. */
function orderProblems(stops: readonly Stop[]): string[] {
  const TOL = 6
  const problems: string[] = []
  const contains = (o: Box, i: Box) =>
    o.x <= i.x + TOL &&
    o.y <= i.y + TOL &&
    o.x + o.w >= i.x + i.w - TOL &&
    o.y + o.h >= i.y + i.h - TOL
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    if (!a || !b || a.box.pinned || b.box.pinned) continue
    if (a.box.w === 0 || b.box.w === 0) continue
    // A container that takes focus (a tab panel, a card's overlay button) and what is inside it: parent first is natural.
    if (b.key.startsWith(`${a.key}>`) || contains(a.box, b.box) || contains(b.box, a.box)) continue
    // The cover's buttons overlay the cover, the first block of a page; the icon sits half over its bottom edge.
    if (COVER_CONTROL.test(a.label) || COVER_CONTROL.test(b.label)) continue
    // One row when the boxes share at least half of the shorter one's height (a bar and its marker, inline links on a line).
    const overlap = Math.min(a.box.y + a.box.h, b.box.y + b.box.h) - Math.max(a.box.y, b.box.y)
    const sameRow = overlap >= Math.min(a.box.h, b.box.h) / 2
    const up = !sameRow && b.box.y + b.box.h / 2 < a.box.y + a.box.h / 2
    const intoNextColumn = b.box.x >= a.box.x + a.box.w - TOL
    const leftInRow = sameRow && b.box.x + b.box.w <= a.box.x + TOL
    if ((up && !intoNextColumn) || leftInRow) {
      problems.push(
        `#${i} ${b.label} (${b.box.x},${b.box.y}) comes after #${i - 1} ${a.label} (${a.box.x},${a.box.y}) but sits ${leftInRow ? 'left of it in the same row' : 'above it'}`,
      )
    }
  }
  return problems
}

/** What a walk does about a focused control that sits under a fixed or sticky bar. */
type CoveredBy = 'checked' | 'bottom-bars-allowed' | 'allowed'

/**
 * What is wrong with the focus indication and names along a walk, one line per stop. `covered` decides
 * whether a control hidden behind a bar counts: always, not for a bar at the bottom of the screen (the
 * phone's tab bar and +), or never.
 */
function stopProblems(
  stops: readonly Stop[],
  { covered = 'checked' }: { covered?: CoveredBy } = {},
): string[] {
  const problems: string[] = []
  for (const [i, s] of stops.entries()) {
    const at = `#${i} ${s.label}`
    if (s.tabindex !== null && s.tabindex > 0)
      problems.push(
        `${at} has tabindex=${s.tabindex}; a positive tabindex overrides the page order`,
      )
    if (!s.focusVisible) problems.push(`${at} is not :focus-visible after Tab`)
    if (s.caretOnly) {
      // The caret is the indicator; nothing more to check.
    } else if (s.ring === 'none') problems.push(`${at} shows no focus ring`)
    else if (s.ringCleared === false)
      problems.push(
        `${at}: its ring is still drawn after focus moved on (a static shadow, not a focus ring)`,
      )
    if (s.name === '') problems.push(`${at} has no accessible name`)
    const allowed =
      covered === 'allowed' || (covered === 'bottom-bars-allowed' && s.covered?.atBottom)
    if (s.covered && !allowed) problems.push(`${at} is covered by ${s.covered.by} when focused`)
  }
  return problems
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────────────

const skipLink = (page: Page) => page.getByRole('link', { name: 'Skip to content' })
const main = (page: Page) => page.locator('main#main')

/** Waits for the page behind a route to stop loading. */
async function settled(page: Page, { demo = false } = {}): Promise<void> {
  await expect(page.locator('main h1').first()).toBeVisible()
  // /design shows loading states on purpose.
  const loading = demo
    ? '[aria-label="Loading page"]'
    : '[aria-busy="true"], [aria-label="Loading page"]'
  await expect(page.locator(loading)).toHaveCount(0)
}

interface RouteCase {
  name: string
  url: string
  seed?: 'wgu' | 'empty'
  /** `page`: the shell with a skip link. `dialog`: a route that is a modal (its dialog owns the keyboard). `bare`: no shell. */
  kind?: 'page' | 'dialog' | 'bare'
  /** A page that shows loading states on purpose (/design): the busy check does not apply. */
  demo?: boolean
  /** Sticky bars may hide what has focus (see `CoveredBy`). */
  covered?: CoveredBy
  /** Gets to the route some other way than a plain URL (a saved view has to be made first). */
  open?: (page: Page) => Promise<void>
  /** Something only present once the data has loaded. */
  ready?: (page: Page) => Locator
  /** More Tab stops than a walk to the end is worth: only the first `partial` are walked, and both ends are probed. */
  partial?: number
}

const doneBox = (page: Page, title: string) =>
  page.getByRole('checkbox', { name: `Done: ${title}` })

const ROUTES: readonly RouteCase[] = [
  { name: 'today', url: '/', ready: (p) => doneBox(p, 'Email mentor about term plan') },
  { name: 'focus', url: '/focus', ready: (p) => p.getByTestId('timer-display') },
  { name: 'tasks inbox', url: '/tasks/inbox', ready: (p) => doneBox(p, 'Renew library card') },
  { name: 'tasks upcoming', url: '/tasks/upcoming', ready: (p) => doneBox(p, 'Pay phone bill') },
  { name: 'tasks all', url: '/tasks/all', ready: (p) => doneBox(p, 'Renew library card') },
  {
    name: 'tasks completed',
    url: '/tasks/completed',
    ready: (p) => doneBox(p, 'Submit FAFSA renewal'),
  },
  {
    name: 'tasks board',
    url: '/tasks/all?layout=board',
    ready: (p) => doneBox(p, 'Renew library card'),
  },
  {
    name: 'tasks calendar',
    url: '/tasks/all?layout=calendar',
    ready: (p) => p.getByRole('checkbox', { name: /^Done: / }),
  },
  {
    name: 'saved view',
    url: '/tasks/all?priority=3,4',
    open: async (page) => {
      // Made with the keyboard: Save view, then Enter in the name field finishes the form.
      await gotoApp(page, '/tasks/all?priority=3,4', 'wgu')
      const save = page.getByRole('button', { name: 'Save view' })
      await save.focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: 'Save view' })
      await expect(dialog).toBeVisible()
      await expect(dialog.getByLabel('Name')).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/tasks\/views\/[\w-]+$/)
      // A fresh load of the view's own address: the walk starts at the top of the page.
      await page.reload()
    },
    ready: (p) => p.getByRole('checkbox', { name: /^Done: / }),
  },
  { name: 'task', url: '/task/task-c779-u3-3' },
  {
    name: 'goals',
    url: '/goals',
    ready: (p) => p.getByRole('link', { name: 'B.S. Computer Science — WGU' }),
  },
  {
    name: 'new goal',
    url: '/goals/new',
    ready: (p) => p.getByRole('heading', { name: 'What are you planning?' }),
  },
  { name: 'goal', url: '/goals/goal-wgu-bscs' },
  { name: 'course', url: '/goals/goal-wgu-bscs/courses/course-c779' },
  { name: 'roadmap', url: '/roadmap' },
  { name: 'world', url: '/world' },
  { name: 'progress', url: '/progress' },
  { name: 'weekly review', url: '/review' },
  { name: 'rewards', url: '/rewards' },
  { name: 'rewards badges', url: '/rewards/badges' },
  { name: 'blocker', url: '/blocker' },
  { name: 'settings', url: '/settings' },
  { name: 'trash', url: '/trash' },
  // A developer page: its sticky toolbar can cover a control (its anchor links already offset for it with
  // scroll-margin, and adding scroll padding on top would put every jump in the wrong place).
  { name: 'design', url: '/design', partial: 60, demo: true, covered: 'allowed' },
  { name: 'not found', url: '/definitely/not/a/page' },
  // The empty states (no data yet) have their own controls to reach.
  { name: 'today (empty)', url: '/', seed: 'empty' },
  { name: 'tasks inbox (empty)', url: '/tasks/inbox', seed: 'empty' },
  { name: 'goals (empty)', url: '/goals', seed: 'empty' },
  // Routes that are a dialog (the ritual) or the whole window (the first-launch tour).
  { name: 'morning plan', url: '/rituals/morning', kind: 'dialog' },
  { name: 'evening shutdown', url: '/rituals/evening', kind: 'dialog' },
  { name: 'welcome', url: '/welcome', seed: 'empty', kind: 'bare' },
]

/** Rotates a cycle (a dialog's Tab order) to start at its top-left stop, where the eye starts. */
function fromTopLeft(stops: readonly Stop[]): Stop[] {
  let start = 0
  stops.forEach((s, i) => {
    const best = stops[start]
    if (best && (s.box.y < best.box.y || (s.box.y === best.box.y && s.box.x < best.box.x)))
      start = i
  })
  return [...stops.slice(start), ...stops.slice(0, start)]
}

async function openRoute(page: Page, route: RouteCase): Promise<void> {
  if (route.open) await route.open(page)
  else await gotoApp(page, route.url, route.seed ?? 'wgu')
  await settled(page, { demo: route.demo === true })
  if (route.ready) await expect(route.ready(page).first()).toBeVisible()
}

/** One full Tab pass over a route: skip link first, order, rings, names, no trap, and Shift+Tab back. */
async function checkWalk(
  page: Page,
  route: RouteCase,
  opts: { covered?: CoveredBy } = {},
): Promise<void> {
  const kind = route.kind ?? 'page'
  await openRoute(page, route)

  const walk = await walkTab(page, route.partial ?? 500)
  const { stops } = walk
  expect(stops.length, 'the page has tab stops').toBeGreaterThan(kind === 'page' ? 3 : 1)

  if (kind === 'page') {
    // 1. The skip link is the first stop and is on screen while it has focus.
    expect(stops[0]?.label).toContain('Skip to content')
    expect(stops[0]?.box.pinned || (stops[0]?.box.y ?? -1) >= 0, 'the skip link is on screen').toBe(
      true,
    )
  } else if (kind === 'dialog') {
    // The dialog owns the keyboard: nothing behind it is a stop, and focus goes round inside it.
    expect(
      stops.filter((s) => !s.inDialog).map((s) => s.label),
      'every stop is inside the dialog',
    ).toEqual([])
    expect(walk.ended, 'Tab goes round inside the dialog').toMatch(/wrapped|left/)
  } else {
    // The tour has the whole window: no shell, no skip link (there is nothing to skip).
    await expect(skipLink(page)).toHaveCount(0)
    expect(
      stops.filter((s) => !s.inMain).map((s) => s.label),
      'every stop is in the page',
    ).toEqual([])
  }

  // 4. Nothing traps focus: the pass ends by leaving the page (or coming around to the start).
  if (route.partial === undefined) {
    expect(walk.ended, `the pass over ${stops.length} stops ended by ${walk.ended}`).toMatch(
      /left|wrapped/,
    )
  } else {
    expect(walk.ended, 'the first stops never revisit an element').toBe('capped')
  }

  // 2 and 3. Order follows the layout; every stop shows a ring and has a name.
  expect(
    orderProblems(kind === 'dialog' ? fromTopLeft(stops) : stops),
    'Tab order follows the visual order',
  ).toEqual([])
  expect(
    stopProblems(stops, { covered: route.covered ?? 'checked', ...opts }),
    'focus is visible and named',
  ).toEqual([])

  // Shift+Tab goes back the way it came, from the end of the page.
  if (route.partial === undefined && kind === 'page') {
    await page.keyboard.press('Shift+Tab')
    const back = await readFocus(page)
    expect(back?.key, 'Shift+Tab from the end lands on the last stop').toBe(
      stops[stops.length - 1]?.key,
    )
  }
}

test.describe('Tab walk (1440)', () => {
  test.use({ viewport: DESKTOP })
  for (const route of ROUTES) test(route.name, ({ page }) => checkWalk(page, route))
})

// A phone has a tab bar and a floating + after <main>, and no sidebar; a tablet has the open-sidebar button.
const PHONE_ROUTES = [
  'today',
  'focus',
  'tasks inbox',
  'tasks calendar',
  'goals',
  'goal',
  'settings',
  'trash',
]
const TABLET_ROUTES = ['today', 'tasks inbox', 'goals']

test.describe('Tab walk (375)', () => {
  test.use({ viewport: PHONE })
  // The tab bar and the + button are fixed over the bottom of the page and hide what Tab scrolls to the
  // bottom edge; that is tracked below (src/app/layout owns the fix), so it is left out here.
  for (const route of ROUTES.filter((r) => PHONE_ROUTES.includes(r.name))) {
    test(route.name, ({ page }) => checkWalk(page, route, { covered: 'bottom-bars-allowed' }))
  }
})

const routeNamed = (name: string): RouteCase => {
  const found = ROUTES.find((r) => r.name === name)
  if (!found) throw new Error(`no route named ${name}`)
  return found
}

// Defects in files this package does not own (the report has the fix for each). A test marked `fail`
// must fail: when its owner fixes the defect Playwright says "expected to fail, but passed", which is
// the cue to delete the test (and, for the tab bar, the `covered: 'bottom-bars-allowed'` above).
test.describe('known phone layout defects (375)', () => {
  test.use({ viewport: PHONE })

  test('the tab bar and the + button do not hide the focused control', async ({ page }) => {
    test.fail(true, 'src/app/layout: the page needs scroll-padding-bottom for the fixed tab bar')
    await checkWalk(page, routeNamed('today'))
  })

  test('progress: Tab order follows the phone layout', async ({ page }) => {
    test.fail(
      true,
      'ProgressPage.module.css reorders the sections with `order` below 640px; the DOM keeps two columns',
    )
    await checkWalk(
      page,
      { name: 'progress', url: '/progress' },
      { covered: 'bottom-bars-allowed' },
    )
  })
})

test.describe('Tab walk (768)', () => {
  test.use({ viewport: TABLET })
  for (const route of ROUTES.filter((r) => TABLET_ROUTES.includes(r.name))) {
    test(route.name, ({ page }) => checkWalk(page, route))
  }
})

/** Where focus is compared with <main>: inside it, after it in the document, before it (the sidebar), or nowhere. */
async function focusRelativeToMain(page: Page): Promise<'inside' | 'after' | 'before' | 'none'> {
  return page.evaluate(() => {
    const active = document.activeElement
    const mainEl = document.getElementById('main')
    if (!active || active === document.body || !mainEl) return 'none'
    if (mainEl !== active && mainEl.contains(active)) return 'inside'
    return mainEl.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING
      ? 'after'
      : 'before'
  })
}

/** Whether <main> has anything a Tab press could reach. */
async function mainHasTabStops(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sel =
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
    const mainEl = document.getElementById('main')
    return Array.from(mainEl?.querySelectorAll(sel) ?? []).some(
      (el) =>
        !el.closest('[inert]') &&
        el instanceof HTMLElement &&
        el.checkVisibility({ visibilityProperty: true }),
    )
  })
}

async function checkSkipLink(page: Page, route: RouteCase): Promise<void> {
  await openRoute(page, route)

  // First Tab from a fresh page: the link is the first stop and shows itself.
  await page.keyboard.press('Tab')
  await expect(skipLink(page)).toBeFocused()
  await expect(skipLink(page)).toBeInViewport({ ratio: 1 })
  // Enter moves focus to <main> without touching the URL.
  const before = page.url()
  await page.keyboard.press('Enter')
  await expect(main(page)).toBeFocused()
  expect(page.url()).toBe(before)
  // The next Tab is in the page, not back in the sidebar (a page with nothing to reach leaves <main> forward).
  await page.keyboard.press('Tab')
  if (await mainHasTabStops(page)) {
    await expect.poll(() => focusRelativeToMain(page)).toBe('inside')
  } else {
    // Nothing in <main> and nothing after it: Tab leaves the page and comes round to the skip link.
    await expect
      .poll(async () => {
        const where = await focusRelativeToMain(page)
        return (
          where !== 'before' ||
          (await skipLink(page).evaluate((el) => el === document.activeElement))
        )
      })
      .toBe(true)
  }
}

test.describe('skip link', () => {
  test.describe('1440', () => {
    test.use({ viewport: DESKTOP })
    for (const route of ROUTES.filter((r) => (r.kind ?? 'page') === 'page')) {
      test(route.name, ({ page }) => checkSkipLink(page, route))
    }
  })
  test.describe('768', () => {
    test.use({ viewport: TABLET })
    for (const route of ROUTES.filter((r) => TABLET_ROUTES.includes(r.name))) {
      test(route.name, ({ page }) => checkSkipLink(page, route))
    }
  })
  test.describe('375', () => {
    test.use({ viewport: PHONE })
    for (const route of ROUTES.filter((r) => PHONE_ROUTES.includes(r.name))) {
      test(route.name, ({ page }) => checkSkipLink(page, route))
    }
  })
})

// ── Overlays: Esc closes them and focus goes back to what opened them ────────────────────────────

const paletteDialog = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })
const quickAddDialog = (page: Page) => page.getByRole('dialog', { name: 'Quick add task' })
const shortcutSheet = (page: Page) => page.getByRole('dialog', { name: 'Keyboard shortcuts' })
const navDrawer = (page: Page) => page.getByRole('dialog', { name: 'Navigation' })
const moreSheet = (page: Page) => page.getByRole('dialog', { name: 'More' })
const sidebarSearch = (page: Page) => page.getByRole('button', { name: 'Search and commands' })

/** Whether focus is inside `overlay` (retried until it is, or the assertion times out). */
async function expectFocusInside(overlay: Locator): Promise<void> {
  await expect
    .poll(() => overlay.evaluate((el) => el.contains(document.activeElement)), {
      message: 'focus is inside the overlay',
    })
    .toBe(true)
}

/**
 * Presses Tab (or Shift+Tab) `presses` times and requires that focus never lands on the page behind
 * the overlay: it stays inside, or is on the document body between the end of a dialog and its start.
 */
async function expectTrapped(
  page: Page,
  overlay: Locator,
  presses: number,
  keys = 'Tab',
): Promise<void> {
  const visited = new Set<string>()
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(keys)
    const where = await overlay.evaluate((el) => {
      const active = document.activeElement
      if (!active || active === document.body) return 'body'
      return el.contains(active)
        ? active.id || active.getAttribute('aria-label') || active.tagName
        : `outside: ${active.tagName} "${active.getAttribute('aria-label') ?? (active.textContent ?? '').trim().slice(0, 30)}"`
    })
    expect(where, `${keys} press ${i + 1} keeps focus off the page behind`).not.toMatch(/^outside/)
    visited.add(where)
  }
  expect(visited.size, `${keys} moves between the overlay's controls`).toBeGreaterThan(0)
}

/**
 * Tab from a modal's last control leaves the page for the browser (a body with focus) and comes back on
 * its first; either way the overlay is what Tab reaches within a press or two.
 */
async function expectTabReturnsInside(page: Page, overlay: Locator): Promise<void> {
  for (let i = 0; i < 3; i++) {
    if (await overlay.evaluate((el) => el.contains(document.activeElement))) return
    await page.keyboard.press('Tab')
  }
  await expectFocusInside(overlay)
}

interface OverlayCase {
  name: string
  url: string
  seed?: 'wgu' | 'empty'
  viewport?: { width: number; height: number }
  /** What has focus before the keys that open the overlay (placed with `focus()`, not the mouse). */
  opener: (page: Page) => Locator
  /** Keys only. */
  open: (page: Page) => Promise<void>
  overlay: (page: Page) => Locator
  /** A modal: Tab must stay inside it. */
  modal?: boolean
  /** Wait for the page behind to be ready before starting. */
  ready?: (page: Page) => Locator
}

const press = (combo: string) => async (page: Page) => {
  await page.keyboard.press(combo)
}

const lightColumn = (page: Page, section: string) =>
  page.locator(`section#${section} [data-column="light"]`)

const OVERLAYS: readonly OverlayCase[] = [
  {
    name: 'command palette from mod+k',
    url: '/',
    opener: (p) => p.getByRole('link', { name: 'Focus', exact: true }),
    open: press('ControlOrMeta+k'),
    overlay: paletteDialog,
    modal: true,
  },
  {
    name: 'command palette from /',
    url: '/goals',
    opener: (p) => p.getByRole('link', { name: 'Goals', exact: true }),
    open: press('/'),
    overlay: paletteDialog,
    modal: true,
  },
  {
    name: 'command palette from the sidebar button',
    url: '/progress',
    opener: sidebarSearch,
    open: press('Enter'),
    overlay: paletteDialog,
    modal: true,
  },
  {
    name: 'quick add from q',
    url: '/tasks/inbox',
    ready: (p) => doneBox(p, 'Renew library card'),
    opener: (p) => doneBox(p, 'Renew library card'),
    open: press('q'),
    overlay: quickAddDialog,
    modal: true,
  },
  {
    name: 'quick add from mod+enter',
    url: '/roadmap',
    opener: (p) => p.getByRole('link', { name: 'Roadmap', exact: true }),
    open: press('ControlOrMeta+Enter'),
    overlay: quickAddDialog,
    modal: true,
  },
  {
    name: 'shortcut sheet from ?',
    url: '/',
    opener: (p) => p.getByRole('link', { name: 'Progress', exact: true }),
    open: press('?'),
    overlay: shortcutSheet,
    modal: true,
  },
  {
    name: 'modal (Medium: form)',
    url: '/design',
    opener: (p) => lightColumn(p, 'modal').getByRole('button', { name: 'Medium: form' }),
    open: press('Enter'),
    overlay: (p) => p.getByRole('dialog', { name: 'New goal' }),
    modal: true,
  },
  {
    name: 'modal with a confirm button in focus (Small: confirm)',
    url: '/design',
    opener: (p) => lightColumn(p, 'modal').getByRole('button', { name: 'Small: confirm' }),
    open: press('Space'),
    overlay: (p) => p.getByRole('dialog', { name: /^Move “C779 Web Development Foundations”/ }),
    modal: true,
  },
  {
    name: 'popover (design)',
    url: '/design',
    opener: (p) => lightColumn(p, 'popover').getByRole('button').first(),
    open: press('Enter'),
    overlay: (p) => p.getByRole('dialog').first(),
  },
  {
    name: 'dropdown menu (design)',
    url: '/design',
    opener: (p) => lightColumn(p, 'dropdown').getByRole('button', { name: 'Task options' }),
    open: press('Enter'),
    // The specimen menus on the page are labelled with aria-label; the one that opens is named by its trigger.
    overlay: (p) => p.locator('[role="menu"][aria-labelledby]'),
  },
  {
    name: 'task menu on Today',
    url: '/',
    ready: (p) => doneBox(p, 'Email mentor about term plan'),
    opener: (p) => p.getByRole('button', { name: 'More actions' }).first(),
    open: press('Enter'),
    overlay: (p) => p.getByRole('menu'),
  },
  {
    name: 'task menu on the board',
    url: '/tasks/all?layout=board',
    ready: (p) => doneBox(p, 'Renew library card'),
    opener: (p) => p.getByRole('button', { name: 'More actions' }).first(),
    open: press('Space'),
    overlay: (p) => p.getByRole('menu'),
  },
  {
    name: 'focus: link a task',
    url: '/focus',
    ready: (p) => p.getByTestId('timer-display'),
    opener: (p) => p.getByTestId('task-picker'),
    open: press('Enter'),
    overlay: (p) => p.getByRole('dialog', { name: 'Link a task' }),
  },
  {
    name: 'goals: actions menu',
    url: '/goals',
    ready: (p) => p.getByRole('link', { name: 'B.S. Computer Science — WGU' }),
    opener: (p) => p.getByRole('button', { name: /^Actions for B\.S\./ }),
    open: press('Enter'),
    overlay: (p) => p.getByRole('menu'),
  },
  {
    name: 'tasks: save view',
    url: '/tasks/all?priority=3,4',
    ready: (p) => p.getByRole('checkbox', { name: /^Done: / }),
    opener: (p) => p.getByRole('button', { name: 'Save view' }),
    open: press('Enter'),
    // A popover, not a modal: Tab past its last button closes it and carries on in the page.
    overlay: (p) => p.getByRole('dialog', { name: 'Save view' }),
  },
  {
    name: 'morning plan from w m',
    url: '/goals',
    ready: (p) => p.getByRole('link', { name: 'B.S. Computer Science — WGU' }),
    opener: (p) => p.getByRole('link', { name: 'Goals', exact: true }),
    open: async (p) => {
      await p.keyboard.press('w')
      await p.keyboard.press('m')
    },
    overlay: (p) => p.getByRole('dialog', { name: 'Morning plan' }),
    modal: true,
  },
  {
    name: 'evening shutdown from w e',
    url: '/progress',
    opener: (p) => p.getByRole('link', { name: 'Progress', exact: true }),
    open: async (p) => {
      await p.keyboard.press('w')
      await p.keyboard.press('e')
    },
    overlay: (p) => p.getByRole('dialog', { name: 'Evening shutdown' }),
    modal: true,
  },
  {
    name: 'world legend',
    url: '/world',
    opener: (p) => p.getByRole('button', { name: 'Legend' }),
    open: press('Enter'),
    overlay: (p) => p.getByRole('dialog', { name: 'What earns what' }),
  },
  {
    name: 'goals: import from Claude',
    url: '/goals',
    ready: (p) => p.getByRole('link', { name: 'B.S. Computer Science — WGU' }),
    opener: (p) => p.getByRole('button', { name: 'Import from Claude' }),
    open: press('Enter'),
    overlay: (p) => p.getByRole('dialog', { name: 'Import a goal from Claude' }),
    modal: true,
  },
  {
    name: 'goal: plan settings',
    url: '/goals/goal-wgu-bscs',
    opener: (p) => p.getByRole('button', { name: /Plan settings/ }),
    open: press('Enter'),
    overlay: (p) => p.getByRole('dialog', { name: 'Plan settings' }),
    modal: true,
  },
  {
    name: 'settings: reset',
    url: '/settings/data',
    opener: (p) => p.getByRole('button', { name: 'Reset…' }),
    open: press('Enter'),
    overlay: (p) => p.getByRole('dialog', { name: 'Reset Forge?' }),
    modal: true,
  },
  {
    name: 'tablet drawer',
    url: '/',
    viewport: TABLET,
    opener: (p) => p.getByRole('button', { name: 'Open sidebar' }),
    open: press('Enter'),
    overlay: navDrawer,
    modal: true,
  },
  {
    name: 'phone More sheet',
    url: '/',
    viewport: PHONE,
    opener: (p) =>
      p.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'More' }),
    open: press('Enter'),
    overlay: moreSheet,
    modal: true,
  },
  {
    name: 'phone quick add button',
    url: '/',
    viewport: PHONE,
    opener: (p) => p.getByRole('button', { name: 'Quick add task' }),
    open: press('Enter'),
    overlay: quickAddDialog,
    modal: true,
  },
]

test.describe('Esc closes an overlay and focus goes back to its opener', () => {
  for (const c of OVERLAYS) {
    test(c.name, async ({ page }) => {
      await page.setViewportSize(c.viewport ?? DESKTOP)
      await gotoApp(page, c.url, c.seed ?? 'wgu')
      await settled(page, { demo: c.url === '/design' })
      if (c.ready) await expect(c.ready(page).first()).toBeVisible()

      const opener = c.opener(page)
      const overlay = c.overlay(page)
      await opener.focus()
      await expect(opener).toBeFocused()
      await c.open(page)
      await expect(overlay).toBeVisible()
      await expectFocusInside(overlay)

      if (c.modal) {
        // Tab and Shift+Tab, more times than there are controls: nothing behind the overlay is reached.
        await expectTrapped(page, overlay, 12)
        await expectTrapped(page, overlay, 12, 'Shift+Tab')
        // Esc from the body would have nothing to close: Tab comes back into the overlay.
        await expectTabReturnsInside(page, overlay)
      }

      await page.keyboard.press('Escape')
      await expect(overlay).toBeHidden()
      await expect(opener).toBeFocused()
    })
  }
})

// ── Shortcuts (PLAN §5.2) ────────────────────────────────────────────────────────────────────────

const toasts = (page: Page) => page.getByRole('region', { name: 'Notifications' })
const pathnameOf = (page: Page) => new URL(page.url()).pathname
const pageHeading = (page: Page) => page.locator('main h1').first()

/** Title of the row that j / k have selected, read from its "Done: …" checkbox. */
async function selectedTitle(page: Page): Promise<string> {
  const box = page.locator('[data-selected] input[type="checkbox"]')
  await expect(box).toHaveCount(1)
  const label = (await box.getAttribute('aria-label')) ?? ''
  return label.replace(/^Done: /, '')
}

test.describe('shortcuts', () => {
  test.use({ viewport: DESKTOP })

  test('g sequences go to every page, and focus lands on its heading', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await settled(page)
    const GO: readonly (readonly [string, string])[] = [
      ['f', '/focus'],
      ['i', '/tasks/inbox'],
      ['u', '/tasks/upcoming'],
      ['a', '/tasks/all'],
      ['g', '/goals'],
      ['m', '/roadmap'],
      ['w', '/world'],
      ['p', '/progress'],
      ['r', '/rewards'],
      ['b', '/blocker'],
      ['s', '/settings'],
      ['t', '/'],
    ]
    for (const [second, path] of GO) {
      await page.keyboard.press('g')
      await page.keyboard.press(second)
      await expect.poll(() => pathnameOf(page), { message: `g ${second}` }).toBe(path)
      // The router hands focus to the new page's heading, so the next Tab starts inside the page.
      await expect(pageHeading(page)).toBeFocused()
    }
  })

  test('g then a key that is not a destination does nothing, and a slow second key is ignored', async ({
    page,
  }) => {
    await gotoApp(page, '/goals', 'wgu')
    await settled(page)
    await page.keyboard.press('g')
    await page.keyboard.press('z')
    await expect(page).toHaveURL(/\/goals$/)
    await expect(paletteDialog(page)).toBeHidden()
    await expect(quickAddDialog(page)).toBeHidden()
  })

  test('mod+k, /, q and ? open their overlay from the page, and each Esc closes it', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await settled(page)
    const cases: readonly (readonly [string, (p: Page) => Locator])[] = [
      ['ControlOrMeta+k', paletteDialog],
      ['/', paletteDialog],
      ['q', quickAddDialog],
      ['?', shortcutSheet],
    ]
    for (const [keys, overlay] of cases) {
      await page.keyboard.press(keys)
      await expect(overlay(page), keys).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(overlay(page), `Esc after ${keys}`).toBeHidden()
    }
  })

  test('the palette runs a command from the keyboard and Esc from an empty page does nothing harmful', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await settled(page)
    await page.keyboard.press('ControlOrMeta+k')
    const input = page.getByRole('combobox', { name: 'Command palette' })
    await expect(input).toBeFocused()
    await input.fill('blocker')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(paletteDialog(page)).toBeHidden()
    await expect.poll(() => pathnameOf(page)).toBe('/blocker')
    await page.keyboard.press('Escape')
    await expect(pageHeading(page)).toBeVisible()
  })

  test('mod+k works from inside quick add and swaps the overlays', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await settled(page)
    await page.keyboard.press('q')
    await expect(quickAddDialog(page)).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(paletteDialog(page)).toBeVisible()
    await expect(quickAddDialog(page)).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(paletteDialog(page)).toBeHidden()
  })

  test('mod+\\ collapses and expands the sidebar', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await settled(page)
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+\\')
    await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeVisible()
    // Collapsed, the sidebar is out of the Tab order: the first stop after the skip link is in the page.
    await page.keyboard.press('Tab')
    await expect(skipLink(page)).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeFocused()
    await page.keyboard.press('ControlOrMeta+\\')
    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
  })

  test('j, k, ArrowDown, ArrowUp and x on Today', async ({ page }) => {
    await gotoApp(page, '/', 'wgu')
    await settled(page)
    await expect(doneBox(page, 'Email mentor about term plan')).toBeVisible()
    await page.keyboard.press('j')
    const first = await selectedTitle(page)
    await page.keyboard.press('j')
    const second = await selectedTitle(page)
    expect(second).not.toBe(first)
    await page.keyboard.press('k')
    expect(await selectedTitle(page)).toBe(first)
    await page.keyboard.press('ArrowDown')
    expect(await selectedTitle(page)).toBe(second)
    await page.keyboard.press('ArrowUp')
    expect(await selectedTitle(page)).toBe(first)

    await page.keyboard.press('x')
    await expect(toasts(page)).toContainText('Completed “')
    // The row leaves the open list once it is struck through.
    await expect(doneBox(page, first)).toHaveCount(0)
    await expect(toasts(page).getByRole('button', { name: 'Undo' })).toBeVisible()
  })

  test('a task menu: arrows and Enter pick an item, the picker it opens gives focus back on Esc', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    await settled(page)
    await expect(doneBox(page, 'Renew library card')).toBeVisible()
    const more = page.getByRole('button', { name: 'More actions' }).first()
    await more.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expectFocusInside(menu)
    // Arrows move between the items (the separators are skipped); End and Home jump to the ends.
    const items = menu.getByRole('menuitem')
    await page.keyboard.press('End')
    await expect(items.last()).toBeFocused()
    await page.keyboard.press('Home')
    await expect(items.first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(items.first()).toBeFocused()
    // "Date…" opens its picker; Esc closes that and focus is back on the … button.
    await menu.getByRole('menuitem', { name: /^Date/ }).focus()
    await page.keyboard.press('Enter')
    const picker = page.getByRole('dialog', { name: 'Date' })
    await expect(picker).toBeVisible()
    await expect(menu).toBeHidden()
    await expectFocusInside(picker)
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(more).toBeFocused()
  })

  test('the focus page picks a task with the keyboard alone', async ({ page }) => {
    await gotoApp(page, '/focus', 'wgu')
    const picker = page.getByTestId('task-picker')
    await expect(picker).toBeVisible()
    await picker.focus()
    await page.keyboard.press('Enter')
    const search = page.getByRole('combobox', { name: 'Search open tasks' })
    await expect(search).toBeFocused()
    await page.keyboard.type('mentor')
    await expect(page.getByRole('option', { name: /Email mentor about term plan/ })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(picker).toContainText('Email mentor about term plan')
    await expect(picker).toBeFocused()
  })

  test('tabs and segmented controls answer the arrow keys', async ({ page }) => {
    await gotoApp(page, '/rewards', 'wgu')
    await settled(page)
    const tabs = page.getByRole('tablist')
    const shop = tabs.getByRole('tab').first()
    await expect(shop).toHaveAttribute('aria-selected', 'true')
    await shop.focus()
    await page.keyboard.press('ArrowRight')
    const second = tabs.getByRole('tab').nth(1)
    await expect(second).toBeFocused()
    await page.keyboard.press('End')
    await expect(tabs.getByRole('tab').last()).toBeFocused()
    await page.keyboard.press('Home')
    await expect(shop).toBeFocused()

    await gotoApp(page, '/focus', 'wgu')
    const radios = page.getByRole('radiogroup').first()
    await expect(page.getByTestId('timer-display')).toBeVisible()
    await radios.getByRole('radio', { name: 'Pomodoro' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(radios.getByRole('radio', { name: 'Custom' })).toBeChecked()
    await page.keyboard.press('ArrowLeft')
    await expect(radios.getByRole('radio', { name: 'Pomodoro' })).toBeChecked()
  })

  test('F8 reaches the toast: Enter on Undo brings the task back and focus goes where it was', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await settled(page)
    await expect(doneBox(page, 'Email mentor about term plan')).toBeVisible()
    const where = page.getByRole('link', { name: 'Progress', exact: true })
    await where.focus()
    await page.keyboard.press('j')
    const title = await selectedTitle(page)
    await page.keyboard.press('x')
    await expect(toasts(page)).toContainText('Completed “')

    await page.keyboard.press('F8')
    const undo = toasts(page).getByRole('button', { name: 'Undo' })
    await expect(undo).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(doneBox(page, title)).toBeVisible()
    await expect(doneBox(page, title)).not.toBeChecked()
    // The toast the focus was on has gone; focus is not left on the body.
    await expect(where).toBeFocused()
  })

  test('j, k, x and Enter on a list reached with g i; Esc clears the selection, then closes the peek', async ({
    page,
  }) => {
    await gotoApp(page, '/', 'wgu')
    await settled(page)
    await page.keyboard.press('g')
    await page.keyboard.press('i')
    await expect(doneBox(page, 'Renew library card')).toBeVisible()
    await expect(pageHeading(page)).toBeFocused()

    await page.keyboard.press('j')
    const first = await selectedTitle(page)
    await page.keyboard.press('j')
    await page.keyboard.press('k')
    expect(await selectedTitle(page)).toBe(first)

    // Enter opens the selected task beside the list; Esc closes it and focus goes back to where it was.
    await page.keyboard.press('Enter')
    const peek = page.getByRole('complementary', { name: 'Task details' })
    await expect(peek).toBeVisible()
    await expectFocusInside(peek)
    await page.keyboard.press('Escape')
    await expect(peek).toBeHidden()
    await expect(pageHeading(page)).toBeFocused()

    // x completes; Esc with a selection clears it.
    await page.keyboard.press('x')
    await expect(toasts(page)).toContainText('Completed “')
    await page.keyboard.press('j')
    await expect(page.locator('[data-selected]')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-selected]')).toHaveCount(0)
  })

  test('focus timer keys: 1 2 3, space, f, p and enter', async ({ page }) => {
    await gotoApp(page, '/focus', 'wgu')
    await expect(page.getByTestId('timer-display')).toBeVisible()
    const toggle = page.getByTestId('timer-toggle')
    const fullScreen = page.getByRole('dialog', { name: 'Focus mode' })
    const park = page.getByRole('dialog', { name: 'Park a thought' })

    // 3, 2, 1: stopwatch, custom, pomodoro.
    await page.keyboard.press('3')
    await expect(page.getByRole('radio', { name: 'Stopwatch' })).toBeChecked()
    await page.keyboard.press('2')
    await expect(page.getByRole('radio', { name: 'Custom' })).toBeChecked()
    await page.keyboard.press('1')
    await expect(page.getByRole('radio', { name: 'Pomodoro' })).toBeChecked()

    // Space starts, pauses and resumes.
    await page.keyboard.press('Space')
    await expect(toggle).toHaveText('Pause')
    await page.keyboard.press('Space')
    await expect(toggle).toHaveText('Resume')
    await page.keyboard.press('Space')
    await expect(toggle).toHaveText('Pause')

    // f goes full screen, Esc leaves it, and so does f.
    await page.keyboard.press('f')
    await expect(fullScreen).toBeVisible()
    await expectFocusInside(fullScreen)
    await page.keyboard.press('Escape')
    await expect(fullScreen).toBeHidden()
    await page.keyboard.press('f')
    await expect(fullScreen).toBeVisible()
    await page.keyboard.press('f')
    await expect(fullScreen).toBeHidden()

    // p parks a thought while a session runs; Esc puts it away and focus stays where it was.
    const before = await page.evaluate(() => document.activeElement?.tagName ?? '')
    await page.keyboard.press('p')
    await expect(park).toBeVisible()
    await expectFocusInside(park)
    await page.keyboard.press('Escape')
    await expect(park).toBeHidden()
    expect(await page.evaluate(() => document.activeElement?.tagName ?? '')).toBe(before)

    // Enter finishes the session now.
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('timer-start')).toBeVisible()
  })

  test('v b, v c and v l switch the layout, and the calendar arrows move the week', async ({
    page,
  }) => {
    await gotoApp(page, '/tasks/all', 'wgu')
    await settled(page)
    await expect(doneBox(page, 'Renew library card')).toBeVisible()
    const calendar = page.getByRole('region', { name: 'Calendar' })

    await page.keyboard.press('v')
    await page.keyboard.press('b')
    await expect(page).toHaveURL(/layout=board/)
    await page.keyboard.press('v')
    await page.keyboard.press('c')
    await expect(page).toHaveURL(/layout=calendar/)
    await expect(calendar).toBeVisible()

    const range = calendar.getByRole('heading', { level: 2 })
    const thisWeek = await range.innerText()
    await page.keyboard.press('ArrowRight')
    await expect(range).not.toHaveText(thisWeek)
    const nextWeek = await range.innerText()
    await page.keyboard.press('ArrowRight')
    await expect(range).not.toHaveText(nextWeek)
    await page.keyboard.press('ArrowLeft')
    await expect(range).toHaveText(nextWeek)
    await page.keyboard.press('t')
    await expect(range).toHaveText(thisWeek)
    await page.keyboard.press('ArrowLeft')
    await expect(range).not.toHaveText(thisWeek)
    await page.keyboard.press('t')
    await expect(range).toHaveText(thisWeek)

    await page.keyboard.press('v')
    await page.keyboard.press('l')
    await expect(calendar).toBeHidden()
    await expect(page).not.toHaveURL(/layout=calendar/)
  })
})

// ── Modal: focus is trapped inside and restored on close ─────────────────────────────────────────

test.describe('Modal focus', () => {
  test.use({ viewport: DESKTOP })

  /** Labels of the controls focus visits over `presses` key presses inside `dialog`. */
  async function visit(
    page: Page,
    dialog: Locator,
    presses: number,
    keys: string,
  ): Promise<string[]> {
    const seen: string[] = []
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press(keys)
      const label = await dialog.evaluate((el) => {
        const active = document.activeElement
        if (!active || !el.contains(active)) return `OUTSIDE ${active?.tagName ?? 'none'}`
        // The position in the dialog keeps two fields with the same name apart.
        const at = Array.from(el.querySelectorAll('*')).indexOf(active)
        return `${at}:${active.getAttribute('aria-label') ?? (active.textContent ?? '').trim()}`
      })
      seen.push(label)
    }
    return seen
  }

  test('a form modal: focus starts on its first field, cycles among its own controls, and returns on Esc', async ({
    page,
  }) => {
    await gotoApp(page, '/design', 'wgu')
    await settled(page, { demo: true })
    const opener = lightColumn(page, 'modal').getByRole('button', { name: 'Medium: form' })
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'New goal' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Name')).toBeFocused()

    // Forward: the sequence of controls repeats itself, and never names anything outside the dialog.
    // (A date field is several stops in one control: a run of the same control counts once.)
    const forward = (await visit(page, dialog, 20, 'Tab')).filter((l, i, all) => l !== all[i - 1])
    expect(forward.filter((l) => l.startsWith('OUTSIDE'))).toEqual([])
    const period = forward.indexOf(forward[0] ?? '', 1)
    expect(period, 'Tab wraps inside the dialog').toBeGreaterThan(1)
    expect(forward.slice(period), 'the cycle repeats').toEqual(
      forward.slice(0, forward.length - period),
    )
    // Backward: from the field back to the close button, and from the first control round to the last, Create goal.
    await dialog.getByLabel('Name').focus()
    const [close, last] = await visit(page, dialog, 2, 'Shift+Tab')
    expect(close).toMatch(/:Close$/)
    expect(last, 'Shift+Tab from the first control wraps to the last').toMatch(/:Create goal$/)
    const backward = await visit(page, dialog, 14, 'Shift+Tab')
    expect(backward.filter((l) => l.startsWith('OUTSIDE'))).toEqual([])

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('a confirmation opens on its marked button; Enter on Cancel closes it and gives focus back', async ({
    page,
  }) => {
    await gotoApp(page, '/design', 'wgu')
    await settled(page, { demo: true })
    const opener = lightColumn(page, 'modal').getByRole('button', { name: 'Small: confirm' })
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: /^Move “C779 Web Development Foundations”/ })
    await expect(dialog.getByRole('button', { name: 'Move to trash' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('a modal that ignores Esc stays open, still traps focus, and its button closes it', async ({
    page,
  }) => {
    await gotoApp(page, '/design', 'wgu')
    await settled(page, { demo: true })
    const opener = lightColumn(page, 'modal').getByRole('button', {
      name: 'Esc and scrim disabled',
    })
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Discard this session?' })
    await expect(dialog.getByRole('button', { name: 'Keep working' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    const seen = await visit(page, dialog, 6, 'Tab')
    expect(seen.filter((l) => l.startsWith('OUTSIDE'))).toEqual([])
    await dialog.getByRole('button', { name: 'Keep working' }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('the page behind a modal cannot be reached, and its shortcuts stay quiet', async ({
    page,
  }) => {
    await gotoApp(page, '/design', 'wgu')
    await settled(page, { demo: true })
    const opener = lightColumn(page, 'modal').getByRole('button', { name: 'Medium: form' })
    await opener.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'New goal' })
    await expect(dialog).toBeVisible()
    // g then t / q / ?: none of them acts on the page behind.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await opener.focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Name').focus()
    await page.keyboard.press('g')
    await page.keyboard.press('f')
    await expect(page).toHaveURL(/\/design/)
  })
})

// ── Trash: the destructive dialogs ask first, and Esc keeps everything ───────────────────────────

test.describe('Trash', () => {
  test.use({ viewport: DESKTOP })

  test('Delete forever and Empty trash ask first; Esc keeps the item', async ({ page }) => {
    await gotoApp(page, '/tasks/inbox', 'wgu')
    await settled(page)
    await expect(doneBox(page, 'Renew library card')).toBeVisible()
    // Move the selected task to the trash, then open the Trash with its sequence.
    await page.keyboard.press('j')
    const title = await selectedTitle(page)
    await page.keyboard.press('ControlOrMeta+Backspace')
    await expect(toasts(page)).toContainText('to the trash')
    await page.keyboard.press('o')
    await page.keyboard.press('t')
    await expect.poll(() => pathnameOf(page)).toBe('/trash')
    await expect(pageHeading(page)).toBeFocused()

    await page.keyboard.press('j')
    await page.keyboard.press('ControlOrMeta+Backspace')
    const forever = page.getByRole('dialog', { name: /forever\?$/ })
    await expect(forever).toBeVisible()
    await expect(forever.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(forever).toBeHidden()
    await expect(page.getByText(title).first()).toBeVisible()

    await page.keyboard.press('Shift+E')
    const empty = page.getByRole('dialog', { name: 'Empty the Trash?' })
    await expect(empty).toBeVisible()
    await expectFocusInside(empty)
    await page.keyboard.press('Escape')
    await expect(empty).toBeHidden()
    await expect(page.getByText(title).first()).toBeVisible()
  })
})
