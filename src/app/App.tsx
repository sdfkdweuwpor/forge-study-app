import { Suspense, lazy, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { whenIdle } from '@/lib/idle'
import { ToastProvider } from '@/ui/Toast'
import { CelebrationHost } from './CelebrationHost'
import { ErrorBoundary } from './ErrorBoundary'
import { RootErrorScreen } from './ErrorScreens'
import { runAppStart } from './boot'
import { useToday } from './hooks/useToday'
import { Shell } from './layout/Shell'
import { OverlayProvider, useOpenOverlays, useOverlays } from './providers/OverlayProvider'
import { ThemeProvider } from './providers/ThemeProvider'
import type { Registry } from './registry'
import type { OverlayKind } from './registry/types'
import { preloadLazy } from './bootPreload'
import { RegistryProvider } from './registry/RegistryContext'
import { RouterProvider } from './router'
import { ShortcutProvider } from './shortcuts/ShortcutProvider'
import { useShortcutHandler } from './shortcuts'

// The palette and the "?" sheet are big (the fuzzy search, the dialog, every shortcut row) and nobody sees
// them before pressing a key, so they load when first opened and are fetched ahead once the browser is idle.
const PaletteOverlay = lazy(() =>
  import('./palette/PaletteOverlay').then((m) => ({ default: m.PaletteOverlay })),
)
const ShortcutSheet = lazy(() =>
  import('./shortcuts/ShortcutSheet').then((m) => ({ default: m.ShortcutSheet })),
)

/** Mounts an overlay the first time it is opened and keeps it mounted after, so it can animate out. */
function OnFirstOpen({ kind, children }: { kind: OverlayKind; children: ReactNode }) {
  const open = useOpenOverlays().includes(kind)
  const [wanted, setWanted] = useState(open)
  if (open && !wanted) setWanted(true)
  return wanted ? <Suspense fallback={null}>{children}</Suspense> : null
}

/** Escape closes the most recently opened app overlay (palette, quick add, shortcut sheet, full-screen focus). */
function OverlayEscape() {
  const open = useOpenOverlays()
  const overlays = useOverlays()
  const last = open.at(-1)
  useShortcutHandler(
    'app.escape',
    () => {
      if (last) overlays.close(last)
    },
    last !== undefined,
  )
  return null
}

/** Runs feature `onAppStart` hooks on load and again whenever the local day rolls over. */
function AppStart({ registry }: { registry: Registry }) {
  const today = useToday()
  useEffect(() => {
    void runAppStart(registry, Date.now(), today)
  }, [registry, today])
  return null
}

/** Fetches the on-demand overlays in the background, after the first screen is done. */
function PrefetchOverlays() {
  useEffect(
    () =>
      whenIdle(
        () => {
          preloadLazy(PaletteOverlay)
          preloadLazy(ShortcutSheet)
        },
        { delayMs: 5000 },
      ),
    [],
  )
  return null
}

function FeatureProviders({ registry, children }: { registry: Registry; children: ReactNode }) {
  // Providers are sorted by `order`; the first is outermost.
  return registry.providers.reduceRight<ReactNode>((inner, p) => {
    const Provider: ComponentType<{ children: ReactNode }> = p.component
    return <Provider>{inner}</Provider>
  }, children)
}

/**
 * Provider order (outer → inner): error boundary, theme, registry, router, overlays, shortcuts,
 * toasts (so `useToast()` works in every feature provider and page), feature providers, then the
 * shell. Nothing here imports a feature: pages, commands, shortcuts and slots all arrive through
 * the registry.
 */
export function App({ registry }: { registry: Registry }) {
  return (
    <ErrorBoundary fallback={(error, reset) => <RootErrorScreen error={error} onRetry={reset} />}>
      <ThemeProvider>
        <RegistryProvider registry={registry}>
          <RouterProvider>
            <OverlayProvider>
              <ShortcutProvider>
                <ToastProvider>
                  <FeatureProviders registry={registry}>
                    <OverlayEscape />
                    <AppStart registry={registry} />
                    <PrefetchOverlays />
                    <CelebrationHost />
                    <Shell />
                    <OnFirstOpen kind="palette">
                      <PaletteOverlay />
                    </OnFirstOpen>
                    <OnFirstOpen kind="shortcuts">
                      <ShortcutSheet />
                    </OnFirstOpen>
                  </FeatureProviders>
                </ToastProvider>
              </ShortcutProvider>
            </OverlayProvider>
          </RouterProvider>
        </RegistryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
