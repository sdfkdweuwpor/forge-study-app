import { Suspense, lazy } from 'react'
import { useOpenOverlays } from '@/app/providers/OverlayProvider'

/** The full-screen view is loaded the first time it is opened, not with the app. */
const FullscreenFocus = lazy(() => import('./FullscreenFocus'))

/** Slot component (`global.overlays`): the view exists only while the shell says it is open. */
export function FullscreenOverlay() {
  const open = useOpenOverlays().includes('focusFullscreen')
  return open ? (
    <Suspense fallback={null}>
      <FullscreenFocus />
    </Suspense>
  ) : null
}
