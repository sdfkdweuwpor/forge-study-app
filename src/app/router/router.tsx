import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'
import {
  consumeScrollFlag,
  currentPath,
  getUrl,
  pushUrl,
  serverUrl,
  subscribeLocation,
  toHref,
} from './location'
import { buildPath, buildQuery, matchRoute, parseQuery } from './match'
import {
  ROUTES,
  type ParamsOptional,
  type Query,
  type RouteArgs,
  type RouteName,
  type RouteParams,
} from './routes'

export type RouteMatch = {
  [N in RouteName]: { name: N; params: RouteParams<N> }
}[RouteName]

interface RouterState {
  route: RouteMatch
  pathname: string
  query: Record<string, string>
}

const RouterContext = createContext<RouterState | null>(null)

const APP_NAME = 'Forge'
let titleOverride: string | null = null

function titleFor(fragment: string): string {
  return fragment ? `${fragment} · ${APP_NAME}` : APP_NAME
}

/** Document title of a route with no page override: "Goals · Forge", or plain "Forge" for Today. */
function routeDocumentTitle(name: RouteName): string {
  return titleFor(name === 'today' ? '' : ROUTES[name].title)
}

// ── Imperative API ──────────────────────────────────────────────────────────────────────────────

type LooseParams = Record<string, string | undefined>

/**
 * The base-less app path of a route (`/tasks/inbox`): the form routes, saved views and `navigate` use,
 * and the one to compare with `currentPath()`.
 */
export function appPath<N extends RouteName>(name: N, ...args: RouteArgs<N, Query>): string {
  const [params, query] = args as [LooseParams | undefined, Query | undefined]
  return `${buildPath(ROUTES[name].path, params)}${buildQuery(query)}`
}

/**
 * The URL of a route as the browser needs it (`/forge-study-app/tasks/inbox` on GitHub Pages, the same
 * as `appPath` on Netlify). Use it for a real `<a href>` so opening in a new tab works; do not compare it
 * with `currentPath()` or store it (use `appPath`).
 */
export function href<N extends RouteName>(name: N, ...args: RouteArgs<N, Query>): string {
  return toHref(appPath(name, ...args))
}

export interface NavigateOptions {
  replace?: boolean
  query?: Query
}

export function navigate<N extends RouteName>(
  name: N,
  ...args: RouteArgs<N, NavigateOptions>
): void {
  const [params, opts] = args as [LooseParams | undefined, NavigateOptions | undefined]
  pushUrl(`${buildPath(ROUTES[name].path, params)}${buildQuery(opts?.query)}`, opts?.replace)
}

/**
 * Navigate to an already-built app URL (e.g. one stored in a saved view, which is base-less; a `href()`
 * result also works). Only same-origin paths with a single leading `/` are accepted; `//host`, absolute
 * URLs and control characters return false.
 */
export function navigateToUrl(url: string, replace = false): boolean {
  return pushUrl(url, replace)
}

/** Merge `patch` into the current query string (undefined/'' removes a key), keeping the path. */
export function setQuery(patch: Query, replace = true): void {
  const next = { ...parseQuery(window.location.search), ...patch }
  pushUrl(`${currentPath()}${buildQuery(next)}`, replace)
}

// ── Provider + hooks ────────────────────────────────────────────────────────────────────────────

export function RouterProvider({ children }: { children: ReactNode }) {
  const url = useSyncExternalStore(subscribeLocation, getUrl, serverUrl)

  const state = useMemo<RouterState>(() => {
    const q = url.indexOf('?')
    const pathname = q === -1 ? url : url.slice(0, q)
    const search = q === -1 ? '' : url.slice(q)
    return {
      route: matchRoute(pathname) as RouteMatch,
      pathname,
      query: parseQuery(search),
    }
  }, [url])

  const prevPathname = useRef(state.pathname)
  useEffect(() => {
    if (prevPathname.current !== state.pathname) {
      prevPathname.current = state.pathname
      if (consumeScrollFlag()) window.scrollTo(0, 0)
    }
  }, [state.pathname])

  const routeName = state.route.name
  useEffect(() => {
    if (titleOverride === null) document.title = routeDocumentTitle(routeName)
  }, [routeName, state.pathname])

  return <RouterContext.Provider value={state}>{children}</RouterContext.Provider>
}

function useRouterState(): RouterState {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('Router hooks must be used inside <RouterProvider>')
  return ctx
}

/** Current route name and params. Narrow on `name` to get typed params. */
export function useRoute(): RouteMatch {
  return useRouterState().route
}

/** Params of the current route; pass the route name your page is registered under. */
export function useParams<N extends RouteName>(): RouteParams<N> {
  return useRouterState().route.params as RouteParams<N>
}

export function useQuery(): Record<string, string> {
  return useRouterState().query
}

export function usePathname(): string {
  return useRouterState().pathname
}

/**
 * Overrides the document title while the calling page is mounted ("Goal · Forge"). While `title` is
 * undefined (data still loading, item deleted) or once the page unmounts, the route's own title returns.
 */
export function usePageTitle(title: string | undefined): void {
  const routeName = useRoute().name
  useEffect(() => {
    if (!title) return undefined
    titleOverride = title
    document.title = titleFor(title)
    return () => {
      titleOverride = null
      document.title = routeDocumentTitle(routeName)
    }
  }, [title, routeName])
}

// ── Link ────────────────────────────────────────────────────────────────────────────────────────

type LinkBase<N extends RouteName> = {
  to: N
  query?: Query
  replace?: boolean
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

export type LinkProps<N extends RouteName> = LinkBase<N> &
  (ParamsOptional<N> extends true ? { params?: RouteParams<N> } : { params: RouteParams<N> })

interface LinkImplProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: RouteName
  params?: LooseParams
  query?: Query
  replace?: boolean
}

/** A real `<a href>`: modified clicks (⌘/Ctrl/Shift/middle) and target=_blank keep native behaviour. */
export function Link<N extends RouteName>(props: LinkProps<N>) {
  const { to, params, query, replace, onClick, target, children, ...rest } = props as LinkImplProps
  // `url` is the base-less app path that `pushUrl` takes; only the anchor's `href` gets the base.
  const url = `${buildPath(ROUTES[to].path, params)}${buildQuery(query)}`

  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e)
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      (target && target !== '_self')
    ) {
      return
    }
    e.preventDefault()
    pushUrl(url, replace)
  }

  return (
    <a {...rest} href={toHref(url)} target={target} onClick={handleClick}>
      {children}
    </a>
  )
}
