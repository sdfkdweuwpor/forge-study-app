import { whenIdle, yieldToMain } from '@/lib/idle'
import type { Registry } from './registry'
import { SLOT_IDS, type SlotId } from './registry/slots'
import { matchRoute } from './router/match'
import type { RouteName } from './router/routes'

/**
 * Code that is not in the first download. Pages and most slot components are `React.lazy`, so each is
 * its own chunk; left alone a chunk would only start downloading when its component first renders,
 * which is after the database has opened and the shell has painted. This module starts those
 * downloads earlier, in two steps:
 *
 *  1. `preloadForRoute`, before startup: the page the address asks for, the slots that page draws and
 *     the ones the sidebar draws, so they arrive while IndexedDB opens instead of after it. Startup
 *     waits for them, but only briefly (see `start.tsx`), so the first render finds them loaded and
 *     draws the page at once, instead of drawing a skeleton and then shifting the layout as each card
 *     arrives;
 *  2. `preloadOverlays`, once the browser has been idle for a while: the dialogs and hosts that open on a
 *     key press (quick add above all), so the first press does not wait for the network.
 *
 * Other pages are not fetched ahead: the service worker has them all cached after the first visit, and
 * evaluating a hundred chunks in the background costs the page more than a first navigation does.
 *
 * A chunk that has not arrived when its component renders simply suspends, as it would without any of
 * this.
 */

/**
 * Which slots a page draws, by the prefix of their ids (`today.header`, `today.aside`…). Matching on the
 * prefix means a slot added later is fetched with its page without anyone editing this file.
 */
const ROUTE_SLOT_PREFIXES: Partial<Record<RouteName, readonly string[]>> = {
  today: ['today.'],
  focus: ['focus.'],
  goal: ['goal.'],
  course: ['course.'],
  progress: ['progress.'],
  rewards: ['rewards.'],
  blocker: ['blocker.'],
  settings: ['settings.'],
}

/** What the shell draws around every page, and the first render needs: the sidebar, the rail, the sheets. */
const SHELL_SLOT_PREFIXES: readonly string[] = ['sidebar.', 'shell.', 'more.']

const slotsWithPrefix = (prefixes: readonly string[]): SlotId[] =>
  SLOT_IDS.filter((id) => prefixes.some((prefix) => id.startsWith(prefix)))

/** The part of a `React.lazy` object that starts its download. There is no public way to do this. */
interface LazyInternals {
  $$typeof?: symbol
  _init?: (payload: unknown) => unknown
  _payload?: unknown
}

const LAZY_TYPE = Symbol.for('react.lazy')

const noop = (): void => undefined

/**
 * Starts downloading a `React.lazy` component without rendering it, and returns a promise that settles
 * when it has arrived or failed (`null` when there is nothing to wait for). React keeps the resolved
 * module on the lazy object, so the render that comes later reads it synchronously and never shows a
 * fallback. Anything that is not a lazy component is ignored, and if React ever changes the shape this
 * reads, nothing is preloaded and pages load when they render, as before.
 */
export function preloadLazy(component: unknown): Promise<void> | null {
  const lazy = component as LazyInternals | null
  if (!lazy || typeof lazy !== 'object' || lazy.$$typeof !== LAZY_TYPE) return null
  try {
    lazy._init?.(lazy._payload)
  } catch (thrown) {
    // `_init` throws the pending promise while the download runs, or the load error once it has
    // failed (the render that needs the component hits the same error and shows its error screen).
    if (thrown instanceof Promise) return thrown.then(noop, noop)
  }
  return null
}

function preloadSlots(registry: Registry, ids: readonly SlotId[]): Promise<void>[] {
  return ids.flatMap((id) => registry.slots(id).flatMap((c) => preloadLazy(c.component) ?? []))
}

/**
 * Step 1: the page for `pathname`, the slots it draws and the shell's own. Resolves when they have all
 * arrived (or failed); it never rejects.
 */
export async function preloadForRoute(registry: Registry, pathname: string): Promise<void> {
  const { name } = matchRoute(pathname)
  const page = preloadLazy(registry.pages.get(name))
  await Promise.all([
    ...(page ? [page] : []),
    ...preloadSlots(registry, slotsWithPrefix(ROUTE_SLOT_PREFIXES[name] ?? [])),
    ...preloadSlots(registry, slotsWithPrefix(SHELL_SLOT_PREFIXES)),
  ])
}

/** Data Saver asks apps not to download what nobody has asked for. */
const savingData = (): boolean =>
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true

/**
 * Step 2: the overlay hosts, in the background, one chunk per idle moment and not before the first
 * screen has long been settled. Returns a cancel function.
 */
export function preloadOverlays(registry: Registry): () => void {
  if (savingData()) return noop
  let cancelled = false
  const cancelIdle = whenIdle(
    () => {
      void (async () => {
        for (const c of registry.slots('global.overlays')) {
          if (cancelled) return
          preloadLazy(c.component)
          await yieldToMain()
        }
      })()
    },
    { delayMs: 5000, timeout: 20_000 },
  )
  return () => {
    cancelled = true
    cancelIdle()
  }
}
