import { useEffect, type ComponentType, type ReactNode } from 'react'
import { ToastProvider } from '@/ui/Toast'
import { CelebrationHost } from './CelebrationHost'
import { ErrorBoundary } from './ErrorBoundary'
import { RootErrorScreen } from './ErrorScreens'
import { runAppStart } from './boot'
import { useToday } from './hooks/useToday'
import { Shell } from './layout/Shell'
import { PaletteOverlay } from './palette/PaletteOverlay'
import { OverlayProvider, useOpenOverlays, useOverlays } from './providers/OverlayProvider'
import { ThemeProvider } from './providers/ThemeProvider'
import type { Registry } from './registry'
import { RegistryProvider } from './registry/RegistryContext'
import { RouterProvider } from './router'
import { ShortcutProvider } from './shortcuts/ShortcutProvider'
import { ShortcutSheet } from './shortcuts/ShortcutSheet'
import { useShortcutHandler } from './shortcuts'

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
                    <CelebrationHost />
                    <Shell />
                    <PaletteOverlay />
                    <ShortcutSheet />
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
