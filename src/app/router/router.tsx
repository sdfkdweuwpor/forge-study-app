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
import { consumeScrollFlag, getUrl, pushUrl, serverUrl, subscribeLocation } from './location'
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

// ── Imperative API ──────────────────────────────────────────────────────────────────────────────

type LooseParams = Record<string, string | undefined>

export function href<N extends RouteName>(name: N, ...args: RouteArgs<N, Query>): string {
  const [params, query] = args as [LooseParams | undefined, Query | undefined]
  return `${buildPath(ROUTES[name].path, params)}${buildQuery(query)}`
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

/** Navigate to an already-built app URL (e.g. one stored in a saved view). */
export function navigateToUrl(url: string, replace = false): void {
  pushUrl(url, replace)
}

/** Merge `patch` into the current query string (undefined/'' removes a key), keeping the path. */
export function setQuery(patch: Query, replace = true): void {
  const next = { ...parseQuery(window.location.search), ...patch }
  pushUrl(`${window.location.pathname}${buildQuery(next)}`, replace)
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
    if (titleOverride === null)
      document.title = titleFor(routeName === 'today' ? '' : ROUTES[routeName].title)
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

/** Overrides the document title while the calling page is mounted ("Goal · Forge"). */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    if (!title) return
    titleOverride = title
    document.title = titleFor(title)
    return () => {
      titleOverride = null
    }
  }, [title])
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
    <a {...rest} href={url} target={target} onClick={handleClick}>
      {children}
    </a>
  )
}
