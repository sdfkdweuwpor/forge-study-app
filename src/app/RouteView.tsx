import { Suspense, createElement } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { RouteErrorView } from './ErrorScreens'
import { NotFound } from './NotFound'
import { Placeholder } from './Placeholder'
import { PageSkeleton } from './PageSkeleton'
import { useRegistry } from './registry'
import { usePathname, useRoute } from './router'
import { ROUTES } from './router/routes'

/** Resolves the current route to its registered lazy page, or a Placeholder when no feature provides one yet. */
export function RouteView() {
  const route = useRoute()
  const pathname = usePathname()
  const registry = useRegistry()
  const Page = registry.pages.get(route.name)

  return (
    <ErrorBoundary
      resetKey={pathname}
      fallback={(error, reset) => <RouteErrorView error={error} onRetry={reset} />}
    >
      <Suspense fallback={<PageSkeleton />}>
        {route.name === 'notFound' ? (
          <NotFound />
        ) : Page ? (
          // Registered pages are stable module-level lazy components; createElement keeps the lookup out of JSX.
          createElement(Page)
        ) : (
          <Placeholder phase={ROUTES[route.name].phase} />
        )}
      </Suspense>
    </ErrorBoundary>
  )
}
