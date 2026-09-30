import type { RouteName } from '../router'

/**
 * Routes whose optional param only picks a tab or a section of the page that is already there
 * (`/rewards/badges`, `/settings/data`), never a different thing to show the way a goal or a task id does.
 * Changing it keeps the page mounted: a tab keeps the keyboard focus it was given, and what the page holds
 * (a half-typed reward, the starter rewards it already offered) is not thrown away.
 */
const SAME_PAGE_PARAM: ReadonlySet<RouteName> = new Set<RouteName>(['settings', 'rewards'])

/** Of those, the routes whose param is a tab strip: the tab that has focus says what changed. */
const TAB_PARAM: ReadonlySet<RouteName> = new Set<RouteName>(['rewards'])

/**
 * The key a page is mounted under. A route with params remounts when they change, so no state leaks
 * from one goal, course or task to the next; a route in `SAME_PAGE_PARAM` stays put.
 */
export function pageKeyOf(
  route: { name: RouteName; params: Readonly<Record<string, string | undefined>> },
  pathname: string,
): string {
  const hasParams = Object.keys(route.params).length > 0
  return hasParams && !SAME_PAGE_PARAM.has(route.name) ? pathname : route.name
}

/**
 * Whether going from `from` to `to` only switched a tab of the same page. The route announcer stays
 * silent then (it would read the page's name again over the tab's own announcement) and leaves focus on
 * the tab.
 */
export function isTabSwitch(from: RouteName, to: RouteName): boolean {
  return from === to && TAB_PARAM.has(to)
}
